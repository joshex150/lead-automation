import { Lead } from "../../models/Lead.js";
import {
  PipelineJob,
  type PipelineJobDocument,
  type PipelineJobStatus,
  type PipelineJobType,
} from "../../models/PipelineJob.js";
import { PipelineLease } from "../../models/PipelineLease.js";
import { SearchRun, type SearchRunDocument } from "../../models/SearchRun.js";
import { logger } from "../../utils/logger.js";
import {
  discover,
  pendingPitchFilter,
  processablePendingFilter,
  processPendingLeads,
  recoverableQueriesForRun,
  resumeDiscoveryRun,
  runFullPipeline,
  MAX_PROCESSING_ATTEMPTS,
  type BatchProcessResult,
  type DiscoverResult,
} from "./runPipeline.js";

export interface StartPipelineJobOptions {
  type: PipelineJobType;
  resumedFromRunId?: string;
  /** Who asked for it. Cron runs are tracked exactly like operator ones. */
  trigger?: "CRON" | "MANUAL" | "API";
}

function busyError(active?: PipelineJobDocument | null): Error {
  return Object.assign(
    new Error(
      active
        ? `Pipeline job ${String(active._id)} is already ${active.status.toLowerCase()}.`
        : "Another pipeline job is already active.",
    ),
    { statusCode: 409, activeJobId: active ? String(active._id) : undefined },
  );
}

/**
 * Writes progress, and records that the work moved.
 *
 * `progressAt` only advances when a counter does. The heartbeat cannot say
 * that, because it is a timer: it keeps beating while a request hangs, which is
 * how a run held the overview for most of a day looking perfectly healthy.
 */
async function updateJob(jobId: string, set: Record<string, unknown>): Promise<void> {
  const moved = Object.keys(set).some((key) => key.startsWith("progress.") && key !== "progress.message");
  await PipelineJob.updateOne(
    { _id: jobId, activeKey: "pipeline" },
    { $set: { ...set, heartbeatAt: new Date(), ...(moved ? { progressAt: new Date() } : {}) } },
  );
}

/** Thrown when the operator stops a run. Not an error to report as a failure. */
class CancelledError extends Error {
  constructor() {
    super("Stopped on request");
    this.name = "CancelledError";
  }
}

/**
 * Asks the database whether this run has been told to stop.
 *
 * Cancelling is cooperative because the work is a loop, not a thread that can
 * be killed. The endpoint also releases the lock, so even a run too wedged to
 * notice this cannot keep the next scan from starting.
 */
async function assertNotCancelled(jobId: string): Promise<void> {
  const job = await PipelineJob.findById(jobId).select("cancelRequested").lean();
  if (job?.cancelRequested) throw new CancelledError();
}

/**
 * Whether the run is worth complaining about.
 *
 * A search that failed leaves work undone and can be resumed, and a lead that
 * threw is a lead with no pitch, so both are genuinely partial. A pitch that
 * fell back to the template is not: the lead came out with a message on it and
 * is sitting in the queue ready to send. Counting that as a problem put "the
 * last scan finished with problems" on the overview after runs where nothing
 * had gone wrong. It is still reported, as a note, in its own right.
 */
function finalStatus(discovery?: DiscoverResult, processing?: BatchProcessResult): PipelineJobStatus {
  if (discovery?.status === "PARTIAL" || discovery?.status === "FAILED") return "PARTIAL";
  if (processing?.errors.length) return "PARTIAL";
  return "COMPLETED";
}

/**
 * How long a job may go without a heartbeat before it is presumed dead.
 *
 * The heartbeat below is independent of progress, so silence means the process
 * is gone, not that a slow batch is still running. Two minutes is many beats.
 */
const JOB_STALE_AFTER_MS = 2 * 60_000;
const JOB_HEARTBEAT_MS = 15_000;

/*
 * How long the counters may sit still before the run is presumed wedged.
 *
 * Generous, because a single slow batch is normal: a website check waits up to
 * eight seconds and several run at once. Nothing legitimate goes this long
 * without moving a counter, and the alternative was a scan that held the
 * dashboard until somebody noticed the next morning.
 */
const JOB_STALLED_AFTER_MS = 12 * 60_000;

async function executePipelineJob(job: PipelineJobDocument): Promise<void> {
  const jobId = String(job._id);
  let discovery: DiscoverResult | undefined;
  let processing: BatchProcessResult | undefined;

  /*
   * A beat on a timer, not only on progress.
   *
   * Progress updates already touched heartbeatAt, but nothing ever read it, and
   * a job that died without unwinding, a killed process, a container replaced
   * mid-scan, kept `activeKey` forever. The dashboard then showed "Running" for
   * good: refreshing did not help, because the stuck state was in the database.
   * Beating on a timer makes silence mean something, and getPipelineOperational-
   * Status below acts on it.
   */
  const heartbeat = setInterval(() => {
    void PipelineJob.updateOne({ _id: jobId, activeKey: "pipeline" }, { $set: { heartbeatAt: new Date() } }).catch(
      () => undefined,
    );
  }, JOB_HEARTBEAT_MS);
  heartbeat.unref();

  try {
    await updateJob(jobId, {
      status: "RUNNING",
      phase: job.type === "PROCESS" ? "PROCESSING" : "DISCOVERY",
      startedAt: new Date(),
      "progress.message": job.type === "PROCESS" ? "Checking discovered leads" : "Starting discovery",
    });

    // Checked wherever progress is reported, which is the only place the loop
    // comes up for air often enough to notice.
    const onDiscoveryProgress = async (progress: {
      runId: string;
      current: number;
      total: number;
      failed: number;
      found: number;
      created: number;
      query?: { city: string; category: string };
    }) => {
      await updateJob(jobId, {
        phase: "DISCOVERY",
        searchRunId: progress.runId,
        "progress.current": progress.current,
        "progress.total": progress.total,
        "progress.failedQueries": progress.failed,
        "progress.found": progress.found,
        "progress.created": progress.created,
        "progress.message": progress.query
          ? `Searching ${progress.query.category} in ${progress.query.city}`
          : "Running discovery",
      });
      await assertNotCancelled(jobId);
    };

    const onProcessingProgress = async (progress: {
      current: number;
      total: number;
      processed: number;
      qualified: number;
      errors: number;
      aiFallbacks: number;
      message?: string;
    }) => {
      await updateJob(jobId, {
        phase: "PROCESSING",
        "progress.current": progress.current,
        "progress.total": progress.total,
        "progress.processed": progress.processed,
        "progress.qualified": progress.qualified,
        "progress.processingErrors": progress.errors,
        "progress.aiFallbacks": progress.aiFallbacks,
        "progress.message": progress.message ?? "Checking websites, scoring leads and preparing pitches",
      });
      await assertNotCancelled(jobId);
    };

    // The search run is stamped with who asked for it, so run history tells a
    // scheduled sweep apart from one somebody started by hand.
    const trigger = job.trigger ?? "API";

    if (job.type === "FULL") {
      const result = await runFullPipeline(trigger, { onDiscoveryProgress, onProcessingProgress });
      discovery = result;
      processing = result;
    } else if (job.type === "DISCOVERY") {
      discovery = await discover(trigger, undefined, { onProgress: onDiscoveryProgress });
    } else if (job.type === "PROCESS") {
      processing = await processPendingLeads(200, 50, { onProgress: onProcessingProgress });
    } else {
      if (!job.resumedFromRunId) throw new Error("A source discovery run is required to resume.");
      discovery = await resumeDiscoveryRun(String(job.resumedFromRunId), trigger, onDiscoveryProgress);
      processing = await processPendingLeads(200, 50, { onProgress: onProcessingProgress });
    }

    /*
     * Attribute the processing figures to the search run that produced them.
     *
     * runFullPipeline does this for itself, so a full scan showed a yield and a
     * resumed one showed none: the run history reported "—" against a resume
     * that had discovered and processed hundreds of leads, because nothing on
     * that path ever wrote the numbers back.
     */
    if (discovery?.runId && processing) {
      await SearchRun.findByIdAndUpdate(discovery.runId, {
        $set: { "totals.processed": processing.processed, "totals.qualified": processing.qualified },
      }).catch(() => undefined);
    }

    const status = finalStatus(discovery, processing);
    await PipelineJob.updateOne(
      { _id: jobId },
      {
        $set: {
          status,
          phase: "COMPLETE",
          finishedAt: new Date(),
          heartbeatAt: new Date(),
          ...(discovery?.runId ? { searchRunId: discovery.runId } : {}),
          "progress.current": processing?.processed ?? discovery?.completedQueries ?? 0,
          "progress.total":
            processing
              ? processing.processed + processing.errors.length
              : discovery?.totalQueries ?? 0,
          "progress.found": discovery?.found ?? 0,
          "progress.created": discovery?.created ?? 0,
          // Found minus created is not a loss, and the report said nothing
          // about where the difference went: 735 found against 356 created
          // reads like a fault until it says most were already on file.
          "progress.duplicates": discovery?.duplicates ?? 0,
          "progress.suppressed": discovery?.suppressed ?? 0,
          "progress.failedQueries": discovery
            ? discovery.failedQueries + discovery.pendingQueries
            : 0,
          "progress.processed": processing?.processed ?? 0,
          "progress.qualified": processing?.qualified ?? 0,
          "progress.processingErrors": processing?.errors.length ?? 0,
          "progress.aiFallbacks": processing?.aiFallbacks ?? 0,
          "progress.message":
            status === "COMPLETED"
              ? "Pipeline completed"
              : "Completed with recoverable errors",
        },
        $unset: { activeKey: 1 },
      },
    );
  } catch (err) {
    const cancelled = err instanceof CancelledError;
    const message = err instanceof Error ? err.message : String(err);

    // Stopping on request is an outcome, not a fault. Reporting it as a failure
    // would put a red panel on the overview for something the operator did on
    // purpose, which is the sort of thing they then cannot get rid of.
    if (cancelled) {
      logger.info({ jobId, type: job.type }, "pipeline job stopped on request");
    } else {
      logger.error({ err: message, jobId, type: job.type }, "background pipeline job failed");
    }

    await PipelineJob.updateOne(
      { _id: jobId },
      {
        $set: {
          status: cancelled ? "CANCELLED" : "FAILED",
          phase: "COMPLETE",
          ...(cancelled ? {} : { error: message }),
          finishedAt: new Date(),
          heartbeatAt: new Date(),
          "progress.message": cancelled ? "Stopped before it finished" : message,
        },
        $unset: { activeKey: 1 },
      },
    ).catch(() => undefined);
  } finally {
    clearInterval(heartbeat);
  }
}

/**
 * Fails a job that has stopped beating, and releases the lock it was holding.
 *
 * Called on every status read, which is the only place that reliably runs while
 * a dead job is stuck: the process that would have cleaned up is by definition
 * gone. Without it the dashboard sits on "Running" until somebody restarts the
 * service, and no new scan can start because the lock is still taken.
 */
async function failStaleJob(job: PipelineJobDocument): Promise<boolean> {
  const now = Date.now();
  const lastBeat = job.heartbeatAt?.getTime() ?? job.startedAt?.getTime() ?? 0;
  const lastProgress = job.progressAt?.getTime() ?? job.startedAt?.getTime() ?? lastBeat;

  const dead = now - lastBeat >= JOB_STALE_AFTER_MS;
  const wedged = now - lastProgress >= JOB_STALLED_AFTER_MS;
  if (!dead && !wedged) return false;

  /*
   * Two different failures, and only one of them used to be caught.
   *
   * A gone process stops beating. A wedged one keeps beating from its timer
   * while the work sits on a request that never returns, so it looked healthy
   * indefinitely: the overview showed a scan running for most of a day. The
   * counters are what say the work is moving, so a run whose counters have not
   * moved in a long time is ended too.
   */
  const message = dead
    ? "The scan stopped responding and was ended. Resume it, or process the leads it already found."
    : `The scan stopped making progress for ${Math.round(JOB_STALLED_AFTER_MS / 60_000)} minutes and was ended. ` +
      "Nothing it had already found was lost. Resume it, or process those leads.";
  await PipelineJob.updateOne(
    { _id: job._id, activeKey: "pipeline" },
    {
      $set: {
        status: "FAILED",
        phase: "COMPLETE",
        finishedAt: new Date(),
        error: message,
        "progress.message": message,
      },
      $unset: { activeKey: 1 },
    },
  ).catch(() => undefined);

  // The work is not coming back, so the lock must not outlive it.
  await PipelineLease.deleteMany({}).catch(() => undefined);

  logger.warn(
    { jobId: String(job._id), type: job.type, reason: dead ? "no heartbeat" : "no progress" },
    "pipeline job ended by the watchdog",
  );
  return true;
}

export async function startPipelineJob(options: StartPipelineJobOptions): Promise<PipelineJobDocument> {
  await PipelineJob.init();
  if (options.type === "RESUME_DISCOVERY" && !options.resumedFromRunId) {
    throw Object.assign(new Error("resumedFromRunId is required."), { statusCode: 400 });
  }
  if (options.type === "RESUME_DISCOVERY") {
    let run: SearchRunDocument | null = null;
    try {
      run = await SearchRun.findById(options.resumedFromRunId);
    } catch {
      // Invalid ObjectIds and missing runs intentionally share one response.
    }
    if (!run) throw Object.assign(new Error("Discovery run not found."), { statusCode: 404 });
    if (run.resumedBy) {
      throw Object.assign(new Error("This discovery run has already been resumed."), { statusCode: 409 });
    }
    if (recoverableQueriesForRun(run).length === 0) {
      throw Object.assign(new Error("This discovery run has no failed or incomplete queries to resume."), {
        statusCode: 409,
      });
    }
  }

  let job: PipelineJobDocument;
  try {
    job = await PipelineJob.create({
      type: options.type,
      trigger: options.trigger ?? "API",
      status: "QUEUED",
      phase: "QUEUED",
      activeKey: "pipeline",
      resumedFromRunId: options.resumedFromRunId,
      heartbeatAt: new Date(),
      progress: { message: "Queued" },
    });
  } catch (err) {
    if ((err as { code?: number })?.code !== 11000) throw err;
    const active = await PipelineJob.findOne({ activeKey: "pipeline" });
    throw busyError(active);
  }

  setImmediate(() => void executePipelineJob(job));
  return job;
}

export async function getPipelineJob(jobId: string): Promise<PipelineJobDocument | null> {
  try {
    return await PipelineJob.findById(jobId);
  } catch {
    return null;
  }
}

export async function getPipelineOperationalStatus(): Promise<{
  activeJob: PipelineJobDocument | null;
  latestJob: PipelineJobDocument | null;
  discoveredPending: number;
  pitchPending: number;
  /** Leads that have failed often enough that nothing retries them any more. */
  stalledLeads: number;
  resumableRun: { runId: string; status: string; recoverableQueries: number; startedAt: Date } | null;
}> {
  // A run that failed weeks ago is not pending work. The right answer then is a
  // fresh scan, which will find those businesses anyway, so offering "resume"
  // forever puts a call to action on screen for something nobody should do.
  const RESUMABLE_WINDOW_DAYS = 7;
  const resumableSince = new Date(Date.now() - RESUMABLE_WINDOW_DAYS * 86_400_000);

  const [rawActiveJob, latestJob, discoveredPending, pitchPending, stalledLeads, candidates] = await Promise.all([
    PipelineJob.findOne({ activeKey: "pipeline" }).sort({ createdAt: -1 }),
    PipelineJob.findOne().sort({ createdAt: -1 }),
    // Leads that have already failed processing repeatedly are not work this
    // button can finish. Counting them left "Process N discovered" on screen
    // permanently, doing nothing each time it was pressed.
    Lead.countDocuments(processablePendingFilter()),
    // Leads that qualified but never got a message. They are not in the
    // approval queue and nothing else looks for them, so without this count
    // they are simply lost.
    Lead.countDocuments(pendingPitchFilter()),
    /*
     * The ones nothing will pick up again.
     *
     * Both counters above deliberately exclude leads that have already failed
     * three times, because pressing a button that cannot finish them is worse
     * than not offering it. The consequence was that those leads then appeared
     * in no figure anywhere: work that had quietly stopped and said nothing.
     * Counted separately so the overview can say so, with the reason attached
     * to each lead in `lastProcessingError`.
     */
    Lead.countDocuments({
      optedOut: { $ne: true },
      processingAttempts: { $gte: MAX_PROCESSING_ATTEMPTS },
      pipelineStage: { $in: ["DISCOVERED", "QUALIFIED"] },
    }),
    SearchRun.find({
      resumedBy: { $exists: false },
      startedAt: { $gte: resumableSince },
      $or: [
        { status: { $in: ["PARTIAL", "FAILED"] } },
        { "queries.error": { $exists: true, $nin: [null, ""] } },
      ],
    })
      .sort({ startedAt: -1 })
      .limit(10),
  ]);

  // A job that has stopped beating is not active, it is finished badly. Saying
  // so here is what unsticks the dashboard without a restart.
  const failed = rawActiveJob ? await failStaleJob(rawActiveJob) : false;
  const activeJob = failed ? null : rawActiveJob;
  // latestJob was read in parallel with that decision, so it still says RUNNING.
  // Re-read it, or the operator is told the scan is running and not running at
  // the same time.
  const currentLatest = failed ? await PipelineJob.findOne().sort({ createdAt: -1 }) : latestJob;

  let resumableRun: {
    runId: string;
    status: string;
    recoverableQueries: number;
    startedAt: Date;
  } | null = null;
  for (const run of candidates) {
    const recoverableQueries = recoverableQueriesForRun(run).length;
    if (recoverableQueries > 0) {
      resumableRun = {
        runId: String(run._id),
        status: run.status,
        recoverableQueries,
        startedAt: run.startedAt,
      };
      break;
    }
  }

  return { activeJob, latestJob: currentLatest, discoveredPending, pitchPending, stalledLeads, resumableRun };
}

/**
 * A restarted process cannot still be executing its in-memory jobs. Convert
 * persisted RUNNING work to recoverable state and release stale leases.
 */
export async function recoverInterruptedPipelineWork(): Promise<void> {
  const now = new Date();
  await Promise.all([
    PipelineJob.updateMany(
      { activeKey: "pipeline" },
      {
        $set: {
          status: "FAILED",
          phase: "COMPLETE",
          finishedAt: now,
          heartbeatAt: now,
          error: "Interrupted by a service restart. Resume the scan or process discovered leads.",
          "progress.message": "Interrupted by a service restart",
        },
        $unset: { activeKey: 1 },
      },
    ),
    PipelineLease.deleteMany({}),
  ]);

  const interruptedRuns: SearchRunDocument[] = await SearchRun.find({ status: "RUNNING" });
  for (const run of interruptedRuns) {
    const total = run.progress?.totalQueries || run.plannedQueries?.length || run.queries.length;
    const completed = run.queries.length;
    const failed = run.queries.filter((query) => Boolean(query.error)).length;
    run.progress = {
      totalQueries: total,
      completedQueries: completed,
      successfulQueries: completed - failed,
      failedQueries: failed,
      pendingQueries: Math.max(0, total - completed),
    };
    run.status = "PARTIAL";
    run.finishedAt = now;
    run.heartbeatAt = now;
    run.error = "Interrupted by a service restart. Failed and incomplete queries can be resumed.";
    await run.save();
  }
}
