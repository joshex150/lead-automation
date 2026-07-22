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
import { getSettings } from "../src/models/Settings.js";
import { processLead } from "../src/services/pipeline/runPipeline.js";
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
    await Promise.all([Lead.deleteMany({}), Suppression.deleteMany({}), OutreachLog.deleteMany({})]);
    await getSettings();
    app = createApp();
  } catch (err) {
    dbAvailable = false;
    // eslint-disable-next-line no-console
    console.warn(
      "\n[integration] No MongoDB available, skipping integration suite.\n" +
        "Set TEST_MONGODB_URI to a MongoDB-compatible server to run it.\n" +
        `Reason: ${err instanceof Error ? err.message : String(err)}\n`,
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
    expect(res.body.settings.scoringWeights.noWebsite).toBe(40);
  });

  it("updates cities, threshold and weights", async () => {
    const res = await request(app)
      .put("/api/settings")
      .send({ cities: ["Lagos", "Enugu"], scoreThreshold: 45, scoringWeights: { shopifyWebsite: 20 } });
    expect(res.status).toBe(200);
    expect(res.body.settings.cities).toEqual(["Lagos", "Enugu"]);
    expect(res.body.settings.scoreThreshold).toBe(45);
    expect(res.body.settings.scoringWeights.shopifyWebsite).toBe(20);
    // untouched weights preserved
    expect(res.body.settings.scoringWeights.noWebsite).toBe(40);

    // reset for later tests
    await request(app).post("/api/settings/reset");
  });

  it("rejects invalid updates", async () => {
    const res = await request(app).put("/api/settings").send({ cities: [] });
    expect(res.status).toBe(400);
  });
});

describe("lead lifecycle", () => {
  it("full offline pipeline: NO_WEBSITE lead → scored → pitched → pending approval", async () => {
    const lead = await makeLead({ businessName: "Amara Kitchen", businessNameNormalized: "amara kitchen", category: "restaurants", city: "Lagos" });
    // no websiteUrl → NO_WEBSITE (+40), phone is mobile → whatsapp (+10) = 50 ≥ 50
    const outcome = await processLead(lead);

    expect(outcome.websiteType).toBe("NO_WEBSITE");
    expect(outcome.score).toBe(50);
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
    expect(res.body.items.every((l: { leadScore: number }) => l.leadScore >= 40)).toBe(true);

    const search = await request(app).get("/api/leads?search=amara");
    expect(search.body.items.some((l: { businessName: string }) => l.businessName === "Amara Kitchen")).toBe(true);
  });

  it("PATCH edits contact info, records provenance, and rescores", async () => {
    const lead = await makeLead({ businessName: "Patch Target", businessNameNormalized: "patch target" });
    await processLead(lead); // NO_WEBSITE +40, whatsapp +10 = 50

    const res = await request(app)
      .patch(`/api/leads/${lead._id}`)
      .send({ email: "owner@patchtarget.ng", instagramActive: true });
    expect(res.status).toBe(200);
    // +40 (no site) +10 (wa) +15 (email) +15 (active IG) = 80
    expect(res.body.lead.leadScore).toBe(80);
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
});

describe("pipeline safety", () => {
  it("discovery without a Places key returns 503, not a crash", async () => {
    const res = await request(app).post("/api/pipeline/discover").send({});
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/Places API key/i);
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
