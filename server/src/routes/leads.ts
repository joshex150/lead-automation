import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { Lead } from "../models/Lead.js";
import { OutreachLog } from "../models/OutreachLog.js";
import { getSettings } from "../models/Settings.js";
import { asyncHandler, validateBody } from "../middleware/index.js";
import { processLead } from "../services/pipeline/runPipeline.js";
import { generatePitch, pitchContextFromLead } from "../services/pitch/generatePitch.js";
import { scoreLead } from "../services/scoring/leadScore.js";
import { optOutLead } from "../services/suppression.js";
import { createDraftForLead, emailsSentToday, getActiveEmail, sendPitchForLead } from "../services/outreach/email/index.js";
import { normalizeNigerianPhone } from "../utils/phone.js";

export const leadsRouter = Router();

/** GET /api/leads, filterable, paginated list. */
leadsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        stage: z.string().optional(),
        approvalStatus: z.string().optional(),
        outreachStatus: z.string().optional(),
        websiteType: z.string().optional(),
        city: z.string().optional(),
        category: z.string().optional(),
        channel: z.string().optional(),
        minScore: z.coerce.number().optional(),
        search: z.string().optional(),
        sort: z.enum(["score", "-score", "created", "-created", "name"]).default("-score"),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(25),
      })
      .parse(req.query);

    const filter: Record<string, unknown> = {};
    if (q.stage) filter.pipelineStage = { $in: q.stage.split(",") };
    if (q.approvalStatus) filter["approval.status"] = q.approvalStatus;
    if (q.outreachStatus) filter.outreachStatus = { $in: q.outreachStatus.split(",") };
    if (q.websiteType) filter.websiteType = { $in: q.websiteType.split(",") };
    if (q.city) filter.city = q.city;
    if (q.category) filter.category = q.category;
    if (q.channel) filter.outreachChannel = q.channel;
    if (q.minScore != null) filter.leadScore = { $gte: q.minScore };
    if (q.search) {
      filter.$or = [
        { businessName: { $regex: q.search, $options: "i" } },
        { email: { $regex: q.search, $options: "i" } },
        { instagramUsername: { $regex: q.search, $options: "i" } },
      ];
    }

    const sortMap: Record<string, Record<string, 1 | -1>> = {
      score: { leadScore: 1 },
      "-score": { leadScore: -1 },
      created: { createdAt: 1 },
      "-created": { createdAt: -1 },
      name: { businessName: 1 },
    };

    const [items, total] = await Promise.all([
      Lead.find(filter)
        .sort(sortMap[q.sort])
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      Lead.countDocuments(filter),
    ]);

    res.json({ items, total, page: q.page, pages: Math.ceil(total / q.limit) });
  }),
);

function loadLead(id: string) {
  if (!mongoose.isValidObjectId(id)) return null;
  return Lead.findById(id);
}

/** GET /api/leads/:id, full lead + outreach history. */
leadsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const lead = await loadLead(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    const history = await OutreachLog.find({ leadId: lead._id }).sort({ createdAt: -1 }).limit(50).lean();
    res.json({ lead, history });
  }),
);

const updateSchema = z
  .object({
    businessName: z.string().min(1).optional(),
    category: z.string().optional(),
    city: z.string().optional(),
    email: z.string().email().nullable().optional(),
    phone: z.string().nullable().optional(),
    instagramUsername: z.string().nullable().optional(),
    instagramBio: z.string().nullable().optional(),
    instagramActive: z.boolean().optional(),
    strongVisualBrand: z.boolean().optional(),
    recentPostSummary: z.string().nullable().optional(),
    websiteUrl: z.string().nullable().optional(),
    pitchSubject: z.string().optional(),
    pitchMessage: z.string().optional(),
    personalisedObservation: z.string().optional(),
    outreachChannel: z.enum(["EMAIL", "INSTAGRAM_MANUAL", "WHATSAPP", "NONE"]).optional(),
    estimatedDealValue: z.number().nullable().optional(),
    notes: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
  })
  .strict();

/** PATCH /api/leads/:id, manual edits (pitch, contacts, IG confirmation …). */
leadsRouter.patch(
  "/:id",
  validateBody(updateSchema),
  asyncHandler(async (req, res) => {
    const lead = await loadLead(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });

    const body = req.body as z.infer<typeof updateSchema>;
    const manualContactFields: Array<{ field: "email" | "phone" | "instagram"; value: string | null | undefined }> = [
      { field: "email", value: body.email },
      { field: "phone", value: body.phone },
      { field: "instagram", value: body.instagramUsername },
    ];

    Object.assign(lead, body);

    if (body.phone !== undefined) {
      lead.phoneNormalized = normalizeNigerianPhone(body.phone) ?? undefined;
    }
    if (body.instagramUsername) {
      lead.instagramUrl = `https://instagram.com/${body.instagramUsername.replace(/^@/, "")}`;
    }

    // Record provenance for manually added contact data.
    for (const { field, value } of manualContactFields) {
      if (value) {
        lead.contactSources.push({ field, value, source: "manual", collectedAt: new Date() });
      }
    }

    // Re-score if signal fields changed.
    if (
      body.email !== undefined ||
      body.instagramActive !== undefined ||
      body.strongVisualBrand !== undefined ||
      body.phone !== undefined
    ) {
      const settings = await getSettings();
      const scoreResult = scoreLead(
        {
          websiteType: lead.websiteType,
          hasEmail: Boolean(lead.email),
          whatsappAvailable: lead.whatsappAvailable,
          openingSoon: lead.openingSoon,
          instagramActive: lead.instagramActive,
          strongVisualBrand: lead.strongVisualBrand,
        },
        settings.scoringWeights,
        settings.scoreThreshold,
      );
      lead.leadScore = scoreResult.score;
      lead.scoreBreakdown = scoreResult.breakdown;
      lead.scoredAt = new Date();
    }

    await lead.save();
    res.json({ lead });
  }),
);

/** POST /api/leads/:id/approve, approve pitch; creates Gmail draft when possible. */
leadsRouter.post(
  "/:id/approve",
  asyncHandler(async (req, res) => {
    const lead = await loadLead(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    if (lead.optedOut) return res.status(409).json({ error: "Lead has opted out, cannot approve" });
    if (!lead.pitchMessage) return res.status(409).json({ error: "Lead has no pitch to approve" });

    lead.approval.status = "APPROVED";
    lead.approval.reviewedAt = new Date();
    lead.approval.reviewedBy = (req.body?.reviewedBy as string) ?? "dashboard";
    lead.approval.notes = (req.body?.notes as string) ?? undefined;
    lead.pipelineStage = "APPROVED";

    let draft: { draftId: string | null; provider: string; internal: boolean } | null = null;
    let draftError: string | null = null;
    if (lead.outreachChannel === "EMAIL" && lead.email) {
      const { provider } = await getActiveEmail();
      if (provider) {
        try {
          draft = await createDraftForLead(lead);
          if (draft.draftId) lead.gmailDraftId = draft.draftId;
          lead.outreachStatus = "DRAFT_CREATED";
        } catch (err) {
          draftError = err instanceof Error ? err.message : String(err);
        }
      } else {
        draftError = "No email provider configured, approve recorded, draft not created";
      }
    }

    await lead.save();
    await OutreachLog.create({
      leadId: lead._id,
      channel: "SYSTEM",
      direction: "INTERNAL",
      action: "APPROVED",
      meta: { reviewedBy: lead.approval.reviewedBy, draftId: draft?.draftId, draftError },
    });

    res.json({ lead, draft, draftError });
  }),
);

/** POST /api/leads/:id/reject, reject the pitch / lead. */
leadsRouter.post(
  "/:id/reject",
  asyncHandler(async (req, res) => {
    const lead = await loadLead(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });

    lead.approval.status = "REJECTED";
    lead.approval.reviewedAt = new Date();
    lead.approval.reviewedBy = (req.body?.reviewedBy as string) ?? "dashboard";
    lead.approval.notes = (req.body?.notes as string) ?? undefined;
    lead.pipelineStage = "REJECTED";
    await lead.save();

    await OutreachLog.create({
      leadId: lead._id,
      channel: "SYSTEM",
      direction: "INTERNAL",
      action: "REJECTED",
      meta: { reviewedBy: lead.approval.reviewedBy, notes: lead.approval.notes },
    });

    res.json({ lead });
  }),
);

/** POST /api/leads/:id/send, send the approved email (draft or direct). */
leadsRouter.post(
  "/:id/send",
  asyncHandler(async (req, res) => {
    const lead = await loadLead(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    if (lead.optedOut) return res.status(409).json({ error: "Lead has opted out, cannot send" });
    if (lead.approval.status !== "APPROVED") {
      return res.status(409).json({ error: "Lead must be approved before sending" });
    }
    if (!lead.email) return res.status(409).json({ error: "Lead has no email address" });
    const { provider } = await getActiveEmail();
    if (!provider) {
      return res.status(503).json({ error: "No email provider is configured (Settings → Email)" });
    }

    const settings = await getSettings();
    const sentToday = await emailsSentToday();
    if (sentToday >= settings.dailyEmailCap) {
      return res.status(429).json({ error: `Daily email cap reached (${settings.dailyEmailCap})` });
    }

    const sendResult = await sendPitchForLead(lead);
    lead.gmailDraftId = undefined;

    const now = new Date();
    lead.gmailMessageId = sendResult.messageId;
    lead.gmailThreadId = sendResult.threadId;
    lead.outreachStatus = "CONTACTED";
    lead.pipelineStage = "CONTACTED";
    lead.timesContacted += 1;
    lead.lastContactedAt = now;
    lead.followUpAt = new Date(now.getTime() + settings.followUpDays * 24 * 60 * 60 * 1000);
    await lead.save();

    await OutreachLog.create({
      leadId: lead._id,
      channel: "EMAIL",
      direction: "OUTBOUND",
      action: "SENT",
      subject: lead.pitchSubject,
      message: lead.pitchMessage,
      meta: sendResult,
    });

    res.json({ lead, sent: sendResult });
  }),
);

/** POST /api/leads/:id/mark-contacted, manual Instagram/WhatsApp outreach done. */
leadsRouter.post(
  "/:id/mark-contacted",
  asyncHandler(async (req, res) => {
    const lead = await loadLead(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    if (lead.optedOut) return res.status(409).json({ error: "Lead has opted out" });

    const channel = (req.body?.channel as string) === "WHATSAPP" ? "WHATSAPP" : "INSTAGRAM_MANUAL";
    const settings = await getSettings();
    const now = new Date();

    lead.outreachChannel = channel;
    lead.outreachStatus = "CONTACTED";
    lead.pipelineStage = "CONTACTED";
    lead.timesContacted += 1;
    lead.lastContactedAt = now;
    lead.followUpAt = new Date(now.getTime() + settings.followUpDays * 24 * 60 * 60 * 1000);
    await lead.save();

    await OutreachLog.create({
      leadId: lead._id,
      channel,
      direction: "OUTBOUND",
      action: "MARKED_CONTACTED",
      message: lead.pitchMessage,
      meta: { manual: true },
    });

    res.json({ lead });
  }),
);

/** POST /api/leads/:id/response, record a reply. */
leadsRouter.post(
  "/:id/response",
  validateBody(
    z.object({
      status: z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE", "OPT_OUT", "BOUNCED"]),
      note: z.string().optional(),
      estimatedDealValue: z.number().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const lead = await loadLead(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });

    const { status, note, estimatedDealValue } = req.body as {
      status: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "OPT_OUT" | "BOUNCED";
      note?: string;
      estimatedDealValue?: number;
    };

    if (status === "OPT_OUT") {
      await optOutLead(lead, note ?? "Requested no further contact", "opt_out_reply");
      return res.json({ lead, optedOut: true });
    }

    lead.responseStatus = status;
    lead.respondedAt = new Date();
    lead.followUpAt = undefined; // never follow up after any response
    if (status === "POSITIVE") {
      lead.outreachStatus = "INTERESTED";
      if (estimatedDealValue != null) lead.estimatedDealValue = estimatedDealValue;
    } else if (status === "NEGATIVE") {
      lead.outreachStatus = "NOT_INTERESTED";
    } else if (status === "BOUNCED") {
      lead.outreachStatus = "NOT_CONTACTED";
    } else {
      lead.outreachStatus = "RESPONDED";
    }
    await lead.save();

    await OutreachLog.create({
      leadId: lead._id,
      channel: lead.outreachChannel === "NONE" ? "SYSTEM" : (lead.outreachChannel as "EMAIL" | "INSTAGRAM_MANUAL" | "WHATSAPP"),
      direction: "INBOUND",
      action: status === "BOUNCED" ? "BOUNCED" : "RESPONSE_RECEIVED",
      message: note,
      meta: { status },
    });

    res.json({ lead });
  }),
);

/** POST /api/leads/:id/convert, mark the lead as a paying client. 🎉 */
leadsRouter.post(
  "/:id/convert",
  asyncHandler(async (req, res) => {
    const lead = await loadLead(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });

    lead.outreachStatus = "CONVERTED";
    lead.convertedAt = new Date();
    lead.followUpAt = undefined;
    if (req.body?.dealValue != null) lead.estimatedDealValue = Number(req.body.dealValue);
    await lead.save();

    await OutreachLog.create({
      leadId: lead._id,
      channel: "SYSTEM",
      direction: "INTERNAL",
      action: "CONVERTED",
      meta: { dealValue: lead.estimatedDealValue },
    });

    res.json({ lead });
  }),
);

/** POST /api/leads/:id/opt-out, NDPA right to object. */
leadsRouter.post(
  "/:id/opt-out",
  asyncHandler(async (req, res) => {
    const lead = await loadLead(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    await optOutLead(lead, (req.body?.reason as string) ?? "Manual opt-out", "manual");
    res.json({ lead });
  }),
);

/** POST /api/leads/:id/recheck, re-run website check + rescore. */
leadsRouter.post(
  "/:id/recheck",
  asyncHandler(async (req, res) => {
    const lead = await loadLead(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    if (lead.optedOut) return res.status(409).json({ error: "Lead has opted out" });
    // Reset to DISCOVERED semantics for processing, preserving CRM fields.
    const outcome = await processLead(lead);
    res.json({ lead: await Lead.findById(lead._id), outcome });
  }),
);

/** POST /api/leads/:id/regenerate-pitch, new AI pitch. */
leadsRouter.post(
  "/:id/regenerate-pitch",
  asyncHandler(async (req, res) => {
    const lead = await loadLead(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    if (lead.optedOut) return res.status(409).json({ error: "Lead has opted out" });

    const pitch = await generatePitch(pitchContextFromLead(lead));
    lead.personalisedObservation = pitch.observation;
    lead.pitchSubject = pitch.subject;
    lead.pitchMessage = pitch.message;
    lead.pitchGeneratedAt = new Date();
    lead.pitchModel = `${pitch.provider}/${pitch.model}`;
    if (lead.pipelineStage === "QUALIFIED") {
      lead.pipelineStage = "PENDING_APPROVAL";
      lead.approval.status = "PENDING";
    }
    await lead.save();
    res.json({ lead, pitch });
  }),
);

/** DELETE /api/leads/:id, archive (soft delete). */
leadsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const lead = await loadLead(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    lead.pipelineStage = "ARCHIVED";
    await lead.save();
    res.json({ archived: true });
  }),
);
