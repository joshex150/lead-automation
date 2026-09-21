import { Router } from "express";
import { z } from "zod";
import { SearchRun } from "../models/SearchRun.js";
import { PipelineJob } from "../models/PipelineJob.js";
import { PipelineLease } from "../models/PipelineLease.js";
import { asyncHandler, validateBody } from "../middleware/index.js";
import {
  discover,
  processPendingLeads,
  runFullPipeline,
  templatePitchSummary,
} from "../services/pipeline/runPipeline.js";
import {
  getPipelineJob,
  getPipelineOperationalStatus,
  startPipelineJob,
} from "../services/pipeline/backgroundJobs.js";
import { importLeads, runExtraSources } from "../services/discovery/sources/runSources.js";
import { runFollowUps } from "../services/outreach/followUp.js";
import { checkWebsite } from "../services/websiteChecker/index.js";
import { logger } from "../utils/logger.js";
import { OUTREACH_CHANNELS, type OutreachChannel } from "../types.js";

export const pipelineRouter = Router();

const discoverSchema = z
  .object({
    cities: z.array(z.string()).optional(),
    categories: z.array(z.string()).optional(),
  })
  .default({});

/** POST /api/pipeline/discover, run discovery only. */
pipelineRouter.post(
  "/discover",
  validateBody(discoverSchema),
  asyncHandler(async (req, res) => {
    const result = await discover("API", req.body);
    res.json(result);
  }),
);

/** POST /api/pipeline/process, process leads awaiting check/score/pitch. */
pipelineRouter.post(
  "/process",
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 200), 500);
    const result = await processPendingLeads(limit);
    res.json(result);
  }),
);

/** POST /api/pipeline/run, full pipeline (discover + process). */
pipelineRouter.post(
  "/run",
  asyncHandler(async (_req, res) => {
    const result = await runFullPipeline("API");
    res.json(result);
  }),
);

/** POST /api/pipeline/jobs/full, durable background full pipeline. */
pipelineRouter.post(
  "/jobs/full",
  asyncHandler(async (_req, res) => {
    const job = await startPipelineJob({ type: "FULL" });
    res.status(202).json({ job });
  }),
);

/** POST /api/pipeline/jobs/discovery, durable background Places discovery only. */
pipelineRouter.post(
  "/jobs/discovery",
  asyncHandler(async (_req, res) => {
    const job = await startPipelineJob({ type: "DISCOVERY" });
    res.status(202).json({ job });
  }),
);

/** POST /api/pipeline/jobs/process, recover/process all persisted DISCOVERED leads. */
pipelineRouter.post(
  "/jobs/process",
  asyncHandler(async (_req, res) => {
    const job = await startPipelineJob({ type: "PROCESS" });
    res.status(202).json({ job });
  }),
);

/**
 * GET /api/pipeline/template-pitches, what is still on the built-in template.
 *
 * Read before the rewrite, because the question an operator is really asking
 * is not how many leads are affected but how much rewriting them will cost.
 * Those differ by an order of magnitude here: messages are shared between
 * leads in the same situation, so a category with hundreds of leads in it is
 * usually a handful of AI calls.
 */
pipelineRouter.get(
  "/template-pitches",
  asyncHandler(async (req, res) => {
    const q = z.object({ channels: z.string().optional() }).parse(req.query);
    const summary = await templatePitchSummary({
      channels: q.channels ? (q.channels.split(",") as OutreachChannel[]) : undefined,
    });
    res.json(summary);
  }),
);

const rewritePitchesSchema = z
  .object({
    channels: z.array(z.enum(OUTREACH_CHANNELS)).min(1).optional(),
  })
  .default({});

/**
 * POST /api/pipeline/jobs/rewrite-pitches, replace built-in messages with AI.
 *
 * A background job rather than an inline call: this can run to a thousand
 * leads, and the whole point of it is that an operator connected a provider
 * after the fact and wants the backlog fixed without watching it.
 */
pipelineRouter.post(
  "/jobs/rewrite-pitches",
  validateBody(rewritePitchesSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof rewritePitchesSchema>;
    const job = await startPipelineJob({
      type: "REWRITE_PITCHES",
      pitchScope: { channels: body.channels },
    });
    res.status(202).json({ job });
  }),
);

/** GET /api/pipeline/jobs/status, active job plus recovery actions. */
pipelineRouter.get(
  "/jobs/status",
  asyncHandler(async (_req, res) => {
    res.json(await getPipelineOperationalStatus());
  }),
);

/**
 * POST /api/pipeline/jobs/:id/cancel, stop a run that is going nowhere.
 *
 * Two things happen, because either alone is not enough. The flag asks the run
 * to stop, which it notices the next time it reports progress and unwinds
 * cleanly. The lock is released here regardless, so a run too wedged to notice
 * cannot go on blocking the next scan: waiting for a hung request to answer is
 * exactly the situation this exists for.
 */
pipelineRouter.post(
  "/jobs/:id/cancel",
  asyncHandler(async (req, res) => {
    const job = await PipelineJob.findById(req.params.id);
    if (!job) return res.status(404).json({ error: "Pipeline job not found" });
    if (job.status !== "RUNNING" && job.status !== "QUEUED") {
      return res.status(409).json({ error: `That scan is already ${job.status.toLowerCase()}.` });
    }

    await PipelineJob.updateOne(
      { _id: job._id },
      {
        $set: {
          cancelRequested: true,
          status: "CANCELLED",
          phase: "COMPLETE",
          finishedAt: new Date(),
          "progress.message": "Stopped before it finished",
        },
        $unset: { activeKey: 1 },
      },
    );
    await PipelineLease.deleteMany({}).catch(() => undefined);

    const updated = await PipelineJob.findById(job._id);
    res.json({ job: updated });
  }),
);

/**
 * POST /api/pipeline/jobs/:id/acknowledge, put down the report of a bad run.
 *
 * Dismissing is recorded rather than kept in the browser, so the notice does
 * not come back on the next reload or reappear for a colleague who has already
 * been told about it.
 */
pipelineRouter.post(
  "/jobs/:id/acknowledge",
  asyncHandler(async (req, res) => {
    const job = await PipelineJob.findByIdAndUpdate(
      req.params.id,
      { $set: { acknowledgedAt: new Date() } },
      { new: true },
    );
    if (!job) return res.status(404).json({ error: "Pipeline job not found" });
    res.json({ job });
  }),
);

/** GET /api/pipeline/jobs/:id, persisted background progress. */
pipelineRouter.get(
  "/jobs/:id",
  asyncHandler(async (req, res) => {
    const job = await getPipelineJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Pipeline job not found" });
    res.json({ job });
  }),
);

/** POST /api/pipeline/runs/:id/resume, retry only failed/unattempted queries then process leads. */
pipelineRouter.post(
  "/runs/:id/resume",
  asyncHandler(async (req, res) => {
    const job = await startPipelineJob({
      type: "RESUME_DISCOVERY",
      resumedFromRunId: req.params.id,
    });
    res.status(202).json({ job });
  }),
);

/** POST /api/pipeline/discover-sources, run the enabled non-Places sources only. */
pipelineRouter.post(
  "/discover-sources",
  asyncHandler(async (_req, res) => {
    const runs = await runExtraSources();
    // Same reasoning as the import below: what the sources found is already
    // saved, so a processing pass that cannot start must not turn a successful
    // discovery into a failed request.
    let processing;
    let processingError: string | undefined;
    try {
      processing = await processPendingLeads();
    } catch (err) {
      processingError = err instanceof Error ? err.message : String(err);
      logger.warn({ err: processingError }, "sources discovered leads but processing could not start");
    }
    res.json({ sources: runs, processing, processingError });
  }),
);

const importSchema = z.object({
  city: z.string().optional(),
  category: z.string().optional(),
  process: z.boolean().optional().default(true),
  // Lenient per row so one bad line never rejects the whole batch; importLeads
  // validates and reports invalid rows in the response.
  items: z
    .array(
      z.object({
        businessName: z.string().optional(),
        category: z.string().optional(),
        city: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        instagramUsername: z.string().optional(),
        websiteUrl: z.string().optional(),
        address: z.string().optional(),
        openingSoon: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(2000),
});

/** POST /api/pipeline/import, manual/bulk lead import (Instagram/referral/CAC/canvassing). */
pipelineRouter.post(
  "/import",
  validateBody(importSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof importSchema>;
    const result = await importLeads(body.items, { city: body.city, category: body.category });

    /*
     * The import is done the moment the leads are saved. Processing is a
     * courtesy on top of it, and it used to be able to take the import down
     * with it in two different ways.
     *
     * It holds the processing lease, so importing while a scan was running
     * threw PipelineBusyError and the whole request answered 409: the leads
     * were on file and the operator was told the import had failed. And it runs
     * a full website check per lead, several seconds each, so a large paste sat
     * on one HTTP request until the proxy gave up at two minutes, which reads
     * the same way.
     *
     * So: small batches are still processed inline, because that is the case
     * where waiting is pleasant and the operator sees the result immediately.
     * Anything larger is left in DISCOVERED, where the overview already offers
     * to process it and the next scheduled run picks it up regardless. Either
     * way a failure here is reported beside the import, never instead of it.
     */
    const INLINE_PROCESS_LIMIT = 50;
    let processing;
    let processingError: string | undefined;
    let processingDeferred = false;

    if (body.process && result.created > 0) {
      if (result.created > INLINE_PROCESS_LIMIT) {
        processingDeferred = true;
      } else {
        try {
          processing = await processPendingLeads();
        } catch (err) {
          processingError = err instanceof Error ? err.message : String(err);
          logger.warn({ err: processingError }, "imported leads were saved but could not be processed yet");
        }
      }
    }

    res.json({ ...result, processing, processingError, processingDeferred });
  }),
);

/** POST /api/pipeline/follow-ups, dispatch due follow-ups. */
pipelineRouter.post(
  "/follow-ups",
  asyncHandler(async (_req, res) => {
    const result = await runFollowUps();
    res.json(result);
  }),
);

/** GET /api/pipeline/runs, discovery run history. */
pipelineRouter.get(
  "/runs",
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 20), 100);
    const runs = await SearchRun.find().sort({ startedAt: -1 }).limit(limit).lean();
    res.json({ runs });
  }),
);

/** POST /api/pipeline/check-website, ad-hoc website check (also used by n8n). */
pipelineRouter.post(
  "/check-website",
  validateBody(z.object({ url: z.string().min(4) })),
  asyncHandler(async (req, res) => {
    const { url } = req.body as { url: string };
    const result = await checkWebsite(url);
    res.json(result);
  }),
);
