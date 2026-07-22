import { Lead, type LeadDocument } from "../../models/Lead.js";
import { SearchRun, type SearchRunDocument } from "../../models/SearchRun.js";
import { getSettings } from "../../models/Settings.js";
import { buildQueries, searchPlaces } from "../discovery/googlePlaces.js";
import { checkWebsite } from "../websiteChecker/index.js";
import { enrichLead } from "../enrichment/index.js";
import { scoreLead } from "../scoring/leadScore.js";
import { generatePitch, pitchContextFromLead } from "../pitch/generatePitch.js";
import { isSuppressed } from "../suppression.js";
import { normalizeBusinessName } from "../../utils/text.js";
import { mapWithConcurrency, sleep } from "../../utils/async.js";
import { getCheckerRuntime, getPlacesKey } from "../../config/runtime.js";
import { logger } from "../../utils/logger.js";
import type { DiscoveredBusiness } from "../../types.js";

/**
 * Pipeline orchestration.
 *
 *   discover()      Places search per city x category → new Lead docs
 *   processLead()   website check → enrich → score → pitch → approval queue
 *   processPending()batch-processes all leads awaiting processing
 *   runFullPipeline() = discover + processPending
 */

export interface DiscoverResult {
  runId: string;
  found: number;
  created: number;
  duplicates: number;
  suppressed: number;
}

export async function discover(
  trigger: "CRON" | "MANUAL" | "API" = "MANUAL",
  override?: { cities?: string[]; categories?: string[] },
): Promise<DiscoverResult> {
  const placesKey = await getPlacesKey();
  if (!placesKey) {
    throw new Error("Google Places API key is not configured (Settings → Discovery), discovery cannot run.");
  }

  const settings = await getSettings();
  const cities = override?.cities?.length ? override.cities : settings.cities;
  const categories = override?.categories?.length ? override.categories : settings.categories;
  const queries = buildQueries(cities, categories);

  const run: SearchRunDocument = await SearchRun.create({ trigger, status: "RUNNING" });
  const totals = { found: 0, created: 0, duplicates: 0, suppressed: 0 };

  try {
    for (const q of queries) {
      const stats = { query: q.query, city: q.city, category: q.category, found: 0, created: 0, duplicates: 0, suppressed: 0, error: undefined as string | undefined };
      try {
        const businesses = await searchPlaces(q.query, q.city, q.category, {
          maxResults: settings.maxResultsPerQuery,
          apiKey: placesKey,
        });
        stats.found = businesses.length;

        for (const biz of businesses) {
          const outcome = await upsertDiscovered(biz);
          stats[outcome]++;
        }
      } catch (err) {
        stats.error = err instanceof Error ? err.message : String(err);
        logger.error({ query: q.query, err: stats.error }, "discovery query failed");
      }
      run.queries.push(stats);
      totals.found += stats.found;
      totals.created += stats.created;
      totals.duplicates += stats.duplicates;
      totals.suppressed += stats.suppressed;
      // Be a polite API citizen between queries.
      await sleep(500);
    }

    run.totals = { ...run.totals, ...totals };
    run.status = "COMPLETED";
    run.finishedAt = new Date();
    await run.save();
  } catch (err) {
    run.status = "FAILED";
    run.error = err instanceof Error ? err.message : String(err);
    run.finishedAt = new Date();
    await run.save();
    throw err;
  }

  logger.info(totals, "discovery complete");
  return { runId: String(run._id), ...totals };
}

type UpsertOutcome = "created" | "duplicates" | "suppressed";

async function upsertDiscovered(biz: DiscoveredBusiness): Promise<UpsertOutcome> {
  // Duplicate check: place id first, then normalized name + city.
  const nameNorm = normalizeBusinessName(biz.businessName);
  const existing = await Lead.findOne({
    $or: [
      { googlePlaceId: biz.googlePlaceId },
      { businessNameNormalized: nameNorm, city: biz.city },
    ],
  });
  if (existing) return "duplicates";

  // Never even store leads that match the suppression list.
  const sup = await isSuppressed({
    googlePlaceId: biz.googlePlaceId,
    websiteUrl: biz.websiteUrl,
  });
  if (sup.suppressed) return "suppressed";

  await Lead.create({
    businessName: biz.businessName,
    businessNameNormalized: nameNorm,
    category: biz.category,
    categoryRaw: biz.categoryRaw ?? [],
    city: biz.city,
    address: biz.address,
    location: biz.location,
    googlePlaceId: biz.googlePlaceId,
    googleMapsUrl: biz.googleMapsUrl,
    businessStatus: biz.businessStatus,
    openingSoon: biz.openingSoon ?? false,
    rating: biz.rating,
    userRatingCount: biz.userRatingCount,
    phone: biz.phone,
    websiteUrl: biz.websiteUrl,
    searchQuery: biz.searchQuery,
    discoverySource: "google_places",
    pipelineStage: "DISCOVERED",
  });
  return "created";
}

export interface ProcessOutcome {
  leadId: string;
  businessName: string;
  stage: string;
  score: number;
  qualified: boolean;
  websiteType: string;
}

/** Runs the full check→enrich→score→pitch flow for one lead. */
export async function processLead(lead: LeadDocument): Promise<ProcessOutcome> {
  const settings = await getSettings();

  // 1) Website health check + classification
  const { check, classification } = await checkWebsite(lead.websiteUrl);
  lead.websiteType = classification.websiteType;
  lead.websiteStatus = classification.websiteStatus;
  lead.websiteProblemSummary = classification.problemSummary;
  if (check) {
    lead.websiteCheck = { ...check, checkedAt: new Date(check.checkedAt) };
  }
  lead.pipelineStage = "CHECKED";

  // 2) Enrichment (contacts with provenance)
  await enrichLead(lead);
  lead.pipelineStage = "ENRICHED";

  // Re-check suppression now that we know email/phone/instagram.
  const sup = await isSuppressed({
    googlePlaceId: lead.googlePlaceId,
    email: lead.email,
    phoneNormalized: lead.phoneNormalized,
    websiteUrl: lead.websiteUrl,
    instagramUsername: lead.instagramUsername,
  });
  if (sup.suppressed) {
    lead.optedOut = true;
    lead.optOutReason = `Matched suppression list (${sup.match})`;
    lead.outreachStatus = "DO_NOT_CONTACT";
    lead.pipelineStage = "ARCHIVED";
    await lead.save();
    return {
      leadId: String(lead._id),
      businessName: lead.businessName,
      stage: lead.pipelineStage,
      score: 0,
      qualified: false,
      websiteType: lead.websiteType,
    };
  }

  // 3) Scoring
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
  lead.pipelineStage = scoreResult.qualified ? "QUALIFIED" : "DISQUALIFIED";

  // 4) Pitch for qualified leads
  if (scoreResult.qualified) {
    // Channel preference: email if we have one, else manual Instagram.
    lead.outreachChannel = lead.email ? "EMAIL" : lead.instagramUsername ? "INSTAGRAM_MANUAL" : "EMAIL";

    const pitch = await generatePitch(pitchContextFromLead(lead));
    lead.personalisedObservation = pitch.observation;
    lead.pitchSubject = pitch.subject;
    lead.pitchMessage = pitch.message;
    lead.pitchGeneratedAt = new Date();
    lead.pitchModel = `${pitch.provider}/${pitch.model}`;
    lead.pipelineStage = "PENDING_APPROVAL";
    lead.approval.status = "PENDING";
  }

  await lead.save();
  return {
    leadId: String(lead._id),
    businessName: lead.businessName,
    stage: lead.pipelineStage,
    score: lead.leadScore,
    qualified: scoreResult.qualified,
    websiteType: lead.websiteType,
  };
}

export interface BatchProcessResult {
  processed: number;
  qualified: number;
  disqualified: number;
  errors: Array<{ lead: string; error: string }>;
}

/**
 * Processes leads still in DISCOVERED stage, in batches, until none remain
 * (continuity: work interrupted by a crash/restart is picked up here on the
 * next run, because progress is stage-based and persisted per lead).
 */
export async function processPendingLeads(batchSize = 200, maxBatches = 50): Promise<BatchProcessResult> {
  const result: BatchProcessResult = { processed: 0, qualified: 0, disqualified: 0, errors: [] };
  const checker = await getCheckerRuntime();
  // Leads that threw stay in DISCOVERED (retried on the NEXT run); exclude
  // them from later batches of THIS run so we never spin on a poison lead.
  const failedIds: unknown[] = [];

  for (let batch = 0; batch < maxBatches; batch++) {
    const pending = await Lead.find({
      pipelineStage: "DISCOVERED",
      optedOut: { $ne: true },
      ...(failedIds.length ? { _id: { $nin: failedIds } } : {}),
    })
      .sort({ createdAt: 1 })
      .limit(batchSize);
    if (pending.length === 0) break;

    const outcomes = await mapWithConcurrency(pending, checker.concurrency, async (lead) => processLead(lead));

    let failedWholeBatch = true;
    outcomes.forEach((o, i) => {
      if (o.ok) {
        failedWholeBatch = false;
        result.processed++;
        if (o.value.qualified) result.qualified++;
        else result.disqualified++;
      } else {
        failedIds.push(pending[i]?._id);
        result.errors.push({ lead: pending[i]?.businessName ?? "unknown", error: o.error.message });
        logger.error({ lead: pending[i]?.businessName, err: o.error.message }, "lead processing failed");
      }
    });

    // A lead whose processing throws stays in DISCOVERED; if literally every
    // lead in a batch failed (DB down, etc.), stop instead of spinning.
    if (failedWholeBatch) break;
    if (pending.length < batchSize) break;
  }

  logger.info(result, "batch processing complete");
  return result;
}

export interface FullPipelineResult extends DiscoverResult, BatchProcessResult {}

export async function runFullPipeline(trigger: "CRON" | "MANUAL" | "API" = "MANUAL"): Promise<FullPipelineResult> {
  const discovery = await discover(trigger);
  const processing = await processPendingLeads();

  // Attach processing stats to the run record.
  await SearchRun.findByIdAndUpdate(discovery.runId, {
    $set: {
      "totals.processed": processing.processed,
      "totals.qualified": processing.qualified,
    },
  });

  return { ...discovery, ...processing };
}
