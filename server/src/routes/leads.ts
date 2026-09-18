import { Router } from "express";
import { z } from "zod";
import mongoose from "mongoose";
import { Lead } from "../models/Lead.js";
import { OutreachLog } from "../models/OutreachLog.js";
import { getSettings } from "../models/Settings.js";
import { asyncHandler, validateBody } from "../middleware/index.js";
import { processLead } from "../services/pipeline/runPipeline.js";
import { applyPitchResult, generatePitch, pitchContextFromLead } from "../services/pitch/generatePitch.js";
import { scoreLead } from "../services/scoring/leadScore.js";
import { optOutLead } from "../services/suppression.js";
import { createDraftForLead, emailsSentToday, getActiveEmail, sendPitchForLead } from "../services/outreach/email/index.js";
import { assignChannel } from "../services/outreach/channel.js";
import { countryFromAddress, normalizePhone } from "../utils/phone.js";

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
        maxScore: z.coerce.number().optional(),
        minReach: z.coerce.number().optional(),
        maturity: z.string().optional(),
        source: z.string().optional(),
        /** "email", "phone", "whatsapp", "instagram", "any", "none" */
        contactable: z.string().optional(),
        newToGoogle: z.enum(["true", "false"]).optional(),
        openingSoon: z.enum(["true", "false"]).optional(),
        hasPitch: z.enum(["true", "false"]).optional(),
        optedOut: z.enum(["true", "false"]).optional(),
        /** Discovered within the last N days. */
        createdWithinDays: z.coerce.number().int().min(1).max(3650).optional(),
        minRating: z.coerce.number().optional(),
        maxReviews: z.coerce.number().int().optional(),
        minRatingVelocity: z.coerce.number().min(0).optional(),
        search: z.string().optional(),
        sort: z
          .enum([
            "score", "-score", "priority", "-priority", "reach", "-reach",
            "created", "-created", "name", "-name", "reviews", "-reviews",
          ])
          .default("-priority"),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(25),
      })
      .parse(req.query);

    const filter: Record<string, unknown> = {};
    if (q.stage) filter.pipelineStage = { $in: q.stage.split(",") };
    // Comma separated like the rest, so the approval queue can ask for
    // "awaiting a decision or awaiting a send" in one request.
    if (q.approvalStatus) filter["approval.status"] = { $in: q.approvalStatus.split(",") };
    if (q.outreachStatus) filter.outreachStatus = { $in: q.outreachStatus.split(",") };
    if (q.websiteType) filter.websiteType = { $in: q.websiteType.split(",") };
    if (q.city) filter.city = q.city;
    if (q.category) filter.category = q.category;
    // Comma separated, so the approval queue can ask for "anything reachable"
    // in one request rather than three.
    if (q.channel) filter.outreachChannel = { $in: q.channel.split(",") };
    if (q.minScore != null || q.maxScore != null) {
      const scoreRange = {
        ...(q.minScore != null ? { $gte: q.minScore } : {}),
        ...(q.maxScore != null ? { $lte: q.maxScore } : {}),
      };
      filter.$and = [
        ...((filter.$and as unknown[]) ?? []),
        {
          $or: [
            { needScore: scoreRange },
            // Existing deployments can contain leads written before need and
            // reach were split. Keep those filterable until the rescore runs.
            { needScore: { $exists: false }, leadScore: scoreRange },
          ],
        },
      ];
    }
    if (q.minReach != null) filter.reachScore = { $gte: q.minReach };
    if (q.maturity) filter.maturity = { $in: q.maturity.split(",") };
    if (q.source) filter.discoverySource = { $in: q.source.split(",") };
    // `{field: false}` does not match a document where the field is absent, and
    // it is absent on every lead stored before the field existed. Asking for
    // "not new to Google" must include those, so false means "not true".
    if (q.newToGoogle) filter.newToGoogle = q.newToGoogle === "true" ? true : { $ne: true };
    if (q.openingSoon) filter.openingSoon = q.openingSoon === "true" ? true : { $ne: true };
    if (q.hasPitch) filter.pitchMessage = q.hasPitch === "true" ? { $nin: [null, ""] } : { $in: [null, ""] };
    // Opted-out leads are hidden unless asked for: they are not actionable and
    // burying live leads under them is how a queue stops being trusted.
    filter.optedOut = q.optedOut === "true" ? true : q.optedOut === "false" ? false : { $ne: true };
    if (q.createdWithinDays != null) {
      filter.createdAt = { $gte: new Date(Date.now() - q.createdWithinDays * 86400000) };
    }
    if (q.minRating != null) filter.rating = { $gte: q.minRating };
    if (q.maxReviews != null) filter.userRatingCount = { $lte: q.maxReviews };
    if (q.minRatingVelocity != null) filter.ratingVelocity = { $gte: q.minRatingVelocity };

    // How we can reach them. "any" and "none" answer the two questions an
    // operator actually asks: who can I contact today, and who needs digging.
    const reachable = [
      { email: { $nin: [null, ""] } },
      { phoneNormalized: { $nin: [null, ""] } },
      { instagramUsername: { $nin: [null, ""] } },
    ];
    switch (q.contactable) {
      case "email":
        filter.email = { $nin: [null, ""] };
        break;
      case "phone":
        filter.phoneNormalized = { $nin: [null, ""] };
        break;
      case "whatsapp":
        filter.whatsappAvailable = true;
        break;
      case "instagram":
        filter.instagramUsername = { $nin: [null, ""] };
        break;
      case "any":
        filter.$and = [...((filter.$and as unknown[]) ?? []), { $or: reachable }];
        break;
      case "none":
        filter.email = { $in: [null, ""] };
        filter.phoneNormalized = { $in: [null, ""] };
        filter.instagramUsername = { $in: [null, ""] };
        break;
      default:
        break;
    }

    if (q.search) {
      // Escaped: a business name with a bracket in it must not become a regex.
      const term = q.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = { $regex: term, $options: "i" };
      filter.$and = [
        ...((filter.$and as unknown[]) ?? []),
        {
          $or: [
            { businessName: rx },
            { email: rx },
            { instagramUsername: rx },
            { city: rx },
            { category: rx },
            { phoneNormalized: rx },
            { websiteUrl: rx },
          ],
        },
      ];
    }

    const sortMap: Record<string, Record<string, 1 | -1>> = {
      score: { needScore: 1 },
      "-score": { needScore: -1 },
      priority: { priorityScore: 1 },
      "-priority": { priorityScore: -1 },
      reach: { reachScore: 1 },
      "-reach": { reachScore: -1 },
      created: { createdAt: 1 },
      "-created": { createdAt: -1 },
      name: { businessName: 1 },
      "-name": { businessName: -1 },
      reviews: { userRatingCount: 1 },
      "-reviews": { userRatingCount: -1 },
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
      // Read against the business's own address, not an account-wide default.
      // A number that says nothing about its country in a lead whose country
      // cannot be told is kept exactly as it was typed.
      const country = countryFromAddress(lead.address)?.iso ?? null;
      lead.phoneNormalized = normalizePhone(body.phone, country) ?? undefined;
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

    const contactChanged =
      body.email !== undefined || body.phone !== undefined || body.instagramUsername !== undefined;

    /*
     * A contact added by hand takes effect now, not on the next scan.
     *
     * Every no-route lead in the queue is told to "add a contact on the lead
     * page", and doing so used to change nothing visible: the channel is what
     * decides where a lead appears and whether it can be sent, and it was only
     * recalculated by the pipeline's own repair sweep, which runs when leads
     * are next processed. So the operator did exactly what they were asked and
     * the lead stayed unreachable until some later scan. An explicit channel in
     * the same request still wins, because that is somebody overriding the rule
     * on purpose.
     */
    if (contactChanged && body.outreachChannel === undefined) {
      assignChannel(lead);
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
          hasPhone: Boolean(lead.phoneNormalized ?? lead.phone),
          whatsappAvailable: lead.whatsappAvailable,
          openingSoon: lead.openingSoon,
          instagramActive: lead.instagramActive,
          strongVisualBrand: lead.strongVisualBrand,
          maturity: lead.maturity as "NEW" | "EMERGING" | "ESTABLISHED" | "UNKNOWN",
          rating: lead.rating,
          userRatingCount: lead.userRatingCount,
          ratingVelocity: lead.ratingVelocity,
          newToGoogle: lead.newToGoogle,
        },
        settings.scoringWeights,
        settings.scoreThreshold,
      );
      lead.leadScore = scoreResult.needScore;
      lead.needScore = scoreResult.needScore;
      lead.reachScore = scoreResult.reachScore;
      lead.priorityScore = scoreResult.priorityScore;
      lead.scoreBreakdown = scoreResult.breakdown;
      lead.needBreakdown = scoreResult.needBreakdown;
      lead.reachBreakdown = scoreResult.reachBreakdown;
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
    /*
     * Sending the message is the approval decision, so record it as one.
     *
     * The manual channels hand the operator the message and ask them to press
     * "Mark contacted" afterwards, and they can reasonably do that without
     * pressing Approve first. The lead was then a contacted business whose
     * approval was still marked as pending for good: an audit trail that says
     * nobody ever agreed to send a message that demonstrably went out.
     */
    if (lead.approval.status === "PENDING" || lead.approval.status === "NONE") {
      lead.approval.status = "APPROVED";
      lead.approval.reviewedAt = new Date();
      lead.approval.reviewedBy = lead.approval.reviewedBy ?? "dashboard";
    }
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
      /*
       * A bounce means nobody read it. The lead is unworked, not finished.
       *
       * This used to set the status back to NOT_CONTACTED and stop there, which
       * left the lead in a corner nothing could reach: still approved, still at
       * the CONTACTED stage, counted as neither contacted nor waiting, holding
       * an address already proven dead. It appeared in no list and no figure,
       * and the one thing that was actually true of it, that a real business
       * still needs a website and we simply have the wrong address, was the one
       * thing nothing said.
       *
       * So: retire the address, look for another way in, and put the lead back
       * in front of the operator. If the only route was that address it lands
       * under "No route" in the queue, which is where every other lead with
       * nothing to send to already is.
       */
      if (lead.email) {
        const dead = lead.email.toLowerCase();
        if (!lead.bouncedEmails.includes(dead)) lead.bouncedEmails.push(dead);
        lead.set("email", undefined);
        lead.emailConfidence = 0;
        lead.emailAssessment = "Delivery bounced, so this address does not reach the business.";
      }
      // The send never arrived, so it does not count against the attempts the
      // follow-up policy allows.
      lead.timesContacted = Math.max(0, lead.timesContacted - 1);
      lead.gmailDraftId = undefined;
      lead.gmailMessageId = undefined;
      lead.gmailThreadId = undefined;
      assignChannel(lead);
      lead.outreachStatus = "NOT_CONTACTED";
      /*
       * A bounce is not a reply from the business, so it must not be held
       * against them as one. The follow-up engine only writes to leads whose
       * response status is NONE, so leaving BOUNCED on the record exempted the
       * lead from every future follow-up even after a working address was
       * found: silently, and for good. What actually happened is kept in
       * `bouncedEmails` and in the outreach log, which is where it belongs.
       */
      lead.responseStatus = "NONE";
      lead.respondedAt = undefined;
      // Only back into the queue if there is still a message to send. A lead
      // that never had one is left for draftPendingPitches to finish.
      if (lead.pitchMessage) {
        lead.pipelineStage = "PENDING_APPROVAL";
        lead.approval.status = "PENDING";
        lead.approval.reviewedAt = undefined;
      }
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

    /*
     * A re-check refreshes the audit. It does not reopen a decision.
     *
     * Running the whole flow ends by writing a new pitch and setting the lead
     * back to PENDING_APPROVAL, so pressing this on a lead that had been
     * approved, sent to, or converted put it back in the approval queue with
     * the message that was actually sent replaced by a fresh one. The website
     * check, the enrichment and the score are still brought up to date.
     */
    const actioned =
      lead.approval.status === "APPROVED" ||
      lead.approval.status === "REJECTED" ||
      (lead.outreachStatus !== "NOT_CONTACTED" && lead.outreachStatus !== "DRAFT_CREATED");
    const outcome = await processLead(lead, undefined, { keepOutreachState: actioned });

    /*
     * A lead that processes cleanly is no longer a failing lead.
     *
     * Three failures take a lead out of every retry the pipeline runs, and
     * nothing put it back. Re-check is the operator saying "try this one
     * again", so clearing the tally is what makes it mean that: without it a
     * lead that failed while the AI provider was down stayed excluded from
     * every future run even after the provider came back.
     */
    await Lead.updateOne(
      { _id: lead._id },
      { $unset: { lastProcessingError: 1 }, $set: { processingAttempts: 0 } },
    );

    res.json({ lead: await Lead.findById(lead._id), outcome, outreachStatePreserved: actioned });
  }),
);

/** POST /api/leads/:id/regenerate-pitch, new AI pitch. */
leadsRouter.post(
  "/:id/regenerate-pitch",
  asyncHandler(async (req, res) => {
    const lead = await loadLead(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    if (lead.optedOut) return res.status(409).json({ error: "Lead has opted out" });

    // Regenerating is the escape hatch from a shared message, so this path
    // never reuses one: it always writes this business its own.
    assignChannel(lead);
    const pitch = await generatePitch(pitchContextFromLead(lead), { forceProviderAttempt: true });
    applyPitchResult(lead, pitch);
    lead.pitchShared = false;
    lead.set("pitchGroupKey", undefined);
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
