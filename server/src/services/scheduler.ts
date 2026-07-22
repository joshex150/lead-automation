import cron, { type ScheduledTask } from "node-cron";
import { logger } from "../utils/logger.js";
import { getSettings } from "../models/Settings.js";
import { getPlacesKey, getSchedulerRuntime, type ResolvedScheduler } from "../config/runtime.js";
import { runFullPipeline } from "./pipeline/runPipeline.js";
import { runFollowUps } from "./outreach/followUp.js";

/**
 * Built-in scheduler so the service is fully self-contained on Railway.
 * Cron expressions, timezone and the on/off switch live in Settings (DB)
 * with env fallback, and the scheduler HOT-RELOADS whenever settings are
 * saved, no restart needed. (n8n can also drive the same endpoints
 * externally, see n8n/workflow.json.)
 */

let tasks: ScheduledTask[] = [];
let active: ResolvedScheduler | null = null;
let discoveryRunning = false;
let followUpsRunning = false;

async function discoveryJob(): Promise<void> {
  if (discoveryRunning) {
    logger.warn("Skipping scheduled discovery, previous run still in progress");
    return;
  }
  discoveryRunning = true;
  try {
    const settings = await getSettings().catch(() => null);
    if (settings && !settings.discoveryEnabled) {
      logger.info("Scheduled discovery skipped, disabled in settings");
      return;
    }
    if (!(await getPlacesKey())) {
      logger.warn("Scheduled discovery skipped, Google Places API key not configured");
      return;
    }
    const result = await runFullPipeline("CRON");
    logger.info(result, "scheduled pipeline run finished");
  } catch (err) {
    logger.error({ err: String(err) }, "scheduled pipeline run failed");
  } finally {
    discoveryRunning = false;
  }
}

async function followUpJob(): Promise<void> {
  if (followUpsRunning) return;
  followUpsRunning = true;
  try {
    const result = await runFollowUps();
    logger.info(result, "scheduled follow-up run finished");
  } catch (err) {
    logger.error({ err: String(err) }, "scheduled follow-up run failed");
  } finally {
    followUpsRunning = false;
  }
}

function schedule(expr: string, tz: string, job: () => Promise<void>, label: string): ScheduledTask | null {
  if (!cron.validate(expr)) {
    logger.error({ expr, label }, "invalid cron expression, job not scheduled");
    return null;
  }
  try {
    return cron.schedule(expr, () => void job(), { timezone: tz });
  } catch (err) {
    // e.g. an invalid IANA timezone, never let bad settings kill the process.
    logger.error({ err: String(err), expr, tz, label }, "failed to schedule job");
    try {
      return cron.schedule(expr, () => void job());
    } catch {
      return null;
    }
  }
}

/** (Re)starts jobs from current settings. Safe to call any time. */
export async function reloadScheduler(): Promise<void> {
  let resolved: ResolvedScheduler;
  try {
    resolved = await getSchedulerRuntime();
  } catch (err) {
    logger.error({ err: String(err) }, "could not resolve scheduler settings, keeping current jobs");
    return;
  }

  // No change? Leave the running jobs alone.
  if (active && JSON.stringify(active) === JSON.stringify(resolved)) return;

  stopScheduler();
  active = resolved;

  if (!resolved.enabled) {
    logger.info("Scheduler disabled (settings/env), use the API or n8n to trigger runs");
    return;
  }

  const t1 = schedule(resolved.discoveryCron, resolved.timezone, discoveryJob, "discovery");
  const t2 = schedule(resolved.followUpCron, resolved.timezone, followUpJob, "follow-ups");
  tasks = [t1, t2].filter((t): t is ScheduledTask => t !== null);

  logger.info(
    { discovery: resolved.discoveryCron, followUps: resolved.followUpCron, tz: resolved.timezone, jobs: tasks.length },
    "Scheduler (re)started",
  );
}

export async function startScheduler(): Promise<void> {
  await reloadScheduler();
}

export function stopScheduler(): void {
  for (const t of tasks) t.stop();
  tasks = [];
  active = null;
}

/** Test hook: number of live cron jobs. */
export function _scheduledJobCount(): number {
  return tasks.length;
}
