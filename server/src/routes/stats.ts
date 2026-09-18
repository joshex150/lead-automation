import { Router } from "express";
import { z } from "zod";
import { Lead } from "../models/Lead.js";
import { OutreachLog } from "../models/OutreachLog.js";
import { SearchRun } from "../models/SearchRun.js";
import { asyncHandler } from "../middleware/index.js";
import { integrationStatus } from "../config/runtime.js";
import { getSettings } from "../models/Settings.js";
import { queueWorkFilter } from "../services/outreach/queue.js";
import { emailsSentToday } from "../services/outreach/email/index.js";

export const statsRouter = Router();

const toMap = (rows: Array<{ _id: string | null; count: number }>) =>
  Object.fromEntries(rows.map((row) => [row._id ?? "UNKNOWN", row.count]));

function scoreBuckets(values: number[]): Record<string, number> {
  const buckets = { "0–24": 0, "25–49": 0, "50–74": 0, "75–100": 0 };
  for (const value of values) {
    if (value < 25) buckets["0–24"]++;
    else if (value < 50) buckets["25–49"]++;
    else if (value < 75) buckets["50–74"]++;
    else buckets["75–100"]++;
  }
  return buckets;
}

/** Statuses that mean a message went out, and the narrower ones after that. */
const CONTACTED_STATUSES = ["CONTACTED", "FOLLOW_UP_SENT", "RESPONDED", "INTERESTED", "NOT_INTERESTED", "CONVERTED"];
const RESPONDED_STATUSES = ["RESPONDED", "INTERESTED", "NOT_INTERESTED", "CONVERTED"];

/** Tally by key, unknowns folded into one bucket so the totals still add up. */
function tally<T>(rows: T[], key: (row: T) => string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const k = key(row) ?? "UNKNOWN";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/**
 * Group totals against qualified counts, so a city can be judged on the share
 * of its businesses worth pitching rather than on how many were found there.
 * Sorted by qualified count: a 100% rate over two leads is not a place to go
 * next, and sorting by rate alone would put it top.
 */
function qualificationByGroup<T>(
  rows: T[],
  key: (row: T) => string | null | undefined,
  isQualified: (row: T) => boolean,
  limit = 12,
): Array<{ name: string; total: number; qualified: number; rate: number }> {
  const totals = new Map<string, { total: number; qualified: number }>();
  for (const row of rows) {
    const name = key(row) ?? "UNKNOWN";
    const entry = totals.get(name) ?? { total: 0, qualified: 0 };
    entry.total++;
    if (isQualified(row)) entry.qualified++;
    totals.set(name, entry);
  }
  return [...totals.entries()]
    .map(([name, v]) => ({ name, total: v.total, qualified: v.qualified, rate: v.total ? Math.round((v.qualified / v.total) * 100) : 0 }))
    .sort((a, b) => b.qualified - a.qualified || b.total - a.total)
    .slice(0, limit);
}

/**
 * Buckets discoveries over the reporting window.
 *
 * The bucket widens with the window so the series stays readable: a year of
 * daily points is 365 bars nobody can read, and one bar per month over a week
 * is not a series at all.
 */
function timeSeries<T>(
  rows: T[],
  at: (row: T) => Date | null | undefined,
  isQualified: (row: T) => boolean,
  from: Date | null,
  to: Date,
): { bucket: "day" | "week" | "month"; points: Array<{ date: string; discovered: number; qualified: number }> } {
  const earliest = from ?? rows.reduce<Date | null>((min, row) => {
    const d = at(row);
    return d && (!min || d < min) ? d : min;
  }, null) ?? to;
  const spanDays = Math.max(1, Math.ceil((to.getTime() - earliest.getTime()) / 86_400_000));
  const bucket = spanDays <= 45 ? "day" : spanDays <= 365 ? "week" : "month";

  const keyOf = (d: Date): string => {
    if (bucket === "month") return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    // Weeks start on the Monday, so a bar always covers a whole trading week.
    if (bucket === "week") day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
    return day.toISOString().slice(0, 10);
  };

  const counts = new Map<string, { discovered: number; qualified: number }>();
  for (const row of rows) {
    const d = at(row);
    if (!d) continue;
    const k = keyOf(d);
    const entry = counts.get(k) ?? { discovered: 0, qualified: 0 };
    entry.discovered++;
    if (isQualified(row)) entry.qualified++;
    counts.set(k, entry);
  }

  const points = [...counts.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, v]) => ({ date, ...v }));
  return { bucket, points };
}

/** GET /api/stats/analytics, decision-grade quality, recency and channel analytics. */
statsRouter.get(
  "/analytics",
  asyncHandler(async (req, res) => {
    const { days } = z
      .object({ days: z.union([z.coerce.number().int().min(1).max(3650), z.literal("all")]).default(30) })
      .parse(req.query);
    const now = new Date();
    const from = days === "all" ? null : new Date(now.getTime() - days * 86_400_000);
    const scope: Record<string, unknown> = {
      optedOut: { $ne: true },
      ...(from ? { createdAt: { $gte: from } } : {}),
    };
    const settings = await getSettings();
    const qualifiedNeed = {
      $or: [
        { needScore: { $gte: settings.scoreThreshold } },
        { needScore: { $exists: false }, leadScore: { $gte: settings.scoreThreshold } },
      ],
    };
    const contactable = [
      { email: { $nin: [null, ""] } },
      { phoneNormalized: { $nin: [null, ""] } },
      { instagramUsername: { $nin: [null, ""] } },
    ];
    const noContact = {
      email: { $in: [null, ""] },
      phoneNormalized: { $in: [null, ""] },
      instagramUsername: { $in: [null, ""] },
    };

    const [
      total,
      qualified,
      newBusinesses,
      emergingBusinesses,
      newToGoogle,
      openingSoon,
      risingActivity,
      contactableAny,
      contactableNone,
      withEmail,
      withPhone,
      withWhatsapp,
      withInstagram,
      contacted,
      interested,
      converted,
      approvedOrBeyond,
      responded,
      qualifiedOrBeyond,
      revenue,
      scoreRows,
      recentRuns,
    ] = await Promise.all([
      Lead.countDocuments(scope),
      Lead.countDocuments({ ...scope, ...qualifiedNeed }),
      Lead.countDocuments({ ...scope, maturity: "NEW" }),
      Lead.countDocuments({ ...scope, maturity: "EMERGING" }),
      Lead.countDocuments({ ...scope, newToGoogle: true }),
      Lead.countDocuments({ ...scope, openingSoon: true }),
      Lead.countDocuments({ ...scope, ratingVelocity: { $gte: 2 } }),
      Lead.countDocuments({ ...scope, $or: contactable }),
      Lead.countDocuments({ ...scope, ...noContact }),
      Lead.countDocuments({ ...scope, email: { $nin: [null, ""] } }),
      Lead.countDocuments({ ...scope, phoneNormalized: { $nin: [null, ""] } }),
      Lead.countDocuments({ ...scope, whatsappAvailable: true }),
      Lead.countDocuments({ ...scope, instagramUsername: { $nin: [null, ""] } }),
      Lead.countDocuments({ ...scope, outreachStatus: { $in: CONTACTED_STATUSES } }),
      Lead.countDocuments({ ...scope, outreachStatus: { $in: ["INTERESTED", "CONVERTED"] } }),
      Lead.countDocuments({ ...scope, outreachStatus: "CONVERTED" }),
      /*
       * Funnel stages count everything that reached the stage *or went past
       * it*, which is not the same as everything sitting in it now.
       *
       * A lead that was approved and then contacted no longer has an approval
       * status of APPROVED, so counting the current state made the approved
       * step smaller than the contacted step below it and the funnel widened
       * halfway down. Each step therefore unions the steps after it.
       */
      Lead.countDocuments({
        ...scope,
        $or: [{ "approval.status": "APPROVED" }, { outreachStatus: { $in: CONTACTED_STATUSES } }],
      }),
      Lead.countDocuments({ ...scope, outreachStatus: { $in: RESPONDED_STATUSES } }),
      Lead.countDocuments({
        ...scope,
        $or: [
          ...qualifiedNeed.$or,
          // A lead that was pitched and then rejected did reach qualification,
          // and a threshold raised since then must not erase that. The same
          // rule as /api/stats, so the overview and this page agree.
          { "approval.status": { $in: ["APPROVED", "REJECTED"] } },
          { outreachStatus: { $in: CONTACTED_STATUSES } },
        ],
      }),
      Lead.aggregate([
        { $match: { ...scope, outreachStatus: "CONVERTED", estimatedDealValue: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: "$estimatedDealValue" } } },
      ]),
      /*
       * One read, then everything grouped from it.
       *
       * The five breakdowns below used to be five more aggregations over the
       * same documents with the same filter. This endpoint already reads every
       * lead in scope for the score distributions, so grouping them here costs
       * a few extra fields on the projection and saves five round trips on a
       * request that was taking eleven seconds.
       */
      Lead.find(scope)
        .select("leadScore needScore reachScore priorityScore createdAt city category maturity discoverySource websiteType")
        .lean(),
      SearchRun.find(from ? { startedAt: { $gte: from } } : {}).sort({ startedAt: -1 }).limit(100).lean(),
    ]);

    const average = (values: number[]) =>
      values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
    const needValues = scoreRows.map((row) => row.needScore ?? row.leadScore ?? 0);
    const reachValues = scoreRows.map((row) => row.reachScore ?? 0);
    const priorityValues = scoreRows.map(
      (row, index) => row.priorityScore ?? Math.round(needValues[index] * 0.75 + reachValues[index] * 0.25),
    );

    // Same rule the database filter uses, applied to a row in hand.
    const rowQualified = (row: (typeof scoreRows)[number]): boolean => {
      const need = row.needScore ?? row.leadScore;
      return typeof need === "number" && need >= settings.scoreThreshold;
    };

    /*
     * The funnel, as rates rather than as counts.
     *
     * Each step carries how much of the step before it survived, because that
     * is the number worth acting on: five hundred discovered and four hundred
     * qualified says the discovery targeting is sound, and four hundred
     * qualified against two approved says the queue is where the work is stuck.
     */
    const stages: Array<{ id: string; label: string; count: number }> = [
      { id: "discovered", label: "Discovered", count: total },
      { id: "qualified", label: "Qualified", count: qualifiedOrBeyond },
      { id: "approved", label: "Approved", count: approvedOrBeyond },
      { id: "contacted", label: "Contacted", count: contacted },
      { id: "responded", label: "Responded", count: responded },
      { id: "converted", label: "Converted", count: converted },
    ];
    const funnel = stages.map((stage, index) => {
      const previous = index === 0 ? null : stages[index - 1];
      return {
        ...stage,
        // Share of the step before, and of everything discovered.
        fromPrevious: previous ? (previous.count ? Math.round((stage.count / previous.count) * 100) : 0) : 100,
        ofDiscovered: total ? Math.round((stage.count / total) * 100) : 0,
        dropped: previous ? Math.max(previous.count - stage.count, 0) : 0,
      };
    });

    res.json({
      window: {
        days,
        label: days === "all" ? "All time" : `Last ${days} days`,
        from: from?.toISOString() ?? null,
        to: now.toISOString(),
      },
      qualificationThreshold: settings.scoreThreshold,
      totals: {
        total,
        qualified,
        newBusinesses,
        emergingBusinesses,
        newToGoogle,
        openingSoon,
        risingActivity,
        contactableAny,
        contactableNone,
        contacted,
        interested,
        converted,
      },
      revenue: { totalDealValue: revenue[0]?.total ?? 0, convertedDeals: converted },
      contactability: {
        email: withEmail,
        phone: withPhone,
        whatsapp: withWhatsapp,
        instagram: withInstagram,
        any: contactableAny,
        none: contactableNone,
      },
      scores: {
        averageNeed: average(needValues),
        averageReach: average(reachValues),
        averagePriority: average(priorityValues),
        needBuckets: scoreBuckets(needValues),
        reachBuckets: scoreBuckets(reachValues),
      },
      funnel,
      timeline: timeSeries(scoreRows, (row) => row.createdAt, rowQualified, from, now),
      qualificationByCity: qualificationByGroup(scoreRows, (row) => row.city, rowQualified),
      qualificationByCategory: qualificationByGroup(scoreRows, (row) => row.category, rowQualified),
      byMaturity: tally(scoreRows, (row) => row.maturity),
      bySource: tally(scoreRows, (row) => row.discoverySource),
      byCity: tally(scoreRows, (row) => row.city),
      byCategory: tally(scoreRows, (row) => row.category),
      byWebsiteType: tally(scoreRows, (row) => row.websiteType),
      recentRuns,
    });
  }),
);

/** GET /api/stats, dashboard funnel + revenue tracking. */
statsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const status = await integrationStatus();
    const settings = await getSettings();

    /*
     * The funnel's scope, and it is the same scope the leads list defaults to.
     *
     * A lead that asked not to be contacted is still a business we tracked, so
     * it stays in `total` under the page heading. It is not part of the
     * commercial funnel, and leaving it in made every step of the funnel count
     * leads that clicking through to the list would not show.
     */
    const live = { optedOut: { $ne: true } } as const;
    /*
     * Every funnel figure counts the leads that reached a stage *or went past
     * it*, never the ones sitting in it right now.
     *
     * Current state is the wrong measure for a funnel and it showed: a lead
     * that was contacted is no longer awaiting approval and a lead that
     * converted is no longer merely interested, so the steps did not shrink
     * from top to bottom, they jumped about. "Discovered" was read off the
     * DISCOVERED stage, which empties as soon as a scan processes what it
     * found, so the first step of the funnel was usually near zero with
     * hundreds of leads shown below it, and "interested / contacted" came out
     * well over 100%.
     */
    const [byStage, byWebsiteType, byCity, byOutreach, bySource, totals, revenue, convertedDealsCount, queueByChannel, recentRuns, recentActivity, sentToday] =
      await Promise.all([
        Lead.aggregate([{ $group: { _id: "$pipelineStage", count: { $sum: 1 } } }]),
        Lead.aggregate([{ $group: { _id: "$websiteType", count: { $sum: 1 } } }]),
        Lead.aggregate([{ $group: { _id: "$city", count: { $sum: 1 } } }]),
        /*
         * One pass, eight figures.
         *
         * Every count below used to be its own countDocuments over the whole
         * collection: the total, the opt-outs, and each step of the funnel,
         * eight scans asking eight versions of the same question. The answer to
         * all of them is in one grouping by the three fields they test, which
         * is at most a few dozen buckets however many leads there are. This
         * endpoint is read on every page mount and on a poll from every open
         * view, and it is what made the approval queue sit behind skeletons
         * while it ran.
         */
        Lead.aggregate<{ _id: { status: string | null; approval: string | null; optedOut: boolean | null }; count: number }>([
          {
            $group: {
              _id: { status: "$outreachStatus", approval: "$approval.status", optedOut: "$optedOut" },
              count: { $sum: 1 },
            },
          },
        ]),
        Lead.aggregate([{ $group: { _id: "$discoverySource", count: { $sum: 1 } } }]),
        Promise.all([
          // The same leads the queue itself lists, so the badge in the sidebar,
          // the card on the overview and the heading on the queue page are one
          // number rather than three.
          Lead.countDocuments(queueWorkFilter({ reachableOnly: true })),
          // The only one that cannot come from the grouping above: it tests a
          // score against a threshold rather than an exact value.
          Lead.countDocuments({
            ...live,
            $or: [
              { needScore: { $gte: settings.scoreThreshold } },
              { needScore: { $exists: false }, leadScore: { $gte: settings.scoreThreshold } },
              { "approval.status": { $in: ["APPROVED", "REJECTED"] } },
              { outreachStatus: { $in: CONTACTED_STATUSES } },
            ],
          }),
        ]),
        // Sum of deal values (aggregation). The count of deals is taken from a
        // separate countDocuments below, keeping this portable across
        // Mongo-compatible backends that don't implement $cond / constant $sum.
        // Same scope as the converted figure in the funnel, or the overview
        // reports revenue from more deals than it says were won.
        Lead.aggregate([
          { $match: { ...live, outreachStatus: "CONVERTED", estimatedDealValue: { $gt: 0 } } },
          { $group: { _id: null, total: { $sum: "$estimatedDealValue" } } },
        ]),
        Lead.countDocuments({ ...live, outreachStatus: "CONVERTED", estimatedDealValue: { $gt: 0 } }),
        // How the approval queue splits by channel. Without this the queue's
        // filter buttons look broken when one of them is legitimately empty:
        // the operator presses Email, sees nothing, and concludes the button
        // does not work rather than that no lead has an address.
        Lead.aggregate([
          { $match: queueWorkFilter() },
          { $group: { _id: "$outreachChannel", count: { $sum: 1 } } },
        ]),
        SearchRun.find().sort({ startedAt: -1 }).limit(5).lean(),
        OutreachLog.find().sort({ createdAt: -1 }).limit(15).populate("leadId", "businessName city").lean(),
        // How much sending is left today. The cap used to announce itself only
        // as a 429 on the send the operator had already decided to make, which
        // is the last possible moment to learn you cannot.
        emailsSentToday(),
      ]);

    const [pendingApproval, qualified] = totals;

    /*
     * The funnel, read off the one grouping.
     *
     * `live` here is the same rule the database filter uses, applied to a
     * bucket in hand: a lead that opted out is still tracked but is not part of
     * the commercial funnel.
     */
    const CONTACTED_SET = new Set(CONTACTED_STATUSES);
    const RESPONDED_SET = new Set(RESPONDED_STATUSES);
    let total = 0;
    let optedOut = 0;
    let discovered = 0;
    let approved = 0;
    let contacted = 0;
    let responded = 0;
    let interested = 0;
    let converted = 0;
    const outreachTally: Record<string, number> = {};

    for (const row of byOutreach) {
      const status = row._id?.status ?? "UNKNOWN";
      const count = row.count;
      total += count;
      outreachTally[status] = (outreachTally[status] ?? 0) + count;

      if (row._id?.optedOut === true) {
        optedOut += count;
        continue;
      }
      discovered += count;

      const wasContacted = CONTACTED_SET.has(status);
      if (wasContacted) contacted += count;
      if (RESPONDED_SET.has(status)) responded += count;
      if (status === "INTERESTED" || status === "CONVERTED") interested += count;
      if (status === "CONVERTED") converted += count;
      // Reaching the approved step means approved *or past it*: a lead
      // contacted without a recorded approval still got there.
      if (row._id?.approval === "APPROVED" || wasContacted) approved += count;
    }

    res.json({
      totals: {
        total,
        discovered,
        pendingApproval,
        qualified,
        approved,
        contacted,
        responded,
        interested,
        converted,
        optedOut,
      },
      qualificationThreshold: settings.scoreThreshold,
      revenue: {
        totalDealValue: revenue[0]?.total ?? 0,
        convertedDeals: convertedDealsCount,
      },
      byStage: toMap(byStage),
      byWebsiteType: toMap(byWebsiteType),
      byCity: toMap(byCity),
      byOutreachStatus: outreachTally,
      bySource: toMap(bySource),
      queueByChannel: toMap(queueByChannel),
      email: {
        sentToday,
        dailyCap: settings.dailyEmailCap,
        remaining: Math.max(0, settings.dailyEmailCap - sentToday),
      },
      onboardedAt: settings.onboardedAt,
      recentRuns,
      recentActivity,
      integrations: {
        googlePlaces: status.googlePlaces.configured,
        ai: status.ai.configured,
        aiProvider: status.ai.provider,
        email: status.email.configured,
        emailProvider: status.email.provider,
        // kept for older dashboard builds
        gmail: status.email.configured && status.email.provider === "gmail",
        authEnabled: status.authEnabled,
      },
    });
  }),
);
