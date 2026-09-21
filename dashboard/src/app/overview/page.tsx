"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  RiInboxArchiveLine,
  RiMailSendLine,
  RiEmotionHappyLine,
  RiTrophyLine,
  RiPlayCircleLine,
  RiRadarLine,
  RiCheckboxCircleFill,
  RiCloseCircleFill,
  RiCloseLine,
  RiStopCircleLine,
  RiErrorWarningLine,
  RiArrowRightLine,
  RiTimeLine,
  RiBarChartBoxLine,
  RiRestartLine,
  RiSparkling2Line,
} from "react-icons/ri";
import { api } from "@/lib/api";
import { useLiveData } from "@/lib/live";
import { useTheme } from "@/lib/theme/provider";
import { Counter, Reveal, Stagger, StaggerItem } from "@/lib/theme/motion";
import { SECTION_ITEMS } from "@/lib/theme/tokens";
import type {
  OutreachLogEntry,
  PipelineJob,
  PipelineOperationalStatus,
  Stats,
  TemplatePitchSummary,
} from "@/lib/types";

/**
 * Column spans as literal class names, because Tailwind reads the source rather
 * than the running program: a template string like `xl:col-span-${n}` produces
 * no CSS at all.
 */
const SPAN_CLASS: Record<number, string> = {
  4: "xl:col-span-4",
  5: "xl:col-span-5",
  7: "xl:col-span-7",
  12: "xl:col-span-12",
};

const SECTION_SPAN: Record<string, number> = Object.fromEntries(SECTION_ITEMS.map((s) => [s.id, s.span]));

/*
 * Where a cumulative figure sends you.
 *
 * Every headline count includes the leads that went past the stage as well as
 * the ones sitting in it, so the link has to ask for the same set. A card
 * reading 48 contacted that opened a list of 6 was the figure and the filter
 * disagreeing, and the list is the one people believe.
 */
const CONTACTED_HREF =
  "/leads?outreachStatus=CONTACTED,FOLLOW_UP_SENT,RESPONDED,INTERESTED,NOT_INTERESTED,CONVERTED";
const INTERESTED_HREF = "/leads?outreachStatus=INTERESTED,CONVERTED";

/** Same reason as the spans: the tone has to resolve to a class Tailwind saw. */
const TONE_FILL: Record<string, string> = {
  brand: "bg-brand-600",
  cta: "bg-cta-600",
  rose: "bg-rose-600",
  emerald: "bg-emerald-600",
};

export default function OverviewPage() {
  const { theme } = useTheme();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [operations, setOperations] = useState<PipelineOperationalStatus | null>(null);
  const [starting, setStarting] = useState<PipelineJob["type"] | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const [stopping, setStopping] = useState(false);
  const previousActiveJob = useRef<string | null>(null);
  const operationsReady = useRef(false);

  const load = useCallback(() => {
    let cancelled = false;
    api
      .stats()
      .then((next) => {
        if (cancelled) return;
        setStats(next);
        setError(null);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useLiveData(load, 20000);

  const loadOperations = useCallback(async () => {
    try {
      const next = await api.pipelineStatus();
      const completedJob =
        operationsReady.current && previousActiveJob.current && !next.activeJob
          ? next.latestJob
          : null;
      previousActiveJob.current = next.activeJob?._id ?? null;
      operationsReady.current = true;
      setOperations(next);
      if (completedJob) {
        if (completedJob.status === "COMPLETED") {
          // A rewrite processes and qualifies nothing, so the scan wording would
          // report it as a run that found nothing at all.
          toast.success(
            completedJob.type === "REWRITE_PITCHES"
              ? `${(completedJob.progress.rewritten ?? 0).toLocaleString()} message${completedJob.progress.rewritten === 1 ? "" : "s"} rewritten, ${(completedJob.progress.reusedMessages ?? 0).toLocaleString()} of them reused from a shared draft.`
              : `Pipeline finished: ${completedJob.progress.processed.toLocaleString()} processed, ${completedJob.progress.qualified.toLocaleString()} qualified.`,
          );
        } else {
          toast.error(completedJob.error ?? completedJob.progress.message);
        }
        load();
      }
    } catch {
      // The primary dashboard request already reports API connectivity. Keep
      // background polling quiet during a transient restart.
    }
  }, [load]);

  /*
   * Poll faster while something is running, and only re-arm when the run
   * itself changes.
   *
   * This effect depended on `operations?.activeJob`, which is a fresh object on
   * every response. Each poll therefore changed the dependency, which tore the
   * interval down, re-ran the effect and fired another request immediately: a
   * loop with no delay in it at all, hammering the status endpoint for as long
   * as a scan was running, which is exactly when the server can least afford
   * it. The job's id is the thing that actually changes when the work does.
   */
  const activeJobId = operations?.activeJob?._id ?? null;
  useEffect(() => {
    void loadOperations();
    const timer = window.setInterval(() => void loadOperations(), activeJobId ? 3000 : 12000);
    return () => window.clearInterval(timer);
  }, [loadOperations, activeJobId]);

  function adoptStartedJob(job: PipelineJob): void {
    previousActiveJob.current = job._id;
    operationsReady.current = true;
    setOperations((current) => ({
      activeJob: job,
      latestJob: job,
      discoveredPending: current?.discoveredPending ?? 0,
      pitchPending: current?.pitchPending ?? 0,
      templatePitchPending: current?.templatePitchPending ?? 0,
      stalledLeads: current?.stalledLeads ?? 0,
      resumableRun: current?.resumableRun ?? null,
    }));
  }

  /**
   * Puts down the report of a run that went wrong.
   *
   * The panel is hidden immediately rather than after the round trip, because
   * pressing dismiss and watching the thing stay put is the complaint this is
   * answering. If the write fails it comes back, with a reason.
   */
  async function dismissReport() {
    const job = operations?.latestJob;
    if (!job) return;
    setDismissing(true);
    const acknowledgedAt = new Date().toISOString();
    setOperations((current) => (current?.latestJob ? { ...current, latestJob: { ...current.latestJob, acknowledgedAt } } : current));
    try {
      await api.acknowledgeJob(job._id);
    } catch (err) {
      setOperations((current) =>
        current?.latestJob ? { ...current, latestJob: { ...current.latestJob, acknowledgedAt: undefined } } : current,
      );
      toast.error(err instanceof Error ? err.message : "Could not dismiss the report");
    } finally {
      setDismissing(false);
    }
  }

  /**
   * Stops a run that is going nowhere.
   *
   * The server releases the lock whether or not the run notices, so the next
   * scan can start immediately. Waiting for a request that never returns is
   * exactly the case this exists for.
   */
  async function stopScan() {
    const job = operations?.activeJob;
    if (!job) return;
    setStopping(true);
    try {
      await api.cancelJob(job._id);
      toast.success("Scan stopped. Everything it had already found was kept.");
      await loadOperations();
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not stop the scan");
    } finally {
      setStopping(false);
    }
  }

  async function runPipeline() {
    setStarting("FULL");
    try {
      const { job } = await api.startFullJob();
      adoptStartedJob(job);
      toast.success("Full scan started safely in the background.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Pipeline could not start");
    } finally {
      setStarting(null);
    }
  }

  async function processDiscovered() {
    setStarting("PROCESS");
    try {
      const { job } = await api.startProcessJob();
      adoptStartedJob(job);
      toast.success("Existing discovered leads are now being processed.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Processing could not start");
    } finally {
      setStarting(null);
    }
  }

  async function resumeDiscovery() {
    if (!operations?.resumableRun) return;
    setStarting("RESUME_DISCOVERY");
    try {
      const { job } = await api.resumeDiscoveryJob(operations.resumableRun.runId);
      adoptStartedJob(job);
      toast.success(`Retrying ${operations.resumableRun.recoverableQueries} failed or incomplete searches.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Discovery could not resume");
    } finally {
      setStarting(null);
    }
  }

  /*
   * Rates are read against the step above them, and every step is cumulative.
   *
   * These used to divide by the count of leads whose status is *currently*
   * CONTACTED or INTERESTED. A lead that replied is no longer merely contacted
   * and a lead that converted is no longer merely interested, so the divisor
   * shrank as the numerator grew: ten interested against two still-uncontacted
   * leads printed "500% became interested" on the card. With cumulative counts
   * the numerator is always a subset of the divisor, so these stay within 100.
   */
  const insights = useMemo(() => {
    if (!stats) return null;
    const { discovered, contacted, interested, converted, pendingApproval } = stats.totals;
    const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
    return {
      approvalShare: share(pendingApproval, discovered),
      interestRate: share(interested, contacted),
      closeRate: share(converted, interested),
      averageDeal:
        stats.revenue.convertedDeals > 0 ? Math.round(stats.revenue.totalDealValue / stats.revenue.convertedDeals) : 0,
    };
  }, [stats]);

  if (error) {
    return (
      <div className="page-shell">
        <div className="empty-state mt-10">
          <div className="empty-state-icon text-rose-500">
            <RiErrorWarningLine />
          </div>
          <h1 className="mt-4 font-heading text-xl font-bold">The dashboard cannot reach the API</h1>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-slate-500">{error}</p>
          <p className="mt-3 text-xs text-slate-400">
            Check API_URL and API_KEY on the dashboard service, and confirm the server is running.
          </p>
        </div>
      </div>
    );
  }

  if (!stats || !insights) return <OverviewSkeleton />;
  const pipelineBusy = Boolean(operations?.activeJob || starting);

  /*
   * The commercial funnel, and it only narrows.
   *
   * "Discovered" was read off the count of leads sitting in the DISCOVERED
   * stage, which is the count of leads a scan has found and *not yet
   * processed*: it empties to near zero at the end of every run. The first bar
   * was therefore usually a handful with hundreds of leads charted below it,
   * and "from prior stage" came out in the thousands of percent. Each step now
   * counts everything that reached it or went past it, the same rule the
   * analytics page uses, so the two pages agree and the shape is a funnel.
   */
  const funnel: Array<[string, number, string]> = [
    ["Discovered", stats.totals.discovered, "/leads"],
    ["Qualified", stats.totals.qualified, `/leads?minScore=${stats.qualificationThreshold}`],
    ["Approved", stats.totals.approved, "/leads?approvalStatus=APPROVED"],
    ["Contacted", stats.totals.contacted, CONTACTED_HREF],
    ["Interested", stats.totals.interested, INTERESTED_HREF],
    ["Converted", stats.totals.converted, "/leads?outreachStatus=CONVERTED"],
  ];
  const funnelMax = Math.max(...funnel.map(([, value]) => value), 1);

  const noRoute = stats.queueByChannel?.NONE ?? 0;
  const stalled = operations?.stalledLeads ?? 0;

  const attention = [
    !stats.integrations.googlePlaces
      ? { title: "Discovery source disconnected", detail: "Google Places is not configured.", href: "/settings", tone: "rose" }
      : null,
    !stats.integrations.ai
      ? { title: "AI pitch writer unavailable", detail: "The engine is using template fallback pitches.", href: "/settings", tone: "cta" }
      : null,
    !stats.integrations.email
      ? { title: "Email delivery unavailable", detail: "Approved email leads cannot be dispatched yet.", href: "/settings", tone: "rose" }
      : null,
    stats.totals.pendingApproval > 0
      ? {
          title: `${stats.totals.pendingApproval} lead${stats.totals.pendingApproval === 1 ? "" : "s"} awaiting review`,
          detail: "Approval is the current pipeline bottleneck.",
          href: "/queue",
          tone: "brand",
        }
      : null,
    /*
      The queue count is now the reachable leads only, which is what the queue
      itself lists. Qualified businesses with no email, handle or mobile are
      real work and would otherwise appear in no figure on this page at all.
    */
    noRoute > 0
      ? {
          title: `${noRoute} qualified lead${noRoute === 1 ? "" : "s"} with no way to reach them`,
          detail: "A pitch is written and waiting; they need a contact before it can go anywhere.",
          href: "/queue",
          tone: "cta",
        }
      : null,
    /*
      Work that has given up retrying is still work. Nothing picks these up
      again, and until this line they were in no figure on any page: the
      quietest way for a pipeline to stop part-way.
    */
    stalled > 0
      ? {
          title: `${stalled} lead${stalled === 1 ? "" : "s"} could not be processed`,
          detail: "They failed three times and are no longer retried. Open one to see why.",
          href: "/leads?stage=DISCOVERED,QUALIFIED",
          tone: "rose",
        }
      : null,
  ].filter(Boolean) as Array<{ title: string; detail: string; href: string; tone: string }>;

  const websiteMix = Object.entries(stats.byWebsiteType)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6);

  /**
   * Every headline figure, keyed by the id the theme orders them with. Adding
   * one here and to METRIC_ITEMS is all it takes for it to become arrangeable.
   */
  const metrics: Record<string, React.ReactNode> = {
    pending: (
      <MetricCard
        icon={<RiInboxArchiveLine />}
        label="Awaiting approval"
        value={stats.totals.pendingApproval}
        context={`${insights.approvalShare}% of all tracked leads`}
        href="/queue"
        accent="accent-brand"
        iconClass="text-brand-600"
      />
    ),
    contacted: (
      <MetricCard
        icon={<RiMailSendLine />}
        label="Contacted"
        value={stats.totals.contacted}
        context={`${insights.interestRate}% became interested`}
        href={CONTACTED_HREF}
        accent="accent-purple"
        iconClass="text-purple-600"
      />
    ),
    interested: (
      <MetricCard
        icon={<RiEmotionHappyLine />}
        label="Interested"
        value={stats.totals.interested}
        context={`${insights.closeRate}% converted to wins`}
        href={INTERESTED_HREF}
        accent="accent-emerald"
        iconClass="text-emerald-600"
      />
    ),
    revenue: (
      <MetricCard
        icon={<RiTrophyLine />}
        label="Revenue won"
        value={stats.revenue.totalDealValue}
        prefix="₦"
        context={
          stats.revenue.convertedDeals > 0
            ? `₦${insights.averageDeal.toLocaleString()} average deal`
            : "No converted deals recorded yet"
        }
        accent="accent-cta"
        iconClass="text-cta-500"
      />
    ),
  };

  const visibleMetrics = theme.layout.metricOrder.filter(
    (id) => !theme.layout.metricHidden.includes(id) && metrics[id],
  );

  const sections: Record<string, React.ReactNode> = {
    metrics: visibleMetrics.length > 0 && (
      <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {visibleMetrics.map((id) => (
          <StaggerItem key={id} className="min-w-0">
            {metrics[id]}
          </StaggerItem>
        ))}
      </Stagger>
    ),

    funnel: (
      <div className="panel accent-brand border-t-4">
        <div className="section-heading">
          <div>
            <h2 className="section-title">Pipeline funnel</h2>
            <p className="section-description">Current volume and drop-off at each commercial stage.</p>
          </div>
          <span className="status-badge text-brand-600">{stats.totals.converted} wins</span>
        </div>
        <div className="space-y-4">
          {funnel.map(([label, value, href], index) => {
            const previous = index === 0 ? value : funnel[index - 1][1];
            const conversion = index === 0 || previous === 0 ? 100 : Math.round((value / previous) * 100);
            return (
              <Link key={label} href={href} className="group block">
                <div className="flex items-end justify-between gap-4 text-sm">
                  <div>
                    <span className="font-semibold text-slate-700 group-hover:text-brand-600 dark:text-slate-200">{label}</span>
                    {index > 0 && <span className="ml-2 text-xs text-slate-400">{conversion}% from prior stage</span>}
                  </div>
                  <span className="font-heading font-extrabold tabular-nums">{value.toLocaleString()}</span>
                </div>
                <div className="mt-2 h-3 border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800">
                  <div
                    className="h-full bg-brand-600 transition-[width] duration-500 ease-theme"
                    style={{ width: `${Math.max((value / funnelMax) * 100, value > 0 ? 2 : 0)}%` }}
                  />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    ),

    attention: (
      <div className="panel accent-cta border-t-4">
        <div className="section-heading">
          <div>
            <h2 className="section-title">Needs attention</h2>
            <p className="section-description">Operational blockers and the most valuable next actions.</p>
          </div>
          <RiErrorWarningLine className="h-5 w-5 text-cta-500" />
        </div>
        {attention.length === 0 ? (
          <div className="border border-emerald-500/40 bg-emerald-500/5 p-4 text-sm text-emerald-700 dark:text-emerald-400">
            <p className="font-bold">Operations are healthy</p>
            <p className="mt-1 text-xs opacity-80">Providers are configured and the approval queue is clear.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200 border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {attention.map((item) => (
              <Link key={item.title} href={item.href} className="flex items-start gap-3 p-4 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <span className={`mt-1 h-2 w-2 shrink-0 ${TONE_FILL[item.tone] ?? "bg-brand-600"}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">{item.title}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">{item.detail}</span>
                </span>
                <RiArrowRightLine className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              </Link>
            ))}
          </div>
        )}
      </div>
    ),

    discovery: (
      <div className="panel accent-purple border-t-4">
        <div className="section-heading">
          <div>
            <h2 className="section-title">Discovery pulse</h2>
            <p className="section-description">New leads created in the most recent runs.</p>
          </div>
          <RiRadarLine className="h-5 w-5 text-purple-600" />
        </div>
        <RunBars runs={stats.recentRuns} />
        {/* The chart already says so when there is nothing; a second empty
            message under it just repeated itself. */}
        {(stats.recentRuns ?? []).length > 0 && (
          <div className="mt-5 divide-y divide-slate-200 border-t border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {(stats.recentRuns ?? []).slice(0, 4).map((run) => (
              <div key={run._id} className="flex items-center justify-between gap-3 py-3 text-xs">
                <span className="text-slate-500 dark:text-slate-400">
                  {new Date(run.startedAt).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}
                </span>
                <span className="font-bold tabular-nums">+{run.totals?.created ?? 0} new</span>
              </div>
            ))}
          </div>
        )}
      </div>
    ),

    "website-mix": (
      <div className="panel accent-slate border-t-4">
        <div className="section-heading">
          <div>
            <h2 className="section-title">Website opportunity mix</h2>
            <p className="section-description">The strongest website sales angles in the database.</p>
          </div>
        </div>
        <div className="space-y-3">
          {websiteMix.map(([type, count]) => (
            <Link
              key={type}
              href={`/leads?websiteType=${type}`}
              className="flex items-center gap-3 border-b border-slate-200 pb-3 text-sm last:border-0 last:pb-0 dark:border-slate-800"
            >
              <span className="min-w-0 flex-1 capitalize text-slate-600 hover:text-brand-600 dark:text-slate-300">
                {type.replaceAll("_", " ").toLowerCase()}
              </span>
              <span className="font-heading font-extrabold tabular-nums">{count}</span>
              <span className="w-16 text-right text-xs text-slate-400">
                {Math.round((count / Math.max(stats.totals.total, 1)) * 100)}%
              </span>
            </Link>
          ))}
        </div>
      </div>
    ),

    integrations: (
      <div className="panel accent-emerald border-t-4">
        <div className="section-heading">
          <div>
            <h2 className="section-title">Integration health</h2>
            <p className="section-description">Provider readiness for the complete automation loop.</p>
          </div>
        </div>
        <div className="divide-y divide-slate-200 border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          <IntegrationRow ok={stats.integrations.googlePlaces} label="Google Places discovery" />
          <IntegrationRow ok={stats.integrations.ai} label={`AI writer · ${stats.integrations.aiProvider || "none"}`} />
          <IntegrationRow ok={stats.integrations.email} label={`Email · ${stats.integrations.emailProvider || "none"}`} />
          <IntegrationRow ok={stats.integrations.authEnabled} label="API authentication" />
        </div>
        <Link href="/settings" className="btn-ghost mt-4 w-full">
          Configure integrations <RiArrowRightLine className="h-4 w-4" />
        </Link>
      </div>
    ),

    activity: (
      <div className="panel accent-brand border-t-4">
        <div className="section-heading">
          <div>
            <h2 className="section-title">Recent outreach activity</h2>
            <p className="section-description">The latest approval, delivery, response, and conversion events.</p>
          </div>
          <RiTimeLine className="h-5 w-5 text-brand-600" />
        </div>
        {stats.recentActivity.length === 0 ? (
          <div className="empty-state min-h-48">
            <p className="text-sm font-bold">No outreach activity yet</p>
            <p className="mt-1 text-xs text-slate-400">Approve or contact a lead to begin the activity timeline.</p>
          </div>
        ) : (
          <div className="timeline grid gap-x-8 md:grid-cols-2">
            {stats.recentActivity.slice(0, 10).map((activity) => (
              <ActivityItem key={activity._id} activity={activity} />
            ))}
          </div>
        )}
      </div>
    ),
  };

  const visibleSections = theme.layout.sectionOrder.filter(
    (id) => !theme.layout.sectionHidden.includes(id) && sections[id],
  );

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="page-kicker">Live operations</p>
          <h1 className="page-title">Lead engine overview</h1>
          <p className="page-subtitle">
            {stats.totals.total.toLocaleString()} businesses tracked across the discovery, approval, outreach, and conversion pipeline.
          </p>
        </div>
        <div className="page-actions">
          <Link href="/analytics" className="btn-ghost">
            <RiBarChartBoxLine className="h-4 w-4" /> Analytics
          </Link>
          <Link href="/leads" className="btn-ghost">
            View all leads <RiArrowRightLine className="h-4 w-4" />
          </Link>
          {/*
            One button for both kinds of unfinished work, because one job does
            both. Leads that qualified without a message are the more urgent of
            the two: they are not in the approval queue and nothing else is
            looking for them, so without this they are simply lost.
          */}
          {((operations?.discoveredPending ?? 0) > 0 || (operations?.pitchPending ?? 0) > 0) && (
            <button onClick={processDiscovered} disabled={pipelineBusy} className="btn-ghost">
              {starting === "PROCESS" ? (
                <span className="loader-spinner h-4 w-4 border-2 border-slate-400/40 border-t-slate-600" />
              ) : (
                <RiRestartLine className="h-4 w-4" />
              )}
              {(operations?.pitchPending ?? 0) > 0
                ? `Write ${operations?.pitchPending?.toLocaleString()} pending message${operations?.pitchPending === 1 ? "" : "s"}`
                : `Process ${operations?.discoveredPending.toLocaleString()} discovered`}
            </button>
          )}
          {operations?.resumableRun && (
            <button onClick={resumeDiscovery} disabled={pipelineBusy} className="btn-ghost">
              {starting === "RESUME_DISCOVERY" ? (
                <span className="loader-spinner h-4 w-4 border-2 border-slate-400/40 border-t-slate-600" />
              ) : (
                <RiRestartLine className="h-4 w-4" />
              )}
              Resume {operations.resumableRun.recoverableQueries} searches
            </button>
          )}
          <button onClick={runPipeline} disabled={pipelineBusy || !stats.integrations.googlePlaces} className="btn-primary">
            {starting === "FULL" || operations?.activeJob ? (
              <span className="loader-spinner h-4 w-4 border-2 border-white/40 border-t-white" />
            ) : (
              <RiPlayCircleLine className="h-5 w-5" />
            )}
            {operations?.activeJob ? "Running…" : "Run full scan"}
          </button>
        </div>
      </header>

      {operations?.activeJob && (
        <PipelineProgress job={operations.activeJob} onStop={stopScan} stopping={stopping} />
      )}

      {/*
        A scan that ended badly has to say so on the page, not only in a toast
        that has already gone. Reloading used to show nothing at all, which
        reads as "everything is fine" when it is not.
      */}
      {!operations?.activeJob &&
        !operations?.latestJob?.acknowledgedAt &&
        (operations?.latestJob?.status === "FAILED" || operations?.latestJob?.status === "PARTIAL") && (
          <ScanReport job={operations.latestJob} onDismiss={dismissReport} dismissing={dismissing} />
        )}

      {/*
        Offered only when there is nothing running, because the rewrite takes
        the same exclusive lock a scan does and would be refused anyway.
      */}
      {!operations?.activeJob && (operations?.templatePitchPending ?? 0) > 0 && (
        <TemplatePitchPanel
          pending={operations!.templatePitchPending!}
          busy={pipelineBusy}
          onStarted={adoptStartedJob}
        />
      )}

      <div className="mt-8 grid items-start gap-6 xl:grid-cols-12">
        {visibleSections.map((id) => (
          <Reveal key={id} className={`min-w-0 ${SPAN_CLASS[SECTION_SPAN[id] ?? 12] ?? "xl:col-span-12"}`}>
            {sections[id]}
          </Reveal>
        ))}
      </div>
    </div>
  );
}

/**
 * The messages nobody will ever look at again unless this says so.
 *
 * A scan run before an AI provider was connected still produces a message for
 * every lead, from the built-in template, and those leads go into the approval
 * queue looking exactly as finished as the rest. Nothing counts them, nothing
 * retries them, and the only way to improve one was to open it and press
 * regenerate, which is one AI call for one lead.
 *
 * So the unit of choice here is the category, and the number that leads is the
 * cost rather than the volume. They are not close: messages are shared between
 * leads in the same situation, so four hundred leads is usually a dozen calls.
 * An operator deciding what to spend credits on needs that number in front of
 * them, not a count of leads that implies four hundred.
 */
function TemplatePitchPanel({
  pending,
  busy,
  onStarted,
}: {
  pending: number;
  busy: boolean;
  onStarted: (job: PipelineJob) => void;
}) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<TemplatePitchSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);

  /*
   * Fetched once, and only once the panel is opened.
   *
   * Opening it is what asks for the aggregation, which runs over every queued
   * lead and is not worth doing on the visits to this page that are about
   * something else. `failed` is what stops a refusal turning into a loop:
   * without it a failed request leaves `summary` null, the effect re-runs on
   * the next render and asks again, with a toast each time.
   */
  useEffect(() => {
    if (!open || summary || loading || failed) return;
    setLoading(true);
    api
      .templatePitches()
      .then((result) => {
        setSummary(result);
        // Everything selected to begin with, because "fix all of it" is the
        // common case and the picker is there for the times it is not.
        setChosen(result.categories.map((entry) => entry.category));
      })
      .catch((err) => {
        setFailed(true);
        toast.error(err instanceof Error ? err.message : "Could not read the messages");
      })
      .finally(() => setLoading(false));
  }, [open, summary, loading, failed]);

  const selected = useMemo(() => {
    const rows = (summary?.categories ?? []).filter((entry) => chosen.includes(entry.category));
    return {
      leads: rows.reduce((sum, entry) => sum + entry.leads, 0),
      aiCalls: rows.reduce((sum, entry) => sum + entry.aiCalls, 0),
      all: rows.length === (summary?.categories.length ?? 0),
    };
  }, [summary, chosen]);

  function toggle(category: string): void {
    setChosen((current) =>
      current.includes(category) ? current.filter((value) => value !== category) : [...current, category],
    );
  }

  async function rewrite(): Promise<void> {
    if (selected.leads === 0) return;
    setStarting(true);
    try {
      // An empty list means every category, which is not the same as "none".
      // Sending the full selection explicitly would also work, but this keeps
      // the job's record of what it was asked to do honest about the intent.
      const { job } = await api.startRewritePitchesJob(selected.all ? undefined : chosen);
      onStarted(job);
      toast.success(
        `Rewriting ${selected.leads.toLocaleString()} message${selected.leads === 1 ? "" : "s"} in the background.`,
      );
      setOpen(false);
      setSummary(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The rewrite could not start");
    } finally {
      setStarting(false);
    }
  }

  return (
    <section className="panel accent-purple mt-6 border-t-4" role="status">
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 shrink-0 text-purple-600 dark:text-purple-400">
            <RiSparkling2Line className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="section-title !mb-0">
              {pending.toLocaleString()} message{pending === 1 ? "" : "s"} still use the built-in template
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              These were written before the AI writer was available, so they read the same for every business in a
              category. Rewriting them costs one AI call per situation, not one per lead.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            // Reopening is the retry: a refusal was probably the API restarting.
            setFailed(false);
            setOpen((value) => !value);
          }}
          className="btn-ghost shrink-0"
        >
          {open ? <RiCloseLine className="h-4 w-4" /> : <RiSparkling2Line className="h-4 w-4" />}
          {open ? "Close" : "Choose categories"}
        </button>
      </div>

      {open && (
        <div className="mt-5 border-t border-slate-200 pt-5 dark:border-slate-700">
          {loading && <p className="text-sm text-slate-500 dark:text-slate-400">Reading the queue…</p>}

          {!loading && failed && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Could not read the queue. Close this and open it again to retry.
            </p>
          )}

          {!loading && summary && summary.categories.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Nothing is on the built-in template any more.
            </p>
          )}

          {!loading && summary && summary.categories.length > 0 && (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Category · messages · AI calls
                </p>
                <button
                  type="button"
                  onClick={() =>
                    setChosen(chosen.length === summary.categories.length ? [] : summary.categories.map((e) => e.category))
                  }
                  className="text-xs font-semibold text-purple-600 hover:underline dark:text-purple-400"
                >
                  {chosen.length === summary.categories.length ? "Clear all" : "Select all"}
                </button>
              </div>

              <ul className="max-h-80 space-y-1 overflow-y-auto pr-1">
                {summary.categories.map((entry) => {
                  const picked = chosen.includes(entry.category);
                  return (
                    <li key={entry.category}>
                      <label
                        className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition ${
                          picked
                            ? "border-purple-300 bg-purple-50 dark:border-purple-700 dark:bg-purple-950/40"
                            : "border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/60"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={picked}
                          onChange={() => toggle(entry.category)}
                          className="h-4 w-4 shrink-0 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                        />
                        <span className="min-w-0 flex-1 truncate font-medium text-slate-700 dark:text-slate-200">
                          {entry.category}
                        </span>
                        <span className="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">
                          {entry.leads.toLocaleString()}
                        </span>
                        <span
                          className="shrink-0 tabular-nums text-xs font-semibold text-purple-600 dark:text-purple-400"
                          title={
                            entry.individual > 0
                              ? `${entry.situations} shared message${entry.situations === 1 ? "" : "s"} plus ${entry.individual} written individually, because those leads carry their own Instagram detail`
                              : `${entry.situations} shared message${entry.situations === 1 ? "" : "s"}`
                          }
                        >
                          {entry.aiCalls.toLocaleString()} call{entry.aiCalls === 1 ? "" : "s"}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-5 flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-700">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {selected.leads === 0 ? (
                    "Nothing selected."
                  ) : (
                    <>
                      <span className="font-semibold text-slate-700 dark:text-slate-200">
                        {selected.leads.toLocaleString()} message{selected.leads === 1 ? "" : "s"}
                      </span>{" "}
                      for about{" "}
                      <span className="font-semibold text-purple-600 dark:text-purple-400">
                        {selected.aiCalls.toLocaleString()} AI call{selected.aiCalls === 1 ? "" : "s"}
                      </span>
                      .
                    </>
                  )}
                </p>
                <button
                  type="button"
                  onClick={rewrite}
                  disabled={busy || starting || selected.leads === 0}
                  className="btn-primary shrink-0"
                >
                  {starting ? (
                    <span className="loader-spinner h-4 w-4 border-2 border-white/40 border-t-white" />
                  ) : (
                    <RiSparkling2Line className="h-4 w-4" />
                  )}
                  Rewrite with AI
                </button>
              </div>

              <p className="mt-3 text-xs leading-relaxed text-slate-400">
                Only messages that have not been sent or approved are touched, so nothing already on its way to a
                business changes. The call estimate moves by a lead or two if contact details changed since the last
                scan.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * What a run that went wrong left behind.
 *
 * Two things were wrong with the old version. It wore the call-to-action
 * colour, which is the colour of the button you are meant to press, not of
 * something that failed. And it could not be put down: the notice stayed until
 * some later run happened to replace it, so a single bad scan sat on the
 * overview indefinitely.
 *
 * The figures are the point, so they lead. Partial and failed are told apart by
 * their own status colours rather than by reading the heading.
 */
function ScanReport({
  job,
  onDismiss,
  dismissing,
}: {
  job: PipelineJob;
  onDismiss: () => void;
  dismissing: boolean;
}) {
  const failed = job.status === "FAILED";
  const tone = failed
    ? { accent: "accent-rose", ink: "text-rose-600 dark:text-rose-400", fill: "bg-rose-600" }
    : { accent: "accent-cta", ink: "text-amber-600 dark:text-amber-400", fill: "bg-amber-500" };

  const kept = job.progress.created > 0 || job.progress.qualified > 0;
  const alreadyKnown = Math.max(0, job.progress.found - job.progress.created);

  /*
   * The specific reasons, in the operator's terms.
   *
   * "Completed with recoverable errors" is not a thing anyone can act on. Each
   * line below names what happened and what it means for the work, because
   * these have genuinely different answers: failed searches are resumable,
   * failed leads retry on the next run, and a templated pitch is already sitting
   * in the queue ready to send.
   */
  const reasons: string[] = [];
  if (job.progress.failedQueries > 0) {
    reasons.push(
      `${job.progress.failedQueries.toLocaleString()} ${job.progress.failedQueries === 1 ? "search" : "searches"} did not complete. Resume picks up exactly those, and skips the ones that worked.`,
    );
  }
  if (job.progress.processingErrors > 0) {
    reasons.push(
      `${job.progress.processingErrors.toLocaleString()} ${job.progress.processingErrors === 1 ? "business" : "businesses"} could not be checked and scored. They stay in the queue and are retried on the next run.`,
    );
  }
  if (job.progress.aiFallbacks > 0) {
    reasons.push(
      `${job.progress.aiFallbacks.toLocaleString()} ${job.progress.aiFallbacks === 1 ? "message was" : "messages were"} written from the built-in template because the AI writer was unavailable. Those leads are ready to send; regenerate any of them from the queue.`,
    );
  }

  return (
    <section className={`panel ${tone.accent} mt-6 border-t-4`} role="status">
      <div className="flex min-w-0 items-start gap-3">
        <span className={`mt-0.5 shrink-0 ${tone.ink}`}>
          <RiErrorWarningLine className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="section-title !mb-0">
              {failed ? "The last scan did not finish" : "The last scan finished with problems"}
            </h2>
            <span className={`text-[10px] font-extrabold uppercase tracking-wider ${tone.ink}`}>
              {failed ? "Failed" : "Partial"}
            </span>
          </div>
          <p className="mt-1 break-words text-sm text-slate-500 dark:text-slate-400">
            {job.error ?? job.progress.message}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          disabled={dismissing}
          className="btn-ghost shrink-0 !px-3"
          aria-label="Dismiss this report"
        >
          {dismissing ? <span className="loader-spinner h-4 w-4 border-2 border-slate-300 border-t-slate-600" /> : <RiCloseLine className="h-4 w-4" />}
          Dismiss
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <ProgressValue label="Found" value={job.progress.found} />
        <ProgressValue label="New" value={job.progress.created} />
        <ProgressValue label="Processed" value={job.progress.processed} />
        <ProgressValue label="Qualified" value={job.progress.qualified} />
      </div>

      {/*
        Found minus new is not a loss, and saying nothing about it made the
        figures look wrong: 735 found against 356 new reads like a fault until
        it says the rest were businesses already on file.
      */}
      {alreadyKnown > 0 && (
        <p className="mt-2 text-xs text-slate-400">
          {alreadyKnown.toLocaleString()} of the {job.progress.found.toLocaleString()} found{" "}
          {alreadyKnown === 1 ? "was" : "were"} already on file
          {job.progress.suppressed > 0 && ` or on the do-not-contact list`}, so only the new ones were added.
        </p>
      )}

      {/* What actually went wrong, itemised, instead of "recoverable errors". */}
      {reasons.length > 0 && (
        <ul className="mt-4 space-y-1.5 text-xs text-slate-500 dark:text-slate-400">
          {reasons.map((reason) => (
            <li key={reason} className="flex gap-2">
              <span aria-hidden className={tone.ink}>
                •
              </span>
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        {kept
          ? "Everything found before the problem was kept. Use the actions above to retry the searches that failed, or to finish processing the leads already found."
          : "No leads were lost, because none had been saved when it stopped. Run the scan again when you are ready."}
      </p>
    </section>
  );
}

/**
 * How long ago something happened, in words, refreshed every second.
 *
 * The point is the "ago", not the timestamp: a run whose counters last moved
 * four minutes ago is the thing worth noticing, and a fixed clock time makes
 * the reader do that subtraction themselves.
 */
function useSecondsSince(iso?: string): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (!iso) return null;
  return Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
}

function PipelineProgress({
  job,
  onStop,
  stopping,
}: {
  job: PipelineJob;
  onStop: () => void;
  stopping: boolean;
}) {
  /*
   * The server's own figure, which is one number across the whole job and never
   * goes backwards. Computing it here from current/total meant the bar reset to
   * zero the moment the phase changed, because those two count queries during
   * discovery and leads during processing. The fallback is for a job started by
   * an older build, which has no percent on it.
   */
  const percent =
    typeof job.progress.percent === "number"
      ? Math.min(100, Math.max(0, job.progress.percent))
      : Math.min(100, Math.round((job.progress.current / Math.max(job.progress.total, 1)) * 100));
  const phase =
    job.phase === "DISCOVERY"
      ? "Discovering businesses"
      : job.phase === "PROCESSING"
        ? "Auditing and scoring leads"
        : job.phase === "PITCHING"
          ? "Rewriting messages with AI"
          : "Preparing pipeline";

  /*
   * Say when the counters last moved.
   *
   * A spinner means "something is happening" whether or not anything is, which
   * is how a wedged run held this page for most of a day looking busy. The
   * elapsed time is the honest version, and after a couple of minutes of
   * nothing it says so outright rather than leaving it to be inferred.
   */
  const idle = useSecondsSince(job.progressAt);
  const stalling = idle !== null && idle >= 120;

  return (
    <section className="panel accent-purple mt-6 overflow-hidden border-t-4" aria-live="polite">
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="loader-spinner h-4 w-4 shrink-0 border-2 border-purple-200 border-t-purple-600" />
            <p className="font-heading text-sm font-extrabold text-slate-800 dark:text-white">{phase}</p>
          </div>
          <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">{job.progress.message}</p>
          {idle !== null && (
            <p className={`mt-1 text-xs ${stalling ? "font-semibold text-amber-600 dark:text-amber-400" : "text-slate-400"}`}>
              {stalling
                ? `No progress for ${formatDuration(idle)}. It may be stuck; you can stop it and keep what it found.`
                : `Last moved ${formatDuration(idle)} ago`}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <p className="font-heading text-2xl font-extrabold tabular-nums text-purple-600">{percent}%</p>
          <button type="button" onClick={onStop} disabled={stopping} className="btn-ghost" aria-label="Stop this scan">
            {stopping ? (
              <span className="loader-spinner h-4 w-4 border-2 border-slate-300 border-t-slate-600" />
            ) : (
              <RiStopCircleLine className="h-4 w-4" />
            )}
            Stop
          </button>
        </div>
      </div>
      <div className="mt-4 h-3 overflow-hidden border border-purple-200 bg-purple-50 dark:border-purple-900 dark:bg-purple-950/30">
        <div className="h-full bg-purple-600 transition-[width] duration-500" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <ProgressValue label="Found" value={job.progress.found} />
        <ProgressValue label="Created" value={job.progress.created} />
        <ProgressValue label="Processed" value={job.progress.processed} />
        <ProgressValue label="Qualified" value={job.progress.qualified} />
      </div>
      {(job.progress.failedQueries > 0 || job.progress.processingErrors > 0 || job.progress.aiFallbacks > 0) && (
        <p className="mt-3 text-xs font-semibold text-amber-700 dark:text-amber-400">
          {job.progress.failedQueries > 0
            ? `${job.progress.failedQueries} search${job.progress.failedQueries === 1 ? "" : "es"} will remain resumable.`
            : ""}
          {job.progress.failedQueries > 0 && job.progress.processingErrors > 0 ? " " : ""}
          {job.progress.processingErrors > 0
            ? `${job.progress.processingErrors} lead${job.progress.processingErrors === 1 ? "" : "s"} can be processed again.`
            : ""}
          {(job.progress.failedQueries > 0 || job.progress.processingErrors > 0) && job.progress.aiFallbacks > 0
            ? " "
            : ""}
          {job.progress.aiFallbacks > 0
            ? `${job.progress.aiFallbacks} AI pitch${job.progress.aiFallbacks === 1 ? "" : "es"} used the safe template fallback.`
            : ""}
        </p>
      )}
    </section>
  );
}

/** Elapsed seconds as something readable, without a formatting library. */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function ProgressValue({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 border border-slate-200 p-3 dark:border-slate-800">
      <p className="truncate text-slate-400">{label}</p>
      <p className="mt-1 font-heading text-lg font-extrabold tabular-nums">{value.toLocaleString()}</p>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  prefix,
  context,
  href,
  accent,
  iconClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  prefix?: string;
  context: string;
  href?: string;
  accent: string;
  iconClass: string;
}) {
  const content = (
    <div className={`metric-card ${accent} h-full ${href ? "hover:bg-slate-50 dark:hover:bg-slate-800/60" : ""}`}>
      <span className={`metric-icon ${iconClass}`}>{icon}</span>
      <p className="metric-value">
        <Counter value={value} prefix={prefix} />
      </p>
      <p className="metric-label">{label}</p>
      <p className="metric-context">{context}</p>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

function RunBars({ runs }: { runs: Stats["recentRuns"] }) {
  // Defensive, like everywhere else that reads a payload: a missing array here
  // used to throw on the spread and take the overview down with it.
  const data = (Array.isArray(runs) ? [...runs] : []).slice(0, 8).reverse();

  /*
   * Nothing to plot is not the same as still loading.
   *
   * This returned a skeleton block, which is the grey placeholder the rest of
   * the app uses to mean "the data is on its way". With no runs yet it never
   * resolved, so the panel showed a large empty grey rectangle for good and
   * read as broken rather than as empty.
   */
  if (data.length === 0) {
    return (
      <div className="flex h-28 items-center justify-center border border-dashed border-slate-300 px-4 text-center dark:border-slate-700">
        <p className="text-xs leading-relaxed text-slate-400">
          Run a scan and the leads it creates will be charted here.
        </p>
      </div>
    );
  }

  const created = (run: Stats["recentRuns"][number]) => run.totals?.created ?? 0;
  const max = Math.max(...data.map(created), 1);

  return (
    /*
     * The columns stretch, and each one is full height.
     *
     * They were laid out with `items-end`, which sizes a flex child to its
     * content rather than to the row. The bars are sized as a percentage, and a
     * percentage of an automatic height resolves to nothing, so every bar
     * collapsed and the chart drew only its axes. It was invisible with data,
     * not merely empty without it.
     */
    <div
      className="flex h-28 items-stretch gap-2 border-b border-l border-slate-300 px-2 pt-2 dark:border-slate-700"
      aria-label="Leads created by each of the most recent discovery runs"
    >
      {data.map((run) => (
        <div key={run._id} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
          {/*
            Always shown, not only on hover. A number that requires a pointer is
            a number nobody on a phone can read, and this is the whole content
            of the chart.
          */}
          <span className="mb-1 text-[10px] font-bold tabular-nums text-slate-500 dark:text-slate-400">
            {created(run)}
          </span>
          <span
            className="w-full bg-purple-600"
            style={{ height: `${Math.max((created(run) / max) * 100, created(run) > 0 ? 6 : 2)}%` }}
            title={`${created(run)} new leads`}
          />
        </div>
      ))}
    </div>
  );
}

function IntegrationRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-3 p-3 text-sm">
      {ok ? (
        <RiCheckboxCircleFill className="h-5 w-5 shrink-0 text-emerald-500" />
      ) : (
        <RiCloseCircleFill className="h-5 w-5 shrink-0 text-rose-500" />
      )}
      <span className={`min-w-0 flex-1 ${ok ? "font-semibold" : "text-slate-500"}`}>{label}</span>
      <span className={`text-[10px] font-extrabold uppercase tracking-wider ${ok ? "text-emerald-600" : "text-rose-500"}`}>
        {ok ? "Ready" : "Action"}
      </span>
    </div>
  );
}

function ActivityItem({ activity }: { activity: OutreachLogEntry }) {
  const lead = typeof activity.leadId === "object" ? activity.leadId : null;
  const content = (
    <div className="timeline-item">
      <p className="text-sm font-bold capitalize">{activity.action.replaceAll("_", " ").toLowerCase()}</p>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        {lead?.businessName ?? "Lead activity"} · {activity.channel}
      </p>
      <p className="mt-1 text-[11px] text-slate-400">{new Date(activity.createdAt).toLocaleString("en-NG")}</p>
    </div>
  );
  return lead?._id ? <Link href={`/leads/${lead._id}`}>{content}</Link> : content;
}

function OverviewSkeleton() {
  return (
    <div className="page-shell">
      <div className="skeleton-block h-28" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[...Array(4)].map((_, index) => (
          <div key={index} className="skeleton-block h-40" />
        ))}
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <div className="skeleton-block h-96" />
        <div className="skeleton-block h-96" />
      </div>
    </div>
  );
}
