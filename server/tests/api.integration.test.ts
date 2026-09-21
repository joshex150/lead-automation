import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import type { Express } from "express";

import { createApp } from "../src/app.js";
import { config } from "../src/config/index.js";
import { Lead } from "../src/models/Lead.js";
import { Suppression } from "../src/models/Suppression.js";
import { OutreachLog } from "../src/models/OutreachLog.js";
import { PipelineJob } from "../src/models/PipelineJob.js";
import { PipelineLease } from "../src/models/PipelineLease.js";
import { SearchRun } from "../src/models/SearchRun.js";
import { Settings, getSettings } from "../src/models/Settings.js";
import {
  processLead,
  repairOutreachChannels,
  rewriteTemplatePitches,
  templatePitchFilter,
  templatePitchSummary,
} from "../src/services/pipeline/runPipeline.js";
import { runFollowUps } from "../src/services/outreach/followUp.js";

let mongod: MongoMemoryServer | null = null;
let app: Express;
let dbAvailable = true;

beforeAll(async () => {
  // Prefer an externally provided MongoDB (real mongod or a wire-compatible
  // server such as FerretDB) via TEST_MONGODB_URI; otherwise spin up an
  // in-memory mongod. If neither is reachable (e.g. offline CI that can't
  // download the mongod binary), the suite skips instead of failing.
  try {
    const externalUri = process.env.TEST_MONGODB_URI;
    if (externalUri) {
      await mongoose.connect(externalUri, { dbName: `yean_test_${Date.now()}` });
    } else {
      mongod = await MongoMemoryServer.create();
      await mongoose.connect(mongod.getUri("yean_test"));
    }
    await Promise.all([
      Lead.deleteMany({}),
      Suppression.deleteMany({}),
      OutreachLog.deleteMany({}),
      PipelineJob.deleteMany({}),
      PipelineLease.deleteMany({}),
      SearchRun.deleteMany({}),
    ]);
    await getSettings();
    app = createApp();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);

    /*
     * Skipping is a convenience for a laptop with no MongoDB on it. Anywhere
     * that is checking the build, it is a trap: every one of these tests
     * skipped silently here for months because the in-memory mongod could not
     * be downloaded, and the suite still reported success. Fifty-one tests
     * passing and fifty-one tests skipped look identical in a green tick.
     *
     * So CI, and anyone who asks for it, gets a failure instead.
     */
    if (process.env.REQUIRE_INTEGRATION === "1" || process.env.CI === "true") {
      throw new Error(
        `Integration suite could not reach a database, and skipping is disabled here.\n` +
          `Set TEST_MONGODB_URI to a MongoDB-compatible server (a real mongod, or FerretDB).\n` +
          `Reason: ${reason}`,
      );
    }

    dbAvailable = false;
    // eslint-disable-next-line no-console
    console.warn(
      "\n[integration] No MongoDB available, skipping integration suite.\n" +
        "Set TEST_MONGODB_URI to a MongoDB-compatible server to run it.\n" +
        "Set REQUIRE_INTEGRATION=1 to make this a failure instead of a skip.\n" +
        `Reason: ${reason}\n`,
    );
  }
});

beforeEach((ctx) => {
  if (!dbAvailable) ctx.skip();
});

afterAll(async () => {
  if (dbAvailable) await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

function makeLead(overrides: Record<string, unknown> = {}) {
  return Lead.create({
    businessName: "Crystal Scents",
    businessNameNormalized: "crystal scents",
    category: "perfume stores",
    city: "Port Harcourt",
    // Places always returns an address ending in the country, and the country
    // is now read from it rather than from a setting. A fixture without one is
    // a business whose country nobody knows, and its number is kept as found.
    address: "12 Trans Amadi Rd, Port Harcourt, Rivers, Nigeria",
    googlePlaceId: `place-${Math.random().toString(36).slice(2)}`,
    phone: "0803 123 4567",
    pipelineStage: "DISCOVERED",
    ...overrides,
  });
}

describe("health & auth", () => {
  it("GET /health responds without auth", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.db).toBe("connected");
  });

  it("GET / also responds 200 without auth (defensive, in case a platform healthchecks the root path)", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("malformed JSON body returns 400, not 500", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set("Content-Type", "application/json")
      .send('{"cities": [oops');
    expect(res.status).toBe(400);
  });

  it("unknown route returns 404", async () => {
    const res = await request(app).get("/api/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("enforces x-api-key when API_KEY is configured", async () => {
    const original = config.API_KEY;
    (config as { API_KEY: string }).API_KEY = "super-secret";
    try {
      const denied = await request(app).get("/api/settings");
      expect(denied.status).toBe(401);

      const wrongKey = await request(app).get("/api/settings").set("x-api-key", "wrong");
      expect(wrongKey.status).toBe(401);

      const allowed = await request(app).get("/api/settings").set("x-api-key", "super-secret");
      expect(allowed.status).toBe(200);
    } finally {
      (config as { API_KEY: string }).API_KEY = original;
    }
  });
});

describe("settings API", () => {
  it("returns seeded defaults", async () => {
    const res = await request(app).get("/api/settings");
    expect(res.status).toBe(200);
    expect(res.body.settings.cities).toContain("Lagos");
    expect(res.body.settings.scoreThreshold).toBe(50);
    expect(res.body.settings.scoringWeights.noWebsite).toBe(60);
    expect(res.body.settings.scoringWeights.newBusiness).toBe(18);
    expect(res.body.settings.scoringWeights.phoneOnly).toBe(15);
    expect(res.body.settings.placesRequestsPerMinute).toBe(60);
  });

  it("updates cities, threshold and weights", async () => {
    const res = await request(app)
      .put("/api/settings")
      .send({
        cities: ["Lagos", "Enugu"],
        scoreThreshold: 45,
        placesRequestsPerMinute: 24,
        scoringWeights: { shopifyWebsite: 20, newBusiness: 21, phoneOnly: 17 },
      });
    expect(res.status).toBe(200);
    expect(res.body.settings.cities).toEqual(["Lagos", "Enugu"]);
    expect(res.body.settings.scoreThreshold).toBe(45);
    expect(res.body.settings.placesRequestsPerMinute).toBe(24);
    expect(res.body.settings.scoringWeights.shopifyWebsite).toBe(20);
    expect(res.body.settings.scoringWeights.newBusiness).toBe(21);
    expect(res.body.settings.scoringWeights.phoneOnly).toBe(17);
    // untouched weights preserved
    expect(res.body.settings.scoringWeights.noWebsite).toBe(60);

    // reset for later tests
    await request(app).post("/api/settings/reset");
  });

  it("rejects invalid updates", async () => {
    const res = await request(app).put("/api/settings").send({ cities: [] });
    expect(res.status).toBe(400);
    const unsafeRate = await request(app).put("/api/settings").send({ placesRequestsPerMinute: 121 });
    expect(unsafeRate.status).toBe(400);
  });
});

describe("lead lifecycle", () => {
  it("full offline pipeline: NO_WEBSITE lead → scored → pitched → pending approval", async () => {
    const lead = await makeLead({ businessName: "Amara Kitchen", businessNameNormalized: "amara kitchen", category: "restaurants", city: "Lagos" });
    // Need qualifies on its own; WhatsApp only improves reach and priority.
    const outcome = await processLead(lead);

    expect(outcome.websiteType).toBe("NO_WEBSITE");
    expect(outcome.score).toBe(60);
    expect(outcome.qualified).toBe(true);
    expect(outcome.stage).toBe("PENDING_APPROVAL");

    const saved = await Lead.findById(lead._id);
    expect(saved!.phoneNormalized).toBe("+2348031234567");
    expect(saved!.whatsappAvailable).toBe(true);
    expect(saved!.pitchMessage).toContain("Amara Kitchen");
    expect(saved!.pitchSubject).toBeTruthy();
    expect(saved!.approval.status).toBe("PENDING");
    expect(saved!.contactSources.some((s) => s.source === "google_places" && s.field === "phone")).toBe(true);
  });

  it("lists and filters leads", async () => {
    const res = await request(app).get("/api/leads?stage=PENDING_APPROVAL&minScore=40");
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(res.body.items.every((l: { needScore: number }) => l.needScore >= 40)).toBe(true);

    const search = await request(app).get("/api/leads?search=amara");
    expect(search.body.items.some((l: { businessName: string }) => l.businessName === "Amara Kitchen")).toBe(true);

    const rising = await makeLead({
      businessName: "Rising Bracket [Cafe]",
      businessNameNormalized: "rising bracket cafe",
      phone: undefined,
      maturity: "NEW",
      ratingVelocity: 3,
      needScore: 70,
      leadScore: 70,
      reachScore: 0,
      priorityScore: 53,
    });
    const advanced = await request(app).get("/api/leads?maturity=NEW&contactable=none&minRatingVelocity=2");
    expect(advanced.status).toBe(200);
    expect(advanced.body.items.some((lead: { _id: string }) => lead._id === String(rising._id))).toBe(true);
    const escaped = await request(app).get("/api/leads").query({ search: "[Cafe]" });
    expect(escaped.status).toBe(200);
    expect(escaped.body.items.some((lead: { _id: string }) => lead._id === String(rising._id))).toBe(true);

    const legacy = await Lead.collection.insertOne({
      businessName: "Legacy Score",
      businessNameNormalized: "legacy score",
      category: "restaurants",
      city: "Lagos",
      googlePlaceId: `legacy-${Math.random().toString(36).slice(2)}`,
      leadScore: 64,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const legacyFilter = await request(app).get("/api/leads?minScore=60");
    expect(legacyFilter.status).toBe(200);
    expect(legacyFilter.body.items.some((lead: { _id: string }) => lead._id === String(legacy.insertedId))).toBe(true);
  });

  it("PATCH edits contact info, records provenance, and rescores", async () => {
    const lead = await makeLead({ businessName: "Patch Target", businessNameNormalized: "patch target" });
    await processLead(lead);

    const res = await request(app)
      .patch(`/api/leads/${lead._id}`)
      .send({ email: "owner@patchtarget.ng", instagramActive: true });
    expect(res.status).toBe(200);
    // Contact fields improve reach without changing qualifying need.
    expect(res.body.lead.needScore).toBe(60);
    expect(res.body.lead.reachScore).toBe(95);
    expect(res.body.lead.priorityScore).toBe(69);
    expect(res.body.lead.contactSources.some((s: { source: string; field: string }) => s.source === "manual" && s.field === "email")).toBe(true);
  });

  it("rejects unknown PATCH fields", async () => {
    const lead = await makeLead({ businessNameNormalized: "x1" });
    const res = await request(app).patch(`/api/leads/${lead._id}`).send({ pipelineStage: "CONTACTED" });
    expect(res.status).toBe(400);
  });

  it("approve without Gmail records approval and reports draftError", async () => {
    const lead = await makeLead({ businessName: "Approve Me", businessNameNormalized: "approve me", email: "x@approve.ng" });
    await processLead(lead);

    const res = await request(app).post(`/api/leads/${lead._id}/approve`).send({ reviewedBy: "tester" });
    expect(res.status).toBe(200);
    expect(res.body.lead.approval.status).toBe("APPROVED");
    expect(res.body.lead.pipelineStage).toBe("APPROVED");
    expect(res.body.draft).toBeNull();
    expect(res.body.draftError).toMatch(/no email provider configured/i);

    const log = await OutreachLog.findOne({ leadId: lead._id, action: "APPROVED" });
    expect(log).toBeTruthy();
  });

  it("cannot approve a lead without a pitch", async () => {
    const lead = await makeLead({ businessNameNormalized: "nopitch" });
    const res = await request(app).post(`/api/leads/${lead._id}/approve`);
    expect(res.status).toBe(409);
  });

  it("reject flow", async () => {
    const lead = await makeLead({ businessNameNormalized: "reject me" });
    await processLead(lead);
    const res = await request(app).post(`/api/leads/${lead._id}/reject`).send({ notes: "not a fit" });
    expect(res.status).toBe(200);
    expect(res.body.lead.approval.status).toBe("REJECTED");
    expect(res.body.lead.pipelineStage).toBe("REJECTED");
  });

  it("send requires approval first", async () => {
    const lead = await makeLead({ businessNameNormalized: "sendfirst", email: "a@b.ng" });
    await processLead(lead);
    const res = await request(app).post(`/api/leads/${lead._id}/send`);
    expect(res.status).toBe(409);
  });

  it("mark-contacted (manual Instagram) sets follow-up date", async () => {
    const lead = await makeLead({ businessNameNormalized: "ig manual", instagramUsername: "igbiz" });
    await processLead(lead);
    const res = await request(app).post(`/api/leads/${lead._id}/mark-contacted`).send({});
    expect(res.status).toBe(200);
    expect(res.body.lead.outreachStatus).toBe("CONTACTED");
    expect(res.body.lead.timesContacted).toBe(1);
    expect(new Date(res.body.lead.followUpAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("positive response cancels follow-up and marks INTERESTED", async () => {
    const lead = await makeLead({ businessNameNormalized: "responder" });
    await processLead(lead);
    await request(app).post(`/api/leads/${lead._id}/mark-contacted`).send({});
    const res = await request(app)
      .post(`/api/leads/${lead._id}/response`)
      .send({ status: "POSITIVE", estimatedDealValue: 350000 });
    expect(res.status).toBe(200);
    expect(res.body.lead.outreachStatus).toBe("INTERESTED");
    expect(res.body.lead.followUpAt).toBeFalsy();
    expect(res.body.lead.estimatedDealValue).toBe(350000);
  });

  it("convert marks the lead CONVERTED with deal value", async () => {
    const lead = await makeLead({ businessNameNormalized: "converter" });
    const res = await request(app).post(`/api/leads/${lead._id}/convert`).send({ dealValue: 500000 });
    expect(res.status).toBe(200);
    expect(res.body.lead.outreachStatus).toBe("CONVERTED");
    expect(res.body.lead.estimatedDealValue).toBe(500000);
  });

  it("404s for missing/invalid ids", async () => {
    expect((await request(app).get(`/api/leads/${new mongoose.Types.ObjectId()}`)).status).toBe(404);
    expect((await request(app).get("/api/leads/not-an-id")).status).toBe(404);
  });
});

describe("compliance: opt-out & suppression", () => {
  it("OPT_OUT response suppresses every identifier and archives the lead", async () => {
    const lead = await makeLead({
      businessName: "OptOut Biz",
      businessNameNormalized: "optout biz",
      email: "owner@optout.ng",
      instagramUsername: "optoutbiz",
      websiteUrl: "https://optout.ng",
    });
    await processLead(lead);

    const res = await request(app)
      .post(`/api/leads/${lead._id}/response`)
      .send({ status: "OPT_OUT", note: "asked to stop" });
    expect(res.status).toBe(200);
    expect(res.body.optedOut).toBe(true);

    const saved = await Lead.findById(lead._id);
    expect(saved!.optedOut).toBe(true);
    expect(saved!.outreachStatus).toBe("DO_NOT_CONTACT");
    expect(saved!.pipelineStage).toBe("ARCHIVED");
    expect(saved!.followUpAt).toBeFalsy();

    const entries = await Suppression.find({ leadId: lead._id });
    const types = entries.map((e) => e.type).sort();
    expect(types).toEqual(expect.arrayContaining(["EMAIL", "PHONE", "INSTAGRAM", "PLACE_ID", "DOMAIN"]));

    // approving or sending is now impossible
    expect((await request(app).post(`/api/leads/${lead._id}/approve`)).status).toBe(409);
    expect((await request(app).post(`/api/leads/${lead._id}/send`)).status).toBe(409);
    expect((await request(app).post(`/api/leads/${lead._id}/mark-contacted`)).status).toBe(409);
  });

  it("manual suppression entry retroactively archives matching leads", async () => {
    const lead = await makeLead({
      businessName: "Suppress Domain",
      businessNameNormalized: "suppress domain",
      websiteUrl: "https://www.suppressme.ng/home",
    });

    const res = await request(app)
      .post("/api/suppression")
      .send({ type: "DOMAIN", value: "https://suppressme.ng", reason: "asked via phone" });
    expect(res.status).toBe(201);
    expect(res.body.entry.value).toBe("suppressme.ng");
    expect(res.body.affectedLeads).toBeGreaterThanOrEqual(1);

    const saved = await Lead.findById(lead._id);
    expect(saved!.optedOut).toBe(true);
    expect(saved!.outreachStatus).toBe("DO_NOT_CONTACT");
  });

  it("lists and deletes suppression entries", async () => {
    const list = await request(app).get("/api/suppression");
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThan(0);

    const add = await request(app).post("/api/suppression").send({ type: "EMAIL", value: "Delete.Me@X.NG" });
    expect(add.body.entry.value).toBe("delete.me@x.ng");

    const del = await request(app).delete(`/api/suppression/${add.body.entry._id}`);
    expect(del.status).toBe(200);
  });

  it("suppression entries are normalized (instagram @, phone formatting)", async () => {
    const ig = await request(app).post("/api/suppression").send({ type: "INSTAGRAM", value: "@SomeBiz" });
    expect(ig.body.entry.value).toBe("somebiz");
  });
});

describe("follow-up engine", () => {
  it("selects only due, uncontacted-again, non-responded email leads", async () => {
    const due = await makeLead({
      businessName: "Due FollowUp",
      businessNameNormalized: "due followup",
      email: "due@x.ng",
      outreachChannel: "EMAIL",
      outreachStatus: "CONTACTED",
      pipelineStage: "CONTACTED",
      timesContacted: 1,
      followUpAt: new Date(Date.now() - 60_000),
    });
    // responded lead must NOT be picked up
    await makeLead({
      businessName: "Responded",
      businessNameNormalized: "responded x",
      email: "resp@x.ng",
      outreachChannel: "EMAIL",
      outreachStatus: "CONTACTED",
      responseStatus: "POSITIVE",
      timesContacted: 1,
      followUpAt: new Date(Date.now() - 60_000),
    });

    const result = await runFollowUps();
    // Gmail is not configured in tests → eligible but skipped, never crash
    expect(result.eligible).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.sent).toBe(0);

    const saved = await Lead.findById(due._id);
    expect(saved!.followUpSentAt).toBeFalsy();
  });
});

describe("website check endpoint", () => {
  it("classifies a DNS-dead domain as BROKEN_WEBSITE", async () => {
    const res = await request(app)
      .post("/api/pipeline/check-website")
      .send({ url: "https://definitely-not-a-real-site-yean-2026.invalid" });
    expect(res.status).toBe(200);
    expect(res.body.classification.websiteType).toBe("BROKEN_WEBSITE");
    expect(res.body.check.reachable).toBe(false);
  });

  it("classifies an Instagram URL as SOCIAL_MEDIA_ONLY without probing deeply", async () => {
    const res = await request(app)
      .post("/api/pipeline/check-website")
      .send({ url: "https://instagram.com/somebusiness" });
    expect(res.status).toBe(200);
    expect(res.body.classification.websiteType).toBe("SOCIAL_MEDIA_ONLY");
  });

  it("classifies a Linktree URL as LINK_IN_BIO_ONLY", async () => {
    const res = await request(app)
      .post("/api/pipeline/check-website")
      .send({ url: "https://linktr.ee/somebusiness" });
    expect(res.body.classification.websiteType).toBe("LINK_IN_BIO_ONLY");
  });

  it("rejects missing url", async () => {
    const res = await request(app).post("/api/pipeline/check-website").send({});
    expect(res.status).toBe(400);
  });
});

describe("stats", () => {
  it("returns the full dashboard shape", async () => {
    const res = await request(app).get("/api/stats");
    expect(res.status).toBe(200);
    expect(res.body.totals.total).toBeGreaterThan(0);
    expect(res.body.totals.converted).toBeGreaterThanOrEqual(1);
    expect(res.body.revenue.totalDealValue).toBeGreaterThanOrEqual(500000);
    expect(res.body.byStage).toBeTypeOf("object");
    expect(res.body.byWebsiteType).toBeTypeOf("object");
    expect(res.body.integrations).toHaveProperty("gmail");
  });

  it("returns quality, recency, contactability and source analytics", async () => {
    const res = await request(app).get("/api/stats/analytics?days=all");
    expect(res.status).toBe(200);
    expect(res.body.window.label).toBe("All time");
    expect(res.body.qualificationThreshold).toBeTypeOf("number");
    expect(res.body.totals.total).toBeGreaterThan(0);
    expect(res.body.totals).toHaveProperty("qualified");
    expect(res.body.contactability).toHaveProperty("none");
    expect(res.body.contactability).toHaveProperty("phone");
    expect(res.body.totals.converted).toBeLessThanOrEqual(res.body.totals.interested);
    expect(res.body.totals.interested).toBeLessThanOrEqual(res.body.totals.contacted);
    expect(res.body.scores.needBuckets).toHaveProperty("50–74");
    expect(res.body.byMaturity).toBeTypeOf("object");
    expect(res.body.bySource).toBeTypeOf("object");
  });

  it("reports the funnel as stage-to-stage conversion, never widening", async () => {
    const res = await request(app).get("/api/stats/analytics?days=all");
    expect(res.status).toBe(200);

    const funnel = res.body.funnel as Array<{ id: string; count: number; fromPrevious: number; ofDiscovered: number; dropped: number }>;
    expect(funnel.map((stage) => stage.id)).toEqual([
      "discovered",
      "qualified",
      "approved",
      "contacted",
      "responded",
      "converted",
    ]);
    expect(funnel[0].count).toBe(res.body.totals.total);

    // A stage can never hold more than the one before it, and the drop has to
    // account for the difference. This is what catches a miscounted stage.
    for (let i = 1; i < funnel.length; i++) {
      expect(funnel[i].count).toBeLessThanOrEqual(funnel[i - 1].count);
      expect(funnel[i].dropped).toBe(funnel[i - 1].count - funnel[i].count);
      expect(funnel[i].fromPrevious).toBeLessThanOrEqual(100);
      expect(funnel[i].ofDiscovered).toBeLessThanOrEqual(100);
    }
  });

  it("buckets discovery over time and never counts more qualified than found", async () => {
    const res = await request(app).get("/api/stats/analytics?days=all");
    expect(res.status).toBe(200);
    expect(["day", "week", "month"]).toContain(res.body.timeline.bucket);

    const points = res.body.timeline.points as Array<{ date: string; discovered: number; qualified: number }>;
    expect(points.length).toBeGreaterThan(0);
    const discovered = points.reduce((sum, point) => sum + point.discovered, 0);
    expect(discovered).toBe(res.body.totals.total);
    for (const point of points) expect(point.qualified).toBeLessThanOrEqual(point.discovered);
    // Buckets must come out in order, or the chart draws time backwards.
    expect([...points].sort((a, b) => (a.date < b.date ? -1 : 1))).toEqual(points);
  });

  it("reports qualification rates per city and category that agree with the totals", async () => {
    const res = await request(app).get("/api/stats/analytics?days=all");
    expect(res.status).toBe(200);

    for (const key of ["qualificationByCity", "qualificationByCategory"] as const) {
      const rows = res.body[key] as Array<{ name: string; total: number; qualified: number; rate: number }>;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.qualified).toBeLessThanOrEqual(row.total);
        expect(row.rate).toBe(Math.round((row.qualified / row.total) * 100));
      }
    }

    // The grouped totals are the same documents as the flat breakdown, so they
    // have to agree. They came from separate aggregations until recently.
    const cityRows = res.body.qualificationByCity as Array<{ name: string; total: number }>;
    for (const row of cityRows) expect(res.body.byCity[row.name]).toBe(row.total);
  });
});

describe("pipeline safety", () => {
  it("discovery without a Places key returns 503, not a crash", async () => {
    const res = await request(app).post("/api/pipeline/discover").send({});
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/Places API key/i);
  });
});

describe("manual/bulk import source", () => {
  it("imports leads, dedupes, and processes them through the pipeline", async () => {
    const res = await request(app)
      .post("/api/pipeline/import")
      .send({
        city: "Port Harcourt",
        category: "perfume stores",
        process: true,
        items: [
          { businessName: "Fresh IG Find", instagramUsername: "@freshigfind", email: "hi@freshfind.ng" },
          { businessName: "Referral Biz", websiteUrl: "https://referralbiz.ng", city: "Lagos" },
          { businessName: "Fresh IG Find" }, // duplicate by name+city
          { businessName: "" }, // invalid
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(2);
    expect(res.body.duplicates).toBe(1);
    expect(res.body.invalid).toBe(1);

    // The imported lead exists, carries the source and provenance, and was processed.
    const list = await request(app).get("/api/leads?search=Fresh IG Find");
    const lead = list.body.items[0];
    expect(lead.discoverySource).toBe("manual_import");
    expect(lead.instagramUsername).toBe("freshigfind");
    expect(lead.email).toBe("hi@freshfind.ng");
    expect(lead.pipelineStage).not.toBe("DISCOVERED"); // processed
    expect(lead.contactSources.some((c: { source: string }) => c.source === "manual")).toBe(true);
  });

  it("does not re-import a suppressed business", async () => {
    await request(app).post("/api/suppression").send({ type: "EMAIL", value: "blocked@nope.ng" });
    const res = await request(app)
      .post("/api/pipeline/import")
      .send({ items: [{ businessName: "Blocked Co", email: "blocked@nope.ng", city: "Lagos" }] });
    expect(res.status).toBe(200);
    expect(res.body.suppressed).toBe(1);
    expect(res.body.created).toBe(0);
  });

  it("rejects an empty import", async () => {
    const res = await request(app).post("/api/pipeline/import").send({ items: [] });
    expect(res.status).toBe(400);
  });
});

describe("directory source config", () => {
  it("stores directory source settings and validates URLs", async () => {
    const ok = await request(app)
      .put("/api/settings")
      .send({
        integrations: {
          sources: {
            directory: { enabled: true, urls: ["https://directory.example/new"], defaultCity: "Lagos", defaultCategory: "fashion" },
          },
        },
      });
    expect(ok.status).toBe(200);
    expect(ok.body.settings.integrations.sources.directory.enabled).toBe(true);

    const bad = await request(app)
      .put("/api/settings")
      .send({ integrations: { sources: { directory: { urls: ["not-a-url"] } } } });
    expect(bad.status).toBe(400);
  });

  it("running enabled sources with no reachable URL does not crash", async () => {
    const res = await request(app).post("/api/pipeline/discover-sources").send({});
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.sources)).toBe(true);
  });
});

describe("onboarding state", () => {
  it("starts un-onboarded, can be completed and re-opened", async () => {
    const before = await request(app).get("/api/stats");
    // may be null or a date depending on prior tests; force a known state
    await request(app).post("/api/settings/onboarding").send({ complete: true });
    const done = await request(app).get("/api/stats");
    expect(done.body.onboardedAt).toBeTruthy();

    await request(app).post("/api/settings/onboarding").send({ complete: false });
    const reopened = await request(app).get("/api/stats");
    expect(reopened.body.onboardedAt).toBeNull();
    expect(before.body).toHaveProperty("onboardedAt");
  });
});

describe("settings: DB-backed config + secret masking", () => {
  it("stores provider credentials and returns them masked", async () => {
    const put = await request(app)
      .put("/api/settings")
      .send({
        integrations: {
          googlePlacesApiKey: "AIzaSECRETPLACES99",
          ai: { provider: "OPENAI", apiKey: "sk-supersecret1234", model: "gpt-4o" },
          email: {
            provider: "RESEND",
            fromAddress: "hello@yean.tech",
            resend: { apiKey: "re_secretkeyABCD" },
          },
        },
      });
    expect(put.status).toBe(200);
    // Response is masked, never the raw secret.
    expect(put.body.settings.integrations.ai.apiKey).toBe("••••1234");
    expect(put.body.settings.integrations.googlePlacesApiKey).toBe("••••ES99");
    expect(put.body.settings.integrations.email.resend.apiKey).toBe("••••ABCD");
    expect(put.body.settings.integrations.ai.model).toBe("gpt-4o");

    // GET is masked too.
    const get = await request(app).get("/api/settings");
    expect(get.body.settings.integrations.ai.apiKey).toBe("••••1234");
  });

  it("re-saving with masked placeholders preserves the stored secret", async () => {
    // Read masked, send it straight back with an unrelated edit.
    const get = await request(app).get("/api/settings");
    const masked = get.body.settings.integrations;
    const put = await request(app)
      .put("/api/settings")
      .send({ integrations: { ai: { apiKey: masked.ai.apiKey, model: "gpt-4o-mini" } } });
    expect(put.status).toBe(200);
    expect(put.body.settings.integrations.ai.model).toBe("gpt-4o-mini");

    // The real key survived: the resolved runtime still sees it.
    const status = await request(app).get("/api/settings/integrations");
    expect(status.body.ai.configured).toBe(true);
    expect(status.body.ai.provider).toBe("openai");
  });

  it("integration status reflects configured providers without leaking secrets", async () => {
    const res = await request(app).get("/api/settings/integrations");
    expect(res.status).toBe(200);
    expect(res.body.googlePlaces.configured).toBe(true);
    expect(res.body.email.provider).toBe("resend");
    expect(JSON.stringify(res.body)).not.toContain("secret");
  });

  it("rejects an invalid AI base URL", async () => {
    const res = await request(app)
      .put("/api/settings")
      .send({ integrations: { ai: { baseUrl: "not-a-url" } } });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid cron expression", async () => {
    const res = await request(app)
      .put("/api/settings")
      .send({ integrations: { scheduler: { discoveryCron: "not a cron" } } });
    expect(res.status).toBe(400);
  });

  it("accepts a valid cron expression", async () => {
    const res = await request(app)
      .put("/api/settings")
      .send({ integrations: { scheduler: { discoveryCron: "*/30 * * * *" } } });
    expect(res.status).toBe(200);
  });

  it("test endpoints answer without throwing when providers are unreachable", async () => {
    // Points AI at a dead custom endpoint so the call fails fast but the
    // route still returns a structured { ok:false } instead of a 500.
    await request(app)
      .put("/api/settings")
      .send({
        integrations: {
          ai: { provider: "CUSTOM", apiKey: "k", model: "x", baseUrl: "http://127.0.0.1:9/v1" },
        },
      });
    const ai = await request(app).post("/api/settings/test-ai").send({});
    expect(ai.status).toBe(200);
    expect(ai.body.ok).toBe(false);
  });
});

describe("email provider send flow (mocked provider)", () => {
  it("approves and sends through the active provider, respecting the send lifecycle", async () => {
    const { _setEmailProviderForTests } = await import("../src/services/outreach/email/index.js");
    const sent: Array<{ to: string }> = [];
    const fakeProvider = {
      name: "resend" as const,
      supportsDrafts: false,
      send: async (m: { to: string }) => {
        sent.push(m);
        return { messageId: "mock-1", threadId: "mock-1" };
      },
      verify: async () => undefined,
    };
    const fakeRuntime = {
      provider: "resend" as const,
      configured: true,
      supportsDrafts: false,
      fromAddress: "hello@yean.tech",
      fromName: "YEAN",
      gmail: { clientId: "", clientSecret: "", refreshToken: "" },
      zoho: { host: "smtp.zoho.com", port: 465, secure: true, user: "", password: "" },
      resend: { apiKey: "re_x" },
      source: "db" as const,
    };
    _setEmailProviderForTests(fakeProvider, fakeRuntime);
    try {
      // Construct a ready-to-approve EMAIL lead directly, so this test targets
      // the approve/send lifecycle rather than scoring/enrichment.
      const lead = await makeLead({
        businessName: "Send Flow",
        businessNameNormalized: "send flow",
        email: "owner@sendflow.ng",
        websiteType: "NO_WEBSITE",
        leadScore: 65,
        outreachChannel: "EMAIL",
        pipelineStage: "PENDING_APPROVAL",
        pitchSubject: "A website for Send Flow",
        pitchMessage: "Hello Send Flow, we'd love to build you a website.",
        approval: { status: "PENDING" },
      });

      const approve = await request(app).post(`/api/leads/${lead._id}/approve`).send({});
      expect(approve.status).toBe(200);
      expect(approve.body.lead.approval.status).toBe("APPROVED");
      // Draft-less provider records an internal draft.
      expect(approve.body.draft.internal).toBe(true);

      const send = await request(app).post(`/api/leads/${lead._id}/send`).send({});
      expect(send.status).toBe(200);
      expect(send.body.lead.outreachStatus).toBe("CONTACTED");
      expect(send.body.lead.followUpAt).toBeTruthy();
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe("owner@sendflow.ng");
    } finally {
      _setEmailProviderForTests(null);
    }
  });
});

describe("background pipeline recovery", () => {
  it("runs persisted DISCOVERED leads in the background and rejects overlapping jobs", async () => {
    await Promise.all([Lead.deleteMany({}), PipelineJob.deleteMany({}), PipelineLease.deleteMany({})]);
    // Earlier provider tests intentionally leave a dead custom endpoint in
    // settings. Disable AI here so this test isolates background recovery and
    // uses the intentional built-in template rather than an outage fallback.
    const settingsUpdate = await request(app)
      .put("/api/settings")
      .send({ integrations: { ai: { provider: "NONE" } } });
    expect(settingsUpdate.status).toBe(200);
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        makeLead({
          businessName: `Recovered Lead ${index}`,
          businessNameNormalized: `recovered lead ${index}`,
          phone: undefined,
        }),
      ),
    );

    const attempts = await Promise.all([
      request(app).post("/api/pipeline/jobs/process").send({}),
      request(app).post("/api/pipeline/jobs/process").send({}),
    ]);
    const started = attempts.find((attempt) => attempt.status === 202)!;
    const overlapping = attempts.find((attempt) => attempt.status === 409)!;
    expect(started.status).toBe(202);
    expect(started.body.job.type).toBe("PROCESS");
    expect(overlapping.status).toBe(409);

    const jobId = started.body.job._id as string;
    let job = started.body.job as { status: string; progress: { processed: number; qualified: number } };
    for (let attempt = 0; attempt < 100 && ["QUEUED", "RUNNING"].includes(job.status); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const polled = await request(app).get(`/api/pipeline/jobs/${jobId}`);
      expect(polled.status).toBe(200);
      job = polled.body.job;
    }

    expect(job.status).toBe("COMPLETED");
    expect(job.progress.processed).toBe(12);
    expect(job.progress.qualified).toBe(12);

    const status = await request(app).get("/api/pipeline/jobs/status");
    expect(status.status).toBe(200);
    expect(status.body.activeJob).toBeNull();
    expect(status.body.discoveredPending).toBe(0);
  });

  it("surfaces a partial run as resumable without rerunning successful queries", async () => {
    await SearchRun.deleteMany({});
    const run = await SearchRun.create({
      trigger: "API",
      status: "PARTIAL",
      plannedQueries: [
        { query: "restaurants in Accra", city: "Accra", category: "restaurants" },
        { query: "salons in Accra", city: "Accra", category: "salons" },
        { query: "hotels in Accra", city: "Accra", category: "hotels" },
      ],
      queries: [
        {
          query: "restaurants in Accra",
          city: "Accra",
          category: "restaurants",
          found: 20,
          created: 20,
          duplicates: 0,
          suppressed: 0,
        },
        {
          query: "salons in Accra",
          city: "Accra",
          category: "salons",
          found: 0,
          created: 0,
          duplicates: 0,
          suppressed: 0,
          error: "Places API rate limited (429)",
        },
      ],
      progress: {
        totalQueries: 3,
        completedQueries: 2,
        successfulQueries: 1,
        failedQueries: 1,
        pendingQueries: 1,
      },
    });

    const status = await request(app).get("/api/pipeline/jobs/status");
    expect(status.status).toBe(200);
    expect(status.body.resumableRun.runId).toBe(String(run._id));
    expect(status.body.resumableRun.recoverableQueries).toBe(2);
  });
});

describe("dismissing the report of a bad run", () => {
  it("hides a partial run once acknowledged, and keeps it hidden", async () => {
    const job = await PipelineJob.create({
      type: "FULL",
      trigger: "MANUAL",
      status: "PARTIAL",
      phase: "COMPLETE",
      progress: {
        current: 5,
        total: 10,
        message: "2 searches failed",
        found: 20,
        created: 5,
        failedQueries: 2,
        processed: 5,
        qualified: 3,
        processingErrors: 0,
        aiFallbacks: 0,
      },
    });

    const before = await request(app).get("/api/pipeline/jobs/status");
    expect(before.body.latestJob._id).toBe(String(job._id));
    expect(before.body.latestJob.acknowledgedAt).toBeUndefined();

    const ack = await request(app).post(`/api/pipeline/jobs/${job._id}/acknowledge`).send({});
    expect(ack.status).toBe(200);
    expect(ack.body.job.acknowledgedAt).toBeTruthy();

    // Reading the status again has to still show it dismissed, because the
    // whole complaint was that the notice came back.
    const after = await request(app).get("/api/pipeline/jobs/status");
    expect(after.body.latestJob.acknowledgedAt).toBeTruthy();
    // Dismissing reports on the run; it does not pretend the run succeeded.
    expect(after.body.latestJob.status).toBe("PARTIAL");
  });

  it("404s for a job that does not exist", async () => {
    const res = await request(app).post("/api/pipeline/jobs/6a6869af2a86a4d3e8a75b3a/acknowledge").send({});
    expect(res.status).toBe(404);
  });
});

/*
 * Last on purpose: this empties the collections the tests above are asserting
 * against, so anything added after it starts from an empty database.
 */
describe("erasing working data", () => {
  it("clears the leads and keeps the settings and the suppression list", async () => {
    await makeLead({ businessName: "Wipe Me", businessNameNormalized: "wipe me", googlePlaceId: "wipe-1" });
    await Suppression.create({ type: "EMAIL", value: "optout@example.com", reason: "asked" });
    const settingsBefore = await getSettings();
    const thresholdBefore = settingsBefore.scoreThreshold;
    // Earlier tests add entries of their own, so the check is that the count
    // does not move, not that it lands on any particular number.
    const suppressionBefore = await Suppression.countDocuments();

    expect(await Lead.countDocuments()).toBeGreaterThan(0);

    const res = await request(app).post("/api/settings/wipe-data").send({});
    expect(res.status).toBe(200);
    expect(res.body.keptSuppression).toBe(true);

    expect(await Lead.countDocuments()).toBe(0);
    expect(await OutreachLog.countDocuments()).toBe(0);
    // The do-not-contact list is the one thing a later scan cannot rebuild.
    expect(await Suppression.countDocuments()).toBe(suppressionBefore);
    expect((await getSettings()).scoreThreshold).toBe(thresholdBefore);
  });

  it("clears the suppression list only when asked explicitly", async () => {
    expect(await Suppression.countDocuments()).toBeGreaterThan(0);
    const res = await request(app).post("/api/settings/wipe-data").send({ includeSuppression: true });
    expect(res.status).toBe(200);
    expect(res.body.keptSuppression).toBe(false);
    expect(await Suppression.countDocuments()).toBe(0);
  });
});

/*
 * The approval queue is one set of leads, counted once.
 *
 * Each of these covers a way the queue used to lose work or misreport it: an
 * approved lead vanishing before it could be sent, a tally that counted leads
 * the list did not show, and a funnel whose steps grew as they went down.
 */
describe("approval queue: work stays visible until it is finished", () => {
  beforeEach(async () => {
    await Promise.all([Lead.deleteMany({}), OutreachLog.deleteMany({})]);
  });

  /** A lead sitting in the queue exactly as the pipeline leaves it. */
  const queued = (overrides: Record<string, unknown> = {}) =>
    makeLead({
      pipelineStage: "PENDING_APPROVAL",
      approval: { status: "PENDING" },
      outreachStatus: "NOT_CONTACTED",
      outreachChannel: "EMAIL",
      email: "hello@crystalscents.ng",
      pitchSubject: "Your website",
      pitchMessage: "A short, specific note about the website.",
      needScore: 70,
      leadScore: 70,
      priorityScore: 70,
      ...overrides,
    });

  const queueRequest = () =>
    request(app)
      .get("/api/leads")
      .query({
        approvalStatus: "PENDING,APPROVED",
        stage: "PENDING_APPROVAL,APPROVED",
        outreachStatus: "NOT_CONTACTED,DRAFT_CREATED",
        hasPitch: "true",
        channel: "EMAIL,INSTAGRAM_MANUAL,WHATSAPP",
        limit: 100,
      });

  it("keeps an approved email lead in the queue so it can still be sent", async () => {
    const lead = await queued();

    const before = await queueRequest();
    expect(before.body.items.map((l: { _id: string }) => l._id)).toContain(String(lead._id));

    const approve = await request(app).post(`/api/leads/${lead._id}/approve`).send({});
    expect(approve.status).toBe(200);
    expect(approve.body.lead.approval.status).toBe("APPROVED");

    // This is the regression: the lead used to drop out here, taking the only
    // Send button in the application with it.
    const after = await queueRequest();
    expect(after.body.items.map((l: { _id: string }) => l._id)).toContain(String(lead._id));
  });

  it("keeps an approved Instagram lead until it is marked contacted", async () => {
    const lead = await queued({
      outreachChannel: "INSTAGRAM_MANUAL",
      email: undefined,
      instagramUsername: "crystalscents",
      pitchSubject: undefined,
    });

    await request(app).post(`/api/leads/${lead._id}/approve`).send({});
    const afterApproval = await queueRequest();
    expect(afterApproval.body.items.map((l: { _id: string }) => l._id)).toContain(String(lead._id));

    const contacted = await request(app)
      .post(`/api/leads/${lead._id}/mark-contacted`)
      .send({ channel: "INSTAGRAM_MANUAL" });
    expect(contacted.status).toBe(200);
    // Sending it is the decision, so the record says a decision was taken.
    expect(contacted.body.lead.approval.status).toBe("APPROVED");

    const afterContact = await queueRequest();
    expect(afterContact.body.items.map((l: { _id: string }) => l._id)).not.toContain(String(lead._id));
  });

  it("a rejected lead leaves the queue", async () => {
    const lead = await queued();
    await request(app).post(`/api/leads/${lead._id}/reject`).send({});
    const after = await queueRequest();
    expect(after.body.items.map((l: { _id: string }) => l._id)).not.toContain(String(lead._id));
  });

  it("the queue tally, the badge figure and the list itself are one number", async () => {
    await queued();
    await queued({ googlePlaceId: `place-${Math.random()}`, businessNameNormalized: "second" });
    // Opted out: counted by the old tally, never shown by the list.
    await queued({ googlePlaceId: `place-${Math.random()}`, businessNameNormalized: "third", optedOut: true });
    // No contact route: its own tab, and deliberately not part of "All".
    await queued({
      googlePlaceId: `place-${Math.random()}`,
      businessNameNormalized: "fourth",
      outreachChannel: "NONE",
      email: undefined,
    });

    const [stats, list] = await Promise.all([request(app).get("/api/stats"), queueRequest()]);
    expect(stats.status).toBe(200);
    expect(list.body.total).toBe(2);
    expect(stats.body.totals.pendingApproval).toBe(list.body.total);

    const byChannel = stats.body.queueByChannel;
    const allTabs = (byChannel.EMAIL ?? 0) + (byChannel.INSTAGRAM_MANUAL ?? 0) + (byChannel.WHATSAPP ?? 0);
    expect(allTabs).toBe(list.body.total);
    expect(byChannel.NONE ?? 0).toBe(1);
  });

  it("a qualified lead with no message yet is not advertised as queue work", async () => {
    await queued({ pipelineStage: "QUALIFIED", approval: { status: "NONE" }, pitchMessage: "" });
    const stats = await request(app).get("/api/stats");
    expect(stats.body.totals.pendingApproval).toBe(0);
  });
});

describe("overview funnel arithmetic", () => {
  beforeEach(async () => {
    await Promise.all([Lead.deleteMany({}), OutreachLog.deleteMany({})]);
  });

  it("never widens as it goes down, however far a lead has travelled", async () => {
    const settings = await getSettings();
    const base = {
      needScore: settings.scoreThreshold + 10,
      leadScore: settings.scoreThreshold + 10,
      pitchMessage: "A note.",
      outreachChannel: "EMAIL",
      email: "a@b.ng",
    };
    // One lead at each point of the journey, including the far end. The far
    // end is what used to break it: a converted lead is no longer "interested"
    // and no longer "contacted", so the middle of the funnel read as empty.
    await makeLead({ ...base, googlePlaceId: "f1", pipelineStage: "PENDING_APPROVAL", approval: { status: "PENDING" } });
    await makeLead({
      ...base,
      googlePlaceId: "f2",
      businessNameNormalized: "f2",
      pipelineStage: "APPROVED",
      approval: { status: "APPROVED" },
    });
    await makeLead({
      ...base,
      googlePlaceId: "f3",
      businessNameNormalized: "f3",
      pipelineStage: "CONTACTED",
      approval: { status: "APPROVED" },
      outreachStatus: "CONVERTED",
      estimatedDealValue: 400000,
    });

    const res = await request(app).get("/api/stats");
    const t = res.body.totals;
    expect(t.discovered).toBeGreaterThanOrEqual(t.qualified);
    expect(t.qualified).toBeGreaterThanOrEqual(t.approved);
    expect(t.approved).toBeGreaterThanOrEqual(t.contacted);
    expect(t.contacted).toBeGreaterThanOrEqual(t.interested);
    expect(t.interested).toBeGreaterThanOrEqual(t.converted);
    expect(t.converted).toBe(1);
    // The converted lead is still counted everywhere above it.
    expect(t.contacted).toBe(1);
    expect(t.interested).toBe(1);
  });

  it("leaves opted-out businesses out of the funnel but still tracks them", async () => {
    await makeLead({ googlePlaceId: "o1", optedOut: true, outreachStatus: "DO_NOT_CONTACT" });
    const res = await request(app).get("/api/stats");
    expect(res.body.totals.total).toBe(1);
    expect(res.body.totals.discovered).toBe(0);
    expect(res.body.totals.optedOut).toBe(1);
  });
});

describe("re-checking a lead that has already been actioned", () => {
  beforeEach(async () => {
    await Promise.all([Lead.deleteMany({}), OutreachLog.deleteMany({})]);
  });

  it("refreshes the audit without pulling a converted client back into the queue", async () => {
    const lead = await makeLead({
      googlePlaceId: "recheck-1",
      pipelineStage: "CONTACTED",
      approval: { status: "APPROVED" },
      outreachStatus: "CONVERTED",
      outreachChannel: "EMAIL",
      email: "owner@crystalscents.ng",
      pitchSubject: "Your website",
      pitchMessage: "The message that was actually sent.",
      estimatedDealValue: 500000,
    });

    const res = await request(app).post(`/api/leads/${lead._id}/recheck`).send({});
    expect(res.status).toBe(200);
    expect(res.body.outreachStatePreserved).toBe(true);

    const after = await Lead.findById(lead._id);
    expect(after?.pipelineStage).toBe("CONTACTED");
    expect(after?.approval.status).toBe("APPROVED");
    expect(after?.outreachStatus).toBe("CONVERTED");
    // The sent message is history, not a draft to be overwritten.
    expect(after?.pitchMessage).toBe("The message that was actually sent.");
    // The point of the re-check still happened.
    expect(after?.scoredAt).toBeTruthy();
  });

  it("still runs the whole flow for a lead nobody has acted on", async () => {
    const lead = await makeLead({ googlePlaceId: "recheck-2", pipelineStage: "DISCOVERED" });
    const res = await request(app).post(`/api/leads/${lead._id}/recheck`).send({});
    expect(res.status).toBe(200);
    expect(res.body.outreachStatePreserved).toBe(false);
    const after = await Lead.findById(lead._id);
    expect(after?.pipelineStage).not.toBe("DISCOVERED");
  });
});

describe("leads that stopped moving are still reported", () => {
  beforeEach(async () => {
    await Lead.deleteMany({});
  });

  it("counts leads nothing retries any more, and a re-check puts one back in circulation", async () => {
    const lead = await makeLead({
      googlePlaceId: "stalled-1",
      pipelineStage: "DISCOVERED",
      processingAttempts: 3,
      lastProcessingError: "AI provider unavailable",
    });

    const before = await request(app).get("/api/pipeline/jobs/status");
    expect(before.status).toBe(200);
    expect(before.body.stalledLeads).toBe(1);
    // It is deliberately absent from the button that offers to process leads,
    // because that button cannot finish it. That is why it needs its own count.
    expect(before.body.discoveredPending).toBe(0);

    const recheck = await request(app).post(`/api/leads/${lead._id}/recheck`).send({});
    expect(recheck.status).toBe(200);

    const after = await request(app).get("/api/pipeline/jobs/status");
    expect(after.body.stalledLeads).toBe(0);
    const reloaded = await Lead.findById(lead._id);
    expect(reloaded?.processingAttempts).toBe(0);
    expect(reloaded?.lastProcessingError).toBeFalsy();
  });
});

describe("a bounced email leaves the lead workable", () => {
  beforeEach(async () => {
    await Promise.all([Lead.deleteMany({}), OutreachLog.deleteMany({})]);
  });

  const contacted = (overrides: Record<string, unknown> = {}) =>
    makeLead({
      googlePlaceId: `bounce-${Math.random().toString(36).slice(2)}`,
      pipelineStage: "CONTACTED",
      approval: { status: "APPROVED" },
      outreachStatus: "CONTACTED",
      outreachChannel: "EMAIL",
      email: "wrong@crystalscents.ng",
      pitchSubject: "Your website",
      pitchMessage: "A short, specific note.",
      timesContacted: 1,
      needScore: 70,
      leadScore: 70,
      ...overrides,
    });

  it("retires the dead address and re-routes the lead to a channel that works", async () => {
    const lead = await contacted({ instagramUsername: "crystalscents" });

    const res = await request(app).post(`/api/leads/${lead._id}/response`).send({ status: "BOUNCED" });
    expect(res.status).toBe(200);

    const after = await Lead.findById(lead._id);
    expect(after?.email).toBeFalsy();
    expect(after?.bouncedEmails).toContain("wrong@crystalscents.ng");
    // There is another way in, so the lead is work again rather than a dead end.
    expect(after?.outreachChannel).toBe("INSTAGRAM_MANUAL");
    expect(after?.pipelineStage).toBe("PENDING_APPROVAL");
    expect(after?.approval.status).toBe("PENDING");
    // The message never arrived, so it does not count against the attempts
    // the follow-up policy allows, and the bounce is not held against the
    // business as if they had replied.
    expect(after?.timesContacted).toBe(0);
    expect(after?.responseStatus).toBe("NONE");

    const queue = await request(app).get("/api/leads").query({
      approvalStatus: "PENDING,APPROVED",
      stage: "PENDING_APPROVAL,APPROVED",
      outreachStatus: "NOT_CONTACTED,DRAFT_CREATED",
      hasPitch: "true",
      channel: "EMAIL,INSTAGRAM_MANUAL,WHATSAPP",
    });
    expect(queue.body.items.map((l: { _id: string }) => l._id)).toContain(String(lead._id));
  });

  it("with no other route it lands under 'no route' rather than vanishing", async () => {
    const lead = await contacted({ phone: undefined });

    await request(app).post(`/api/leads/${lead._id}/response`).send({ status: "BOUNCED" });

    const after = await Lead.findById(lead._id);
    expect(after?.outreachChannel).toBe("NONE");
    expect(after?.pipelineStage).toBe("PENDING_APPROVAL");

    const stats = await request(app).get("/api/stats");
    expect(stats.body.queueByChannel.NONE).toBe(1);
    // Not counted as contacted: nobody read it.
    expect(stats.body.totals.contacted).toBe(0);
  });

  it("does not let enrichment put the same dead address back on the lead", async () => {
    const lead = await contacted();
    await request(app).post(`/api/leads/${lead._id}/response`).send({ status: "BOUNCED" });

    // A corrected address typed by hand is accepted, and takes effect at once.
    const patched = await request(app)
      .patch(`/api/leads/${lead._id}`)
      .send({ email: "owner@crystalscents.ng" });
    expect(patched.status).toBe(200);
    expect(patched.body.lead.outreachChannel).toBe("EMAIL");

    const after = await Lead.findById(lead._id);
    expect(after?.bouncedEmails).toContain("wrong@crystalscents.ng");
  });
});

describe("adding a contact by hand restores the route immediately", () => {
  beforeEach(async () => {
    await Lead.deleteMany({});
  });

  it("moves a lead out of 'no route' as soon as an address is added", async () => {
    const lead = await makeLead({
      googlePlaceId: "noroute-1",
      phone: undefined,
      pipelineStage: "PENDING_APPROVAL",
      approval: { status: "PENDING" },
      outreachChannel: "NONE",
      pitchMessage: "A short, specific note.",
      needScore: 70,
      leadScore: 70,
    });

    const res = await request(app).patch(`/api/leads/${lead._id}`).send({ email: "hello@crystalscents.ng" });
    expect(res.status).toBe(200);
    expect(res.body.lead.outreachChannel).toBe("EMAIL");

    const stats = await request(app).get("/api/stats");
    expect(stats.body.totals.pendingApproval).toBe(1);
    expect(stats.body.queueByChannel.NONE ?? 0).toBe(0);
  });

  it("an explicit channel in the same request still wins", async () => {
    const lead = await makeLead({ googlePlaceId: "noroute-2", outreachChannel: "NONE" });
    const res = await request(app)
      .patch(`/api/leads/${lead._id}`)
      .send({ email: "hello@crystalscents.ng", outreachChannel: "WHATSAPP" });
    expect(res.body.lead.outreachChannel).toBe("WHATSAPP");
  });
});

describe("today's sending budget is reported before it is spent", () => {
  beforeEach(async () => {
    await Promise.all([Lead.deleteMany({}), OutreachLog.deleteMany({})]);
  });

  it("counts against the configured cap", async () => {
    const settings = await getSettings();
    const lead = await makeLead({ googlePlaceId: "cap-1" });
    await OutreachLog.create({ leadId: lead._id, channel: "EMAIL", direction: "OUTBOUND", action: "SENT" });

    const res = await request(app).get("/api/stats");
    expect(res.body.email.dailyCap).toBe(settings.dailyEmailCap);
    expect(res.body.email.sentToday).toBe(1);
    expect(res.body.email.remaining).toBe(Math.max(0, settings.dailyEmailCap - 1));
  });
});

describe("the attempt limit means the same thing everywhere", () => {
  beforeEach(async () => {
    await Lead.deleteMany({});
  });

  it("a lead that has failed three times is not picked up by a processing run", async () => {
    const stalled = await makeLead({
      googlePlaceId: "limit-1",
      pipelineStage: "DISCOVERED",
      processingAttempts: 3,
      lastProcessingError: "boom",
    });

    const res = await request(app).post("/api/pipeline/process").send({});
    expect(res.status).toBe(200);
    // Untouched: the dashboard says these are no longer retried, so they must
    // not be, or every run spends its budget on leads that cannot succeed.
    expect(res.body.processed).toBe(0);
    const after = await Lead.findById(stalled._id);
    expect(after?.pipelineStage).toBe("DISCOVERED");
  });
});

describe("importing while the pipeline is busy", () => {
  beforeEach(async () => {
    await Promise.all([Lead.deleteMany({}), PipelineLease.deleteMany({})]);
  });

  afterAll(async () => {
    if (dbAvailable) await PipelineLease.deleteMany({});
  });

  it("saves the leads and says so, rather than failing the whole import", async () => {
    // A scan holding the processing lease is the ordinary case: the operator
    // pastes a list while the morning run is still going.
    await PipelineLease.create({ _id: "processing", owner: "someone-else", expiresAt: new Date(Date.now() + 60_000) });

    const res = await request(app)
      .post("/api/pipeline/import")
      .send({ items: [{ businessName: "Busy Import Co", city: "Lagos", email: "hi@busyimport.ng" }] });

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    // The audit could not start, and that is reported beside the import.
    expect(res.body.processingError).toBeTruthy();
    expect(await Lead.countDocuments({ businessName: "Busy Import Co" })).toBe(1);
  });
});

describe("numbers already stamped with the wrong country", () => {
  beforeEach(async () => {
    await Lead.deleteMany({});
  });

  it("are put right by the repair sweep, since re-discovery leaves a known lead alone", async () => {
    // What a multi-country scan produced before: an American number read as a
    // Nigerian one, because both national forms are ten digits.
    const wrong = await makeLead({
      googlePlaceId: "stamp-1",
      businessName: "Golden Gate Grill",
      businessNameNormalized: "golden gate grill",
      city: "San Francisco",
      address: "500 Market St, San Francisco, CA, United States",
      phone: "(415) 555-2671",
      phoneNormalized: "+2344155552671",
      whatsappAvailable: true,
      outreachChannel: "WHATSAPP",
      pipelineStage: "PENDING_APPROVAL",
      approval: { status: "PENDING" },
      pitchMessage: "A note.",
    });

    const result = await repairOutreachChannels();
    expect(result.corrected).toBeGreaterThan(0);

    const after = await Lead.findById(wrong._id);
    expect(after?.phoneNormalized).toBe("+14155552671");
    // A US number cannot be told apart from a landline, so it is offered as a
    // phone contact rather than claimed as a WhatsApp one.
    expect(after?.outreachChannel).toBe("NONE");
  });

  it("leaves a number that states its own country alone", async () => {
    const visiting = await makeLead({
      googlePlaceId: "stamp-2",
      businessNameNormalized: "visiting",
      address: "1 Adeola Odeku St, Lagos, Nigeria",
      phone: "+233 24 123 4567",
      phoneNormalized: "+233241234567",
      pipelineStage: "PENDING_APPROVAL",
      approval: { status: "PENDING" },
      pitchMessage: "A note.",
    });

    await repairOutreachChannels();
    const after = await Lead.findById(visiting._id);
    expect(after?.phoneNormalized).toBe("+233241234567");
  });

  it("leaves a correctly stamped local number alone", async () => {
    const fine = await makeLead({
      googlePlaceId: "stamp-3",
      businessNameNormalized: "fine",
      address: "12 Trans Amadi Rd, Port Harcourt, Rivers, Nigeria",
      phone: "0803 123 4567",
      phoneNormalized: "+2348031234567",
      pipelineStage: "PENDING_APPROVAL",
      approval: { status: "PENDING" },
      pitchMessage: "A note.",
    });

    await repairOutreachChannels();
    const after = await Lead.findById(fine._id);
    expect(after?.phoneNormalized).toBe("+2348031234567");
    expect(after?.outreachChannel).toBe("WHATSAPP");
  });
});

describe("a message written for the wrong channel", () => {
  beforeEach(async () => {
    await Lead.deleteMany({});
  });

  const LETTER = "Hello Crystal Scents,\n\nA note about your website.\n\nKind regards,\nThe YEAN Technologies team";

  it("is sent back to be rewritten when the lead goes out on a chat channel", async () => {
    const lead = await makeLead({
      googlePlaceId: "shape-1",
      pipelineStage: "PENDING_APPROVAL",
      approval: { status: "PENDING" },
      outreachChannel: "WHATSAPP",
      whatsappAvailable: true,
      phone: "0803 123 4567",
      phoneNormalized: "+2348031234567",
      pitchSubject: "Your website",
      pitchMessage: LETTER,
      needScore: 70,
      leadScore: 70,
    });

    const result = await repairOutreachChannels();
    expect(result.rewritten).toBe(1);

    const after = await Lead.findById(lead._id);
    // Back to the stage the drafting pass looks for, which runs next in the
    // same processing pass, so the queue is never seen without it.
    expect(after?.pipelineStage).toBe("QUALIFIED");
    expect(after?.pitchMessage).toBeFalsy();
  });

  it("leaves an email lead's letter exactly where it is", async () => {
    const lead = await makeLead({
      googlePlaceId: "shape-2",
      businessNameNormalized: "shape2",
      pipelineStage: "PENDING_APPROVAL",
      approval: { status: "PENDING" },
      outreachChannel: "EMAIL",
      email: "hello@crystalscents.ng",
      pitchMessage: LETTER,
      needScore: 70,
      leadScore: 70,
    });

    const result = await repairOutreachChannels();
    expect(result.rewritten).toBe(0);
    expect((await Lead.findById(lead._id))?.pitchMessage).toBe(LETTER);
  });

  it("leaves a chat lead that already has a chat message alone, so it settles", async () => {
    const chat = "Hello Crystal Scents,\n\nA short note.\n\nYEAN Technologies";
    const lead = await makeLead({
      googlePlaceId: "shape-3",
      businessNameNormalized: "shape3",
      pipelineStage: "PENDING_APPROVAL",
      approval: { status: "PENDING" },
      outreachChannel: "WHATSAPP",
      whatsappAvailable: true,
      phone: "0803 123 4567",
      phoneNormalized: "+2348031234567",
      pitchMessage: chat,
      needScore: 70,
      leadScore: 70,
    });

    // Twice, because a rule that rewrites on every pass would spend an AI call
    // per lead per scan and never converge.
    await repairOutreachChannels();
    const second = await repairOutreachChannels();
    expect(second.rewritten).toBe(0);
    expect((await Lead.findById(lead._id))?.pitchMessage).toBe(chat);
  });
});


/**
 * Leads that came out of a scan run before an AI provider was connected.
 *
 * They are the awkward case because nothing else in the pipeline can see them:
 * they have a message, so the "waiting for a message" count skips them, and it
 * is a perfectly valid message, so no error was ever recorded against them.
 */
describe("rewriting built-in template messages", () => {
  async function templateLead(overrides: Record<string, unknown> = {}) {
    return makeLead({
      pipelineStage: "PENDING_APPROVAL",
      approval: { status: "PENDING" },
      outreachStatus: "NOT_CONTACTED",
      outreachChannel: "EMAIL",
      email: "hello@example.com",
      websiteType: "NO_WEBSITE",
      pitchSubject: "A website for Crystal Scents",
      pitchMessage: "Hello Crystal Scents, ...",
      // What generatePitch writes when no provider is configured. Crucially it
      // records no failure reason, because nothing failed.
      pitchModel: "template/builtin",
      needScore: 70,
      leadScore: 70,
      ...overrides,
    });
  }

  beforeEach(async () => {
    await Lead.deleteMany({});
    await PipelineJob.deleteMany({});
    await PipelineLease.deleteMany({});
  });

  it("finds template messages that recorded no failure reason", async () => {
    await templateLead();
    expect(await Lead.countDocuments(templatePitchFilter())).toBe(1);
  });

  it("leaves AI-written messages alone", async () => {
    await templateLead({ pitchModel: "openai/gpt-4o-mini" });
    expect(await Lead.countDocuments(templatePitchFilter())).toBe(0);
  });

  it("picks up a message the AI tried and failed to write", async () => {
    await templateLead({ pitchModel: "template/builtin", pitchFallbackReason: "429 rate limited" });
    expect(await Lead.countDocuments(templatePitchFilter())).toBe(1);
  });

  /*
   * The one that matters most. A sent message is a record of what was said to
   * a business, and an approved one is a statement about wording somebody has
   * read. Rewriting either underneath the operator would be silent damage.
   */
  it("never touches a message that has been sent or approved", async () => {
    await templateLead({ outreachStatus: "CONTACTED", businessNameNormalized: "sent" });
    await templateLead({ approval: { status: "APPROVED" }, businessNameNormalized: "approved" });
    await templateLead({ optedOut: true, businessNameNormalized: "opted out" });
    expect(await Lead.countDocuments(templatePitchFilter())).toBe(0);
  });

  it("scopes to the chosen categories, case-insensitively", async () => {
    await templateLead({ category: "Perfume Stores", businessNameNormalized: "a" });
    await templateLead({ category: "restaurants", businessNameNormalized: "b" });

    expect(await Lead.countDocuments(templatePitchFilter({ categories: ["perfume stores"] }))).toBe(1);
    expect(await Lead.countDocuments(templatePitchFilter({ categories: ["restaurants"] }))).toBe(1);
    expect(await Lead.countDocuments(templatePitchFilter({ categories: ["hotels"] }))).toBe(0);
  });

  /*
   * The summary exists to answer "what will this cost", and cost is calls, not
   * leads. Three leads in one situation is one call; the fourth carries its own
   * Instagram detail, is never grouped, and so costs a call of its own.
   */
  it("counts AI calls per situation rather than per lead", async () => {
    for (const name of ["a", "b", "c"]) {
      await templateLead({ businessNameNormalized: name, category: "perfume stores" });
    }
    await templateLead({
      businessNameNormalized: "d",
      category: "perfume stores",
      instagramBio: "Niche fragrances, Port Harcourt. DM to order.",
    });

    const summary = await templatePitchSummary();
    const row = summary.categories.find((entry) => entry.category.toLowerCase() === "perfume stores");
    expect(row?.leads).toBe(4);
    expect(row?.situations).toBe(1);
    expect(row?.individual).toBe(1);
    expect(row?.aiCalls).toBe(2);
    expect(summary.total).toBe(4);
  });

  it("splits one category into separate situations per website problem", async () => {
    await templateLead({ businessNameNormalized: "a", websiteType: "NO_WEBSITE" });
    await templateLead({ businessNameNormalized: "b", websiteType: "SOCIAL_MEDIA_ONLY" });

    const summary = await templatePitchSummary();
    const row = summary.categories.find((entry) => entry.category.toLowerCase() === "perfume stores");
    expect(row?.leads).toBe(2);
    expect(row?.situations).toBe(2);
  });

  /*
   * The scope reaches the preview too, which goes through an aggregation
   * rather than a find. The case-insensitive match is a regex inside $in, and
   * that is worth proving on the aggregation path rather than assuming it
   * behaves the same as the count above.
   */
  it("scopes the preview as well as the count", async () => {
    await templateLead({ businessNameNormalized: "a", category: "Perfume Stores" });
    await templateLead({ businessNameNormalized: "b", category: "restaurants" });

    const scoped = await templatePitchSummary({ categories: ["PERFUME STORES"] });
    expect(scoped.total).toBe(1);
    expect(scoped.categories).toHaveLength(1);

    const byCity = await templatePitchSummary({ cities: ["port harcourt"] });
    expect(byCity.total).toBe(2);
    expect(await templatePitchSummary({ cities: ["Kano"] })).toMatchObject({ total: 0 });
  });

  /*
   * With no provider configured the rewrite produces the built-in template
   * again. Saving that would move pitchGeneratedAt, clear the trail and report
   * a pile of leads "rewritten" without a word of them having changed.
   */
  it("leaves a lead untouched when the writer returns the template again", async () => {
    const lead = await templateLead();
    const before = (await Lead.findById(lead._id))?.pitchMessage;

    const result = await rewriteTemplatePitches();
    expect(result.matched).toBe(1);
    expect(result.rewritten).toBe(0);
    expect(result.stillTemplate).toBe(1);

    const after = await Lead.findById(lead._id);
    expect(after?.pitchMessage).toBe(before);
    expect(after?.pitchGeneratedAt).toBeUndefined();
  });

  /*
   * The whole claim of the feature, and the only test that can check it: one
   * AI call serves every lead in a situation, and each of them still comes out
   * addressed to its own business.
   */
  it("buys one message per situation and personalises it per lead", async () => {
    // Restored exactly afterwards: the rest of the suite runs with no provider
    // configured, and leaving one behind would change what it is testing.
    const before = (await getSettings()).integrations?.ai;
    await Settings.updateOne(
      { key: "global" },
      { $set: { "integrations.ai.provider": "OPENAI", "integrations.ai.apiKey": "test-key", "integrations.ai.model": "gpt-4o-mini" } },
    );

    const prompts: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      prompts.push(String(init?.body ?? ""));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  observation: "Shops like this are hard to find online.",
                  subject: "A website for {{business}}",
                  message: "Hello {{business}},\n\nWe work with shops in {{city}}. Shall we talk?",
                }),
              },
            },
          ],
        }),
        text: async () => "",
      } as unknown as Response;
    }) as typeof fetch;

    try {
      const shared = ["Alpha Scents", "Beta Scents", "Gamma Scents"];
      for (const name of shared) {
        await templateLead({ businessName: name, businessNameNormalized: name.toLowerCase(), city: "Lagos" });
      }
      // A different category is a different situation, so it buys its own.
      await templateLead({
        businessName: "Delta Grill",
        businessNameNormalized: "delta grill",
        category: "restaurants",
        city: "Abuja",
      });

      const result = await rewriteTemplatePitches();

      expect(result.rewritten).toBe(4);
      expect(result.stillTemplate).toBe(0);
      // Two situations, so two calls for four leads, and the other three
      // messages were served from the group.
      expect(prompts.length).toBe(2);
      expect(result.aiCalls).toBe(2);
      expect(result.reusedMessages).toBe(2);

      for (const name of shared) {
        const lead = await Lead.findOne({ businessName: name });
        expect(lead?.pitchMessage).toContain(name);
        expect(lead?.pitchMessage).toContain("Lagos");
        // Nothing may ship with an unfilled placeholder in it.
        expect(lead?.pitchMessage).not.toContain("{{");
        expect(lead?.pitchModel).toBe("openai/gpt-4o-mini");
        expect(lead?.pitchShared).toBe(true);
      }

      const grill = await Lead.findOne({ businessName: "Delta Grill" });
      expect(grill?.pitchMessage).toContain("Delta Grill");
      expect(grill?.pitchMessage).toContain("Abuja");

      // Rewritten leads are no longer part of the backlog.
      expect(await Lead.countDocuments(templatePitchFilter())).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
      await Settings.updateOne(
        { key: "global" },
        {
          $set: {
            "integrations.ai.provider": before?.provider ?? "AUTO",
            "integrations.ai.apiKey": before?.apiKey ?? "",
            "integrations.ai.model": before?.model ?? "",
          },
        },
      );
    }
  });

  it("refuses to start a job when the selection matches nothing", async () => {
    await templateLead({ category: "perfume stores" });
    const res = await request(app)
      .post("/api/pipeline/jobs/rewrite-pitches")
      .send({ categories: ["hotels"] });
    expect(res.status).toBe(409);
    // Refusing early must not leave the lock taken for the next scan.
    expect(await PipelineJob.countDocuments({ activeKey: "pipeline" })).toBe(0);
  });

  it("reports the backlog on the operations status", async () => {
    await templateLead();
    const res = await request(app).get("/api/pipeline/jobs/status");
    expect(res.status).toBe(200);
    expect(res.body.templatePitchPending).toBe(1);
    // It has a message, so it is not "waiting for one".
    expect(res.body.pitchPending).toBe(0);
  });

  it("serves the preview over HTTP", async () => {
    await templateLead({ businessNameNormalized: "a" });
    await templateLead({ businessNameNormalized: "b" });
    const res = await request(app).get("/api/pipeline/template-pitches");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.aiCalls).toBe(1);
  });
});
