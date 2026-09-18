import { Lead, type LeadDocument } from "../../models/Lead.js";
import {
  SearchRun,
  type SearchQueryPlan,
  type SearchRunDocument,
  type SearchRunStatus,
} from "../../models/SearchRun.js";
import { getSettings } from "../../models/Settings.js";
import {
  buildQueries,
  searchPlaces,
} from "../discovery/googlePlaces.js";
import { checkWebsite } from "../websiteChecker/index.js";
import { resolveHiddenWebsite } from "../websiteChecker/behindLinkPage.js";
import { enrichLead } from "../enrichment/index.js";
import { scoreLead, maturityOf } from "../scoring/leadScore.js";
import { applyPitchResult, generatePitch, pitchContextFromLead } from "../pitch/generatePitch.js";
import { PitchGroupCache, type GroupedPitch } from "../pitch/pitchGroups.js";
import { assignChannel } from "../outreach/channel.js";
import { isSuppressed } from "../suppression.js";
import { normalizeBusinessName } from "../../utils/text.js";
import { DEFAULT_COUNTRY, countryFromAddress, countryOf, normalizePhone } from "../../utils/phone.js";
import { mapWithConcurrency } from "../../utils/async.js";
import { getCheckerRuntime, getPlacesKey } from "../../config/runtime.js";
import { runExtraSources, type SourceRunStats } from "../discovery/sources/runSources.js";
import { logger } from "../../utils/logger.js";
import type { DiscoveredBusiness, IncomingLead } from "../../types.js";
import { withPipelineLease } from "./coordinator.js";

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
  status: SearchRunStatus;
  totalQueries: number;
  completedQueries: number;
  failedQueries: number;
  pendingQueries: number;
  found: number;
  created: number;
  duplicates: number;
  suppressed: number;
}

export interface DiscoveryProgress {
  runId: string;
  current: number;
  total: number;
  failed: number;
  pending: number;
  query?: SearchQueryPlan;
  found: number;
  created: number;
}

export interface DiscoverOptions {
  queries?: SearchQueryPlan[];
  resumedFromRunId?: string;
  onProgress?: (progress: DiscoveryProgress) => void | Promise<void>;
}

export async function discover(
  trigger: "CRON" | "MANUAL" | "API" = "MANUAL",
  override?: { cities?: string[]; categories?: string[] },
  options: DiscoverOptions = {},
): Promise<DiscoverResult> {
  return withPipelineLease("discovery", () => discoverUnlocked(trigger, override, options));
}

async function discoverUnlocked(
  trigger: "CRON" | "MANUAL" | "API",
  override: { cities?: string[]; categories?: string[] } | undefined,
  options: DiscoverOptions,
): Promise<DiscoverResult> {
  const placesKey = await getPlacesKey();
  if (!placesKey) {
    throw new Error("Google Places API key is not configured (Settings → Discovery), discovery cannot run.");
  }

  const settings = await getSettings();
  const cities = override?.cities?.length ? override.cities : settings.cities;
  const categories = override?.categories?.length ? override.categories : settings.categories;
  const queries = options.queries?.length ? options.queries : buildQueries(cities, categories);

  const run: SearchRunDocument = await SearchRun.create({
    trigger,
    status: "RUNNING",
    plannedQueries: queries,
    resumedFrom: options.resumedFromRunId,
    heartbeatAt: new Date(),
    progress: {
      totalQueries: queries.length,
      completedQueries: 0,
      successfulQueries: 0,
      failedQueries: 0,
      pendingQueries: queries.length,
    },
  });
  const totals = { found: 0, created: 0, duplicates: 0, suppressed: 0 };

  try {
    if (options.resumedFromRunId) {
      await SearchRun.updateOne(
        { _id: options.resumedFromRunId },
        { $set: { resumedBy: run._id } },
      );
    }
    for (const q of queries) {
      const stats = { query: q.query, city: q.city, category: q.category, found: 0, created: 0, duplicates: 0, suppressed: 0, error: undefined as string | undefined };
      let queryFailed = false;
      try {
        const businesses = await searchPlaces(q.query, q.city, q.category, {
          maxResults: settings.maxResultsPerQuery,
          apiKey: placesKey,
          requestsPerMinute: settings.placesRequestsPerMinute,
        });
        stats.found = businesses.length;

        for (const biz of businesses) {
          const outcome = await upsertDiscovered(biz);
          stats[outcome]++;
        }
      } catch (err) {
        stats.error = err instanceof Error ? err.message : String(err);
        queryFailed = true;
        logger.error({ query: q.query, err: stats.error }, "discovery query failed");
      }
      run.queries.push(stats);
      totals.found += stats.found;
      totals.created += stats.created;
      totals.duplicates += stats.duplicates;
      totals.suppressed += stats.suppressed;
      run.totals = { ...run.totals, ...totals };
      run.progress.completedQueries += 1;
      if (stats.error) run.progress.failedQueries += 1;
      else run.progress.successfulQueries += 1;
      run.progress.pendingQueries = Math.max(0, queries.length - run.progress.completedQueries);
      run.heartbeatAt = new Date();
      await run.save();

      if (options.onProgress) {
        await Promise.resolve(
          options.onProgress({
            runId: String(run._id),
            current: run.progress.completedQueries,
            total: queries.length,
            failed: run.progress.failedQueries,
            pending: run.progress.pendingQueries,
            query: q,
            found: totals.found,
            created: totals.created,
          }),
        ).catch((err) => logger.warn({ err: String(err) }, "discovery progress callback failed"));
      }

      // A request already exhausted the bounded retries (or failed with a
      // permanent 4xx), so stop instead of repeating the same provider
      // failure across every remaining query. The untouched plan is resumable.
      if (queryFailed) break;
    }

    run.totals = { ...run.totals, ...totals };
    run.progress.pendingQueries = Math.max(0, queries.length - run.progress.completedQueries);
    run.status =
      run.progress.failedQueries > 0 || run.progress.pendingQueries > 0
        ? "PARTIAL"
        : "COMPLETED";
    run.finishedAt = new Date();
    run.heartbeatAt = new Date();
    await run.save();
  } catch (err) {
    run.status = "FAILED";
    run.error = err instanceof Error ? err.message : String(err);
    run.finishedAt = new Date();
    await run.save();
    throw err;
  }

  logger.info(totals, "discovery complete");
  return {
    runId: String(run._id),
    status: run.status,
    totalQueries: run.progress.totalQueries,
    completedQueries: run.progress.completedQueries,
    failedQueries: run.progress.failedQueries,
    pendingQueries: run.progress.pendingQueries,
    ...totals,
  };
}

function queryKey(q: SearchQueryPlan): string {
  return `${q.city}\u0000${q.category}\u0000${q.query}`;
}

/** Failed plus never-attempted queries from a prior run, with successes excluded. */
export function recoverableQueriesForRun(run: SearchRunDocument): SearchQueryPlan[] {
  const plan = (run.plannedQueries ?? []).length
    ? run.plannedQueries
    : run.queries.map(({ query, city, category }) => ({ query, city, category }));
  const successful = new Set(run.queries.filter((q) => !q.error).map(queryKey));
  const seen = new Set<string>();
  return plan.filter((q) => {
    const key = queryKey(q);
    if (successful.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function resumeDiscoveryRun(
  runId: string,
  trigger: "CRON" | "MANUAL" | "API" = "API",
  onProgress?: DiscoverOptions["onProgress"],
): Promise<DiscoverResult> {
  let previous: SearchRunDocument | null = null;
  try {
    previous = await SearchRun.findById(runId);
  } catch {
    // Invalid ObjectIds and missing runs intentionally share the same safe response.
  }
  if (!previous) {
    throw Object.assign(new Error("Discovery run not found."), { statusCode: 404 });
  }
  const queries = recoverableQueriesForRun(previous);
  if (queries.length === 0) {
    throw Object.assign(new Error("This discovery run has no failed or incomplete queries to resume."), {
      statusCode: 409,
    });
  }
  return discover(trigger, undefined, {
    queries,
    resumedFromRunId: String(previous._id),
    onProgress,
  });
}

export type UpsertOutcome = "created" | "duplicates" | "suppressed";

/**
 * Places-specific adapter: maps a DiscoveredBusiness to the shared upsert.
 *
 * The country is read off the business's own address rather than taken from a
 * setting, because one scan covers several countries: the cities are whatever
 * the operator listed. When the address does not say, nothing is assumed and
 * the number is kept exactly as it was found.
 */
async function upsertDiscovered(biz: DiscoveredBusiness): Promise<UpsertOutcome> {
  const country = countryFromAddress(biz.address)?.iso ?? null;
  return upsertIncomingLead(
    {
      businessName: biz.businessName,
      category: biz.category,
      categoryRaw: biz.categoryRaw,
      city: biz.city,
      address: biz.address,
      location: biz.location,
      googlePlaceId: biz.googlePlaceId,
      googleMapsUrl: biz.googleMapsUrl,
      businessStatus: biz.businessStatus,
      openingSoon: biz.openingSoon,
      rating: biz.rating,
      userRatingCount: biz.userRatingCount,
      phone: biz.phone,
      websiteUrl: biz.websiteUrl,
      searchQuery: biz.searchQuery,
      discoverySource: "google_places",
    },
    country,
  );
}

/**
 * Shared, source-agnostic upsert. Every discovery source funnels through
 * here, so dedup and suppression behave identically no matter where a lead
 * came from. New sources never conflict with Google Places: a business seen
 * by two sources is deduped to one lead, keeping whichever arrived first.
 */
export async function upsertIncomingLead(
  incoming: IncomingLead,
  /** null when the source did not say. Numbers are then kept as found. */
  country: string | null = DEFAULT_COUNTRY,
): Promise<UpsertOutcome> {
  const nameNorm = normalizeBusinessName(incoming.businessName);
  const instagram = incoming.instagramUsername?.replace(/^@/, "").trim().toLowerCase();

  // Duplicate check across every identity signal a source might carry.
  const or: Record<string, unknown>[] = [{ businessNameNormalized: nameNorm, city: incoming.city }];
  if (incoming.googlePlaceId) or.push({ googlePlaceId: incoming.googlePlaceId });
  if (incoming.websiteUrl) or.push({ websiteUrl: incoming.websiteUrl });
  if (incoming.email) or.push({ email: incoming.email.toLowerCase() });
  if (instagram) or.push({ instagramUsername: instagram });
  const existing = await Lead.findOne({ $or: or });
  if (existing) {
    // Seen before: log the review count so growth can be measured across scans.
    // Two sightings are enough to tell a business gaining customers from a
    // dormant one, which no single snapshot of Places can show.
    if (typeof incoming.userRatingCount === "number") {
      const last = existing.ratingObservations?.[existing.ratingObservations.length - 1];
      if (!last || last.count !== incoming.userRatingCount) {
        existing.ratingObservations.push({
          at: new Date(),
          count: incoming.userRatingCount,
          rating: incoming.rating,
        });
        const first = existing.ratingObservations[0];
        const weeks = (Date.now() - new Date(first.at).getTime()) / (7 * 24 * 3600 * 1000);
        if (weeks >= 0.5) {
          existing.ratingVelocity = Math.max(0, (incoming.userRatingCount - first.count) / weeks);
        }
        existing.rating = incoming.rating ?? existing.rating;
        existing.userRatingCount = incoming.userRatingCount;
        await existing.save();
      }
    }
    return "duplicates";
  }

  // Never even store leads that match the suppression list.
  const sup = await isSuppressed({
    googlePlaceId: incoming.googlePlaceId,
    websiteUrl: incoming.websiteUrl,
    email: incoming.email,
    instagramUsername: instagram,
  });
  if (sup.suppressed) return "suppressed";

  const now = new Date();

  // Have we swept this city and category before? If so, a business appearing
  // now is new to Google since our last look, which is exactly the moment to
  // reach it: before it starts shopping for an agency.
  const sweptBefore = await Lead.exists({
    city: incoming.city,
    category: incoming.category,
    createdAt: { $lt: new Date(now.getTime() - 60 * 60 * 1000) },
  });

  const contactSources: Array<{ field: string; value: string; source: string; sourceUrl?: string; collectedAt: Date }> = [];
  const provideProvenance = incoming.discoverySource === "manual_import" ? "manual" : incoming.discoverySource;
  if (incoming.email) contactSources.push({ field: "email", value: incoming.email, source: provideProvenance, sourceUrl: incoming.sourceUrl, collectedAt: now });
  if (incoming.phone) contactSources.push({ field: "phone", value: incoming.phone, source: provideProvenance, sourceUrl: incoming.sourceUrl, collectedAt: now });
  if (instagram) contactSources.push({ field: "instagram", value: instagram, source: provideProvenance, sourceUrl: incoming.sourceUrl, collectedAt: now });

  await Lead.create({
    businessName: incoming.businessName,
    businessNameNormalized: nameNorm,
    category: incoming.category,
    categoryRaw: incoming.categoryRaw ?? [],
    city: incoming.city,
    address: incoming.address,
    location: incoming.location,
    googlePlaceId: incoming.googlePlaceId,
    googleMapsUrl: incoming.googleMapsUrl,
    businessStatus: incoming.businessStatus,
    openingSoon: incoming.openingSoon ?? false,
    rating: incoming.rating,
    userRatingCount: incoming.userRatingCount,
    phone: incoming.phone,
    phoneNormalized: incoming.phone ? normalizePhone(incoming.phone, country) ?? undefined : undefined,
    email: incoming.email?.toLowerCase(),
    instagramUsername: instagram,
    instagramUrl: instagram ? `https://instagram.com/${instagram}` : undefined,
    websiteUrl: incoming.websiteUrl,
    searchQuery: incoming.searchQuery,
    discoverySource: incoming.discoverySource,
    contactSources,
    firstSeenAt: now,
    newToGoogle: Boolean(sweptBefore),
    maturity: maturityOf(incoming.userRatingCount, incoming.openingSoon),
    ratingObservations:
      typeof incoming.userRatingCount === "number"
        ? [{ at: now, count: incoming.userRatingCount, rating: incoming.rating }]
        : [],
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
  aiFallback: boolean;
}

/** Records a pitch on the lead, keeping track of whether it was shared. */
function applyPitch(lead: LeadDocument, pitch: GroupedPitch): void {
  applyPitchResult(lead, pitch);
  lead.pitchShared = Boolean(pitch.shared);
  if (pitch.groupKey) lead.pitchGroupKey = pitch.groupKey;
  else lead.set("pitchGroupKey", undefined);
}

export interface ProcessLeadOptions {
  /**
   * Refresh the audit and the score, and leave the outreach side alone.
   *
   * Set when re-checking a lead the operator has already acted on. Without it
   * a re-check ran the whole flow, which ends by writing a fresh pitch and
   * setting the lead back to PENDING_APPROVAL: pressing "Re-check website" on
   * a converted client dropped it back into the approval queue with its sent
   * message overwritten by a new one. The audit is the thing worth refreshing;
   * the decision already taken is not ours to undo.
   */
  keepOutreachState?: boolean;
}

/** Runs the full check→enrich→score→pitch flow for one lead. */
export async function processLead(
  lead: LeadDocument,
  pitches?: PitchGroupCache,
  options: ProcessLeadOptions = {},
): Promise<ProcessOutcome> {
  const settings = await getSettings();

  // 1) Website health check + classification
  let { check, classification } = await checkWebsite(lead.websiteUrl);

  // A Linktree in the Google listing, or nothing at all with an Instagram
  // handle, does not mean there is no website. The real site is often one link
  // further on, and pitching "you have no website" to somebody who has one is
  // the fastest way to lose the reply. Look before believing it.
  const looksLikeLinkPage =
    classification.websiteType === "LINK_IN_BIO_ONLY" || classification.websiteType === "MENU_PLATFORM_ONLY";
  const looksAbsent = classification.websiteType === "NO_WEBSITE" || classification.websiteType === "SOCIAL_MEDIA_ONLY";

  if (looksLikeLinkPage || looksAbsent) {
    const hidden = await resolveHiddenWebsite({
      linkPageUrl: looksLikeLinkPage ? (check?.finalUrl ?? lead.websiteUrl ?? null) : null,
      instagramUsername: lead.instagramUsername ?? null,
      businessName: lead.businessName,
    });

    if (hidden) {
      const second = await checkWebsite(hidden.url);
      // Only accept the discovery if what we found is actually a site of their
      // own. A dead link or another rented page leaves the original verdict
      // standing, which is the honest answer.
      const realTypes = new Set(["CUSTOM_WEBSITE", "POOR_WEBSITE", "SHOPIFY", "BROKEN_WEBSITE"]);
      if (realTypes.has(second.classification.websiteType)) {
        check = second.check;
        classification = second.classification;
        lead.websiteUrl = hidden.url;
        lead.websiteFoundVia = hidden.reason;
        lead.contactSources.push({
          field: "website",
          value: hidden.url,
          source: "link_page",
          sourceUrl: hidden.url,
          collectedAt: new Date(),
        });
        logger.info(
          { lead: lead.businessName, url: hidden.url, via: hidden.reason },
          "found a website hiding behind a link page",
        );
      }
    }
  }

  lead.websiteType = classification.websiteType;
  lead.websiteStatus = classification.websiteStatus;
  lead.websiteProblemSummary = classification.problemSummary;
  if (check) {
    lead.websiteCheck = { ...check, checkedAt: new Date(check.checkedAt) };
  }
  // The intermediate stages are progress markers for a lead moving through the
  // pipeline for the first time. On a re-check of a lead that has already been
  // contacted they would overwrite where it actually is with "ENRICHED".
  if (!options.keepOutreachState) lead.pipelineStage = "CHECKED";

  // 2) Enrichment (contacts with provenance)
  await enrichLead(lead, undefined, countryFromAddress(lead.address)?.iso ?? null);
  if (!options.keepOutreachState) lead.pipelineStage = "ENRICHED";

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
      aiFallback: false,
    };
  }

  // 3) Scoring
  lead.maturity = maturityOf(lead.userRatingCount, lead.openingSoon);
  const scoreResult = scoreLead(
    {
      websiteType: lead.websiteType,
      hasEmail: Boolean(lead.email),
      hasPhone: Boolean(lead.phoneNormalized ?? lead.phone),
      whatsappAvailable: lead.whatsappAvailable,
      openingSoon: lead.openingSoon,
      instagramActive: lead.instagramActive,
      strongVisualBrand: lead.strongVisualBrand,
      maturity: lead.maturity as ReturnType<typeof maturityOf>,
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
  if (!options.keepOutreachState) {
    lead.pipelineStage = scoreResult.qualified ? "QUALIFIED" : "DISQUALIFIED";
  }
  let aiFallback = false;

  // 4) Pitch for qualified leads
  if (scoreResult.qualified && !options.keepOutreachState) {
    assignChannel(lead);

    /*
     * A pitch failure must not strand the lead. Qualification and drafting used
     * to be one step, so anything that threw between them left the lead at
     * QUALIFIED with no message: invisible to the approval queue and picked up
     * by nothing, since every recovery path looked for DISCOVERED. Five hundred
     * of them accumulated that way. The stage is now advanced only when there
     * is a message, and draftPendingPitches finishes the ones that are not.
     */
    try {
      const pitch = pitches ? await pitches.pitchFor(pitchContextFromLead(lead)) : await generatePitch(pitchContextFromLead(lead));
      applyPitch(lead, pitch);
      aiFallback = Boolean(pitch.fallbackReason);
      lead.pipelineStage = "PENDING_APPROVAL";
      lead.approval.status = "PENDING";
    } catch (err) {
      lead.lastProcessingError = `pitch: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300);
      logger.warn({ lead: lead.businessName, err: lead.lastProcessingError }, "lead qualified but has no pitch yet");
    }
  }

  await lead.save();
  return {
    leadId: String(lead._id),
    businessName: lead.businessName,
    stage: lead.pipelineStage,
    score: lead.leadScore,
    qualified: scoreResult.qualified,
    websiteType: lead.websiteType,
    aiFallback,
  };
}

export interface BatchProcessResult {
  processed: number;
  qualified: number;
  disqualified: number;
  aiFallbacks: number;
  /** Messages written for leads that qualified earlier without one. */
  drafted?: number;
  errors: Array<{ lead: string; error: string }>;
}

export interface ProcessingProgress {
  current: number;
  total: number;
  processed: number;
  qualified: number;
  errors: number;
  aiFallbacks: number;
  /** Set when the phase deserves its own wording, such as drafting messages. */
  message?: string;
}

/**
 * How often a running batch may write its progress.
 *
 * Every lead completing is a write otherwise, and a batch is two hundred of
 * them across a handful of workers. A second is far below what a person can
 * see and far above what the database should be asked to absorb.
 */
const PROGRESS_REPORT_MS = 1_000;

export interface ProcessOptions {
  onProgress?: (progress: ProcessingProgress) => void | Promise<void>;
}

/**
 * Processes leads still in DISCOVERED stage, in batches, until none remain
 * (continuity: work interrupted by a crash/restart is picked up here on the
 * next run, because progress is stage-based and persisted per lead).
 */
export async function processPendingLeads(
  batchSize = 200,
  maxBatches = 50,
  options: ProcessOptions = {},
): Promise<BatchProcessResult> {
  return withPipelineLease("processing", () => processPendingLeadsUnlocked(batchSize, maxBatches, options));
}

async function processPendingLeadsUnlocked(
  batchSize: number,
  maxBatches: number,
  options: ProcessOptions,
): Promise<BatchProcessResult> {
  const result: BatchProcessResult = {
    processed: 0,
    qualified: 0,
    disqualified: 0,
    aiFallbacks: 0,
    errors: [],
  };
  const checker = await getCheckerRuntime();
  const settings = await getSettings();
  // One cache for the whole pass, so leads in the same situation share a
  // message instead of each buying their own AI call.
  const pitches = new PitchGroupCache(settings.pitch?.reuseAcrossSimilarLeads !== false);
  const total = Math.min(await Lead.countDocuments(processablePendingFilter()), batchSize * maxBatches);
  // Leads that threw stay in DISCOVERED (retried on the NEXT run); exclude
  // them from later batches of THIS run so we never spin on a poison lead.
  const failedIds: unknown[] = [];

  for (let batch = 0; batch < maxBatches; batch++) {
    const pending = await Lead.find({
      ...processablePendingFilter(),
      ...(failedIds.length ? { _id: { $nin: failedIds } } : {}),
    })
      .sort({ createdAt: 1 })
      .limit(batchSize);
    if (pending.length === 0) break;

    /*
     * Report as each lead lands, not once the batch of two hundred is done.
     *
     * A website check waits up to eight seconds and a handful run at once, so a
     * full batch is minutes of work. Reporting only at the end meant the
     * progress bar sat at the same number for those minutes and then jumped,
     * which reads as frozen rather than as busy. Throttled, because the point is
     * a bar that moves, not a write per lead.
     */
    const startedAt = result.processed + result.errors.length;
    let done = 0;
    let lastReport = 0;
    const report = async (force = false) => {
      if (!options.onProgress) return;
      const now = Date.now();
      if (!force && now - lastReport < PROGRESS_REPORT_MS) return;
      lastReport = now;
      await Promise.resolve(
        options.onProgress({
          current: startedAt + done,
          total,
          processed: result.processed,
          qualified: result.qualified,
          errors: result.errors.length,
          aiFallbacks: result.aiFallbacks,
        }),
      ).catch((err) => logger.warn({ err: String(err) }, "processing progress callback failed"));
    };

    const outcomes = await mapWithConcurrency(pending, checker.concurrency, async (lead) => {
      try {
        // Tallied here rather than after the batch, so the figures on screen
        // are the figures so far rather than the figures as of last time.
        const value = await processLead(lead, pitches);
        result.processed++;
        if (value.qualified) result.qualified++;
        else result.disqualified++;
        if (value.aiFallback) result.aiFallbacks++;
        return value;
      } finally {
        done++;
        await report();
      }
    });

    let failedWholeBatch = true;
    outcomes.forEach((o, i) => {
      if (o.ok) {
        failedWholeBatch = false;
      } else {
        failedIds.push(pending[i]?._id);
        result.errors.push({ lead: pending[i]?.businessName ?? "unknown", error: o.error.message });
        // Count the failure so a lead that can never succeed stops being
        // advertised as outstanding work on the dashboard.
        const failedId = pending[i]?._id;
        if (failedId) {
          void Lead.updateOne(
            { _id: failedId },
            { $inc: { processingAttempts: 1 }, $set: { lastProcessingError: o.error.message.slice(0, 300) } },
          ).catch(() => undefined);
        }
        logger.error({ lead: pending[i]?.businessName, err: o.error.message }, "lead processing failed");
      }
    });

    // Exact figures at the end of the batch, whatever the throttle skipped.
    await report(true);

    // A lead whose processing throws stays in DISCOVERED; if literally every
    // lead in a batch failed (DB down, etc.), stop instead of spinning.
    if (failedWholeBatch) break;
    if (pending.length < batchSize) break;
  }

  logger.info({ ...result, pitches: pitches.stats }, "batch processing complete");

  // Leads scored under an older channel rule are put right first, so the
  // messages drafted below are written for the channel they will actually go
  // out on.
  await repairOutreachChannels();

  // Anything that qualified without getting a message, here or on an earlier
  // run, is finished off before the pass is called done.
  const drafted = await draftPendingPitches({
    pitches,
    limit: batchSize * maxBatches,
    onProgress: options.onProgress
      ? async (done, draftTotal) => {
          await Promise.resolve(
            options.onProgress?.({
              current: result.processed + result.errors.length + done,
              total: total + draftTotal,
              processed: result.processed,
              qualified: result.qualified,
              errors: result.errors.length,
              aiFallbacks: result.aiFallbacks,
              message: `Writing messages for qualified leads, ${done} of ${draftTotal}`,
            }),
          ).catch(() => undefined);
        }
      : undefined,
  });
  result.drafted = drafted.drafted;
  result.aiFallbacks += drafted.aiFallbacks;

  return result;
}

/**
 * Brings stored outreach channels back in line with the contacts on the lead.
 *
 * Runs on every processing pass because the rule that picks a channel is a
 * moving target: it has been corrected twice, and each correction leaves every
 * lead scored under the old rule holding an answer nobody would give today. A
 * cheap idempotent sweep means those leads heal on the next pass instead of
 * needing a migration, and it costs nothing once everything already agrees.
 */
export async function repairOutreachChannels(limit = 5000): Promise<{ checked: number; corrected: number }> {
  const leads = await Lead.find({
    pipelineStage: { $in: ["QUALIFIED", "PENDING_APPROVAL"] },
    optedOut: { $ne: true },
  })
    .select("email instagramUsername phone phoneNormalized whatsappAvailable outreachChannel address")
    .limit(limit);

  /*
   * One write, not one per lead. This runs on every processing pass over every
   * qualified lead, and issuing five hundred round trips held the database long
   * enough that ordinary dashboard requests queued behind it and the approval
   * queue rendered as skeletons while a scan was running.
   */
  const writes: Array<{ updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> } }> = [];
  for (const lead of leads) {
    const before = lead.outreachChannel;
    const beforeFlag = lead.whatsappAvailable;
    const beforeNumber = lead.phoneNormalized;

    const correctedNumber = correctlyStampedPhone(lead);
    if (correctedNumber) lead.phoneNormalized = correctedNumber;

    assignChannel(lead);
    if (
      lead.outreachChannel !== before ||
      lead.whatsappAvailable !== beforeFlag ||
      lead.phoneNormalized !== beforeNumber
    ) {
      writes.push({
        updateOne: {
          filter: { _id: lead._id },
          update: {
            $set: {
              outreachChannel: lead.outreachChannel,
              whatsappAvailable: lead.whatsappAvailable,
              ...(lead.phoneNormalized !== beforeNumber ? { phoneNormalized: lead.phoneNormalized } : {}),
            },
          },
        },
      });
    }
  }

  if (writes.length > 0) {
    await Lead.bulkWrite(writes, { ordered: false });
    logger.info({ checked: leads.length, corrected: writes.length }, "outreach channels repaired");
  }
  return { checked: leads.length, corrected: writes.length };
}

/**
 * A number stamped with the wrong country, put right, or null if it is fine.
 *
 * Every number used to be normalised against one account-wide default, so a
 * scan covering several countries stamped +234 on all of them: a ten-digit
 * American or Egyptian number became a Nigerian mobile that does not exist, and
 * the WhatsApp route offered for it went nowhere. Re-discovering the business
 * does not fix it, because a business already on file is a duplicate and its
 * fields are left alone, so the correction has to happen here.
 *
 * Deliberately narrow. It only acts when the address says which country the
 * business is in, the stored number claims a different one, and the raw number
 * as found reads cleanly as the country the business is actually in. A number
 * written with its own dial code keeps it, so a genuine foreign contact for a
 * local business is never "corrected" into the wrong thing.
 */
function correctlyStampedPhone(lead: {
  address?: string | null;
  phone?: string | null;
  phoneNormalized?: string | null;
}): string | null {
  if (!lead.phone || !lead.phoneNormalized) return null;
  const home = countryFromAddress(lead.address);
  if (!home) return null;

  const stored = countryOf(lead.phoneNormalized);
  if (stored?.iso === home.iso) return null;

  const corrected = normalizePhone(lead.phone, home.iso);
  if (!corrected || corrected === lead.phoneNormalized) return null;
  return countryOf(corrected)?.iso === home.iso ? corrected : null;
}

export interface DraftPendingResult {
  pending: number;
  drafted: number;
  failed: number;
  aiFallbacks: number;
  reusedMessages: number;
}

/**
 * Discovered leads still worth attempting.
 *
 * The attempt limit is applied here, not only in the counts the dashboard
 * shows. It was in the count alone, so a lead that had failed three times was
 * hidden from "Process N discovered" while every scan went on retrying it: the
 * operator was told it had been given up on and the machine had not, and each
 * run spent its budget on the same leads that could not succeed. Re-checking
 * one clears its tally, which is the deliberate way back in.
 */
export const MAX_PROCESSING_ATTEMPTS = 3;

export function processablePendingFilter(): Record<string, unknown> {
  return {
    pipelineStage: "DISCOVERED",
    optedOut: { $ne: true },
    $or: [
      { processingAttempts: { $exists: false } },
      { processingAttempts: { $lt: MAX_PROCESSING_ATTEMPTS } },
    ],
  };
}

/** How many leads have qualified but are still waiting for a message. */
export function pendingPitchFilter(): Record<string, unknown> {
  return {
    pipelineStage: "QUALIFIED",
    optedOut: { $ne: true },
    $and: [
      { $or: [{ pitchMessage: { $exists: false } }, { pitchMessage: "" }, { pitchMessage: null }] },
      { $or: [{ processingAttempts: { $exists: false } }, { processingAttempts: { $lt: MAX_PROCESSING_ATTEMPTS } }] },
    ],
  };
}

/**
 * Writes the missing messages for leads that qualified but never got one.
 *
 * This exists because qualifying and drafting can come apart: an AI outage
 * mid-run, a re-score that moved leads into QUALIFIED without pitching them, a
 * process that died between the two. Without this, those leads are stranded in
 * a stage nothing looks at, and the operator sees an empty approval queue while
 * hundreds of qualified businesses sit behind it.
 */
export async function draftPendingPitches(
  options: { pitches?: PitchGroupCache; limit?: number; onProgress?: (done: number, total: number) => void | Promise<void> } = {},
): Promise<DraftPendingResult> {
  const limit = options.limit ?? 500;
  const settings = await getSettings();
  const pitches = options.pitches ?? new PitchGroupCache(settings.pitch?.reuseAcrossSimilarLeads !== false);

  const filter = pendingPitchFilter();
  const pending = await Lead.countDocuments(filter);
  const result: DraftPendingResult = { pending, drafted: 0, failed: 0, aiFallbacks: 0, reusedMessages: 0 };
  if (pending === 0) return result;

  const before = pitches.stats.reused;
  // Highest priority first: if the run is cut short, the best leads are the
  // ones that made it into the queue.
  const leads = await Lead.find(filter).sort({ priorityScore: -1, needScore: -1 }).limit(limit);

  for (const lead of leads) {
    try {
      assignChannel(lead);
      const pitch = await pitches.pitchFor(pitchContextFromLead(lead));
      applyPitch(lead, pitch);
      lead.pipelineStage = "PENDING_APPROVAL";
      lead.approval.status = "PENDING";
      lead.set("lastProcessingError", undefined);
      if (pitch.fallbackReason) result.aiFallbacks++;
      await lead.save();
      result.drafted++;
    } catch (err) {
      result.failed++;
      const message = err instanceof Error ? err.message : String(err);
      await Lead.updateOne(
        { _id: lead._id },
        { $inc: { processingAttempts: 1 }, $set: { lastProcessingError: `pitch: ${message}`.slice(0, 300) } },
      ).catch(() => undefined);
      logger.error({ lead: lead.businessName, err: message }, "could not draft a pitch for a qualified lead");
    }
    if (options.onProgress) {
      await Promise.resolve(options.onProgress(result.drafted + result.failed, leads.length)).catch(() => undefined);
    }
  }

  result.reusedMessages = pitches.stats.reused - before;
  logger.info(result, "pending pitches drafted");
  return result;
}

export interface FullPipelineResult extends DiscoverResult, BatchProcessResult {
  sources?: SourceRunStats[];
}

export interface FullPipelineOptions {
  onDiscoveryProgress?: DiscoverOptions["onProgress"];
  onProcessingProgress?: ProcessOptions["onProgress"];
}

export async function runFullPipeline(
  trigger: "CRON" | "MANUAL" | "API" = "MANUAL",
  options: FullPipelineOptions = {},
): Promise<FullPipelineResult> {
  // Google Places runs only when configured; the extra sources run whenever
  // they are toggled on. Either path alone is enough to feed the pipeline.
  const placesConfigured = Boolean(await getPlacesKey());
  const discovery: DiscoverResult = placesConfigured
    ? await discover(trigger, undefined, { onProgress: options.onDiscoveryProgress })
    : {
        runId: "",
        status: "COMPLETED",
        totalQueries: 0,
        completedQueries: 0,
        failedQueries: 0,
        pendingQueries: 0,
        found: 0,
        created: 0,
        duplicates: 0,
        suppressed: 0,
      };

  // Additive: enabled non-Places sources contribute more DISCOVERED leads.
  const sources = await runExtraSources();
  for (const s of sources) {
    discovery.found += s.found;
    discovery.created += s.created;
    discovery.duplicates += s.duplicates;
    discovery.suppressed += s.suppressed;
  }

  const processing = await processPendingLeads(200, 50, { onProgress: options.onProcessingProgress });

  if (discovery.runId) {
    await SearchRun.findByIdAndUpdate(discovery.runId, {
      $set: { "totals.processed": processing.processed, "totals.qualified": processing.qualified },
    });
  }

  return { ...discovery, ...processing, sources };
}
