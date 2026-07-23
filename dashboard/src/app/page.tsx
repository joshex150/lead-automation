"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  RiErrorWarningLine,
  RiArrowRightLine,
  RiTimeLine,
} from "react-icons/ri";
import { api } from "@/lib/api";
import { useVisiblePolling } from "@/lib/motion";
import type { OutreachLogEntry, Stats } from "@/lib/types";

export default function OverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

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

  useEffect(() => load(), [load]);
  useVisiblePolling(load, 30000);

  async function runPipeline() {
    setRunning(true);
    const id = toast.loading("Running discovery and lead processing…");
    try {
      const result = await api.runFull();
      toast.success(`Found ${result.found}, created ${result.created}, qualified ${result.qualified}.`, {
        id,
        duration: 8000,
      });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Pipeline failed", { id });
    } finally {
      setRunning(false);
    }
  }

  const insights = useMemo(() => {
    if (!stats) return null;
    const total = Math.max(stats.totals.total, 1);
    const contacted = Math.max(stats.totals.contacted, 1);
    const interested = Math.max(stats.totals.interested, 1);
    return {
      approvalShare: Math.round((stats.totals.pendingApproval / total) * 100),
      interestRate: Math.round((stats.totals.interested / contacted) * 100),
      closeRate: Math.round((stats.totals.converted / interested) * 100),
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
            Check NEXT_PUBLIC_API_URL, NEXT_PUBLIC_API_KEY, and confirm that the server is running.
          </p>
        </div>
      </div>
    );
  }

  if (!stats || !insights) return <OverviewSkeleton />;

  const funnel: Array<[string, number, string]> = [
    ["Discovered", stats.byStage.DISCOVERED ?? stats.totals.total, "/leads?stage=DISCOVERED"],
    ["Pending approval", stats.totals.pendingApproval, "/queue"],
    ["Contacted", stats.totals.contacted, "/leads?outreachStatus=CONTACTED"],
    ["Interested", stats.totals.interested, "/leads?outreachStatus=INTERESTED"],
    ["Converted", stats.totals.converted, "/leads?outreachStatus=CONVERTED"],
  ];
  const funnelMax = Math.max(...funnel.map(([, value]) => value), 1);

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
  ].filter(Boolean) as Array<{ title: string; detail: string; href: string; tone: string }>;

  const websiteMix = Object.entries(stats.byWebsiteType)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6);

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
          <Link href="/leads" className="btn-ghost">
            View all leads <RiArrowRightLine className="h-4 w-4" />
          </Link>
          <button onClick={runPipeline} disabled={running || !stats.integrations.googlePlaces} className="btn-cta">
            {running ? <span className="loader-spinner h-4 w-4 border-2 border-white/40 border-t-white" /> : <RiPlayCircleLine className="h-5 w-5" />}
            {running ? "Running…" : "Run discovery"}
          </button>
        </div>
      </header>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<RiInboxArchiveLine />}
          label="Awaiting approval"
          value={stats.totals.pendingApproval.toLocaleString()}
          context={`${insights.approvalShare}% of all tracked leads`}
          href="/queue"
          accent="accent-brand"
          iconClass="text-brand-600"
        />
        <MetricCard
          icon={<RiMailSendLine />}
          label="Contacted"
          value={stats.totals.contacted.toLocaleString()}
          context={`${insights.interestRate}% became interested`}
          href="/leads?outreachStatus=CONTACTED"
          accent="accent-purple"
          iconClass="text-purple-600"
        />
        <MetricCard
          icon={<RiEmotionHappyLine />}
          label="Interested"
          value={stats.totals.interested.toLocaleString()}
          context={`${insights.closeRate}% converted to wins`}
          href="/leads?outreachStatus=INTERESTED"
          accent="accent-emerald"
          iconClass="text-emerald-600"
        />
        <MetricCard
          icon={<RiTrophyLine />}
          label="Revenue won"
          value={`₦${stats.revenue.totalDealValue.toLocaleString()}`}
          context={
            stats.revenue.convertedDeals > 0
              ? `₦${insights.averageDeal.toLocaleString()} average deal`
              : "No converted deals recorded yet"
          }
          accent="accent-cta"
          iconClass="text-cta-500"
        />
      </section>

      <section className="mt-6 grid items-start gap-6 xl:grid-cols-12">
        <div className="panel accent-brand border-t-4 xl:col-span-7">
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
                    <div className="h-full bg-brand-600" style={{ width: `${Math.max((value / funnelMax) * 100, value > 0 ? 2 : 0)}%` }} />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="panel accent-cta border-t-4 xl:col-span-5">
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
                  <span className={`mt-1 h-2 w-2 shrink-0 bg-${item.tone}-600`} />
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
      </section>

      <section className="mt-6 grid items-start gap-6 xl:grid-cols-12">
        <div className="panel accent-purple border-t-4 xl:col-span-4">
          <div className="section-heading">
            <div>
              <h2 className="section-title">Discovery pulse</h2>
              <p className="section-description">New leads created in the most recent runs.</p>
            </div>
            <RiRadarLine className="h-5 w-5 text-purple-600" />
          </div>
          <RunBars runs={stats.recentRuns} />
          <div className="mt-5 divide-y divide-slate-200 border-t border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {stats.recentRuns.slice(0, 4).map((run) => (
              <div key={run._id} className="flex items-center justify-between gap-3 py-3 text-xs">
                <span className="text-slate-500 dark:text-slate-400">
                  {new Date(run.startedAt).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}
                </span>
                <span className="font-bold tabular-nums">+{run.totals.created} new</span>
              </div>
            ))}
            {stats.recentRuns.length === 0 && <p className="py-6 text-center text-sm text-slate-400">No discovery runs yet.</p>}
          </div>
        </div>

        <div className="panel accent-slate border-t-4 xl:col-span-4">
          <div className="section-heading">
            <div>
              <h2 className="section-title">Website opportunity mix</h2>
              <p className="section-description">The strongest website sales angles in the database.</p>
            </div>
          </div>
          <div className="space-y-3">
            {websiteMix.map(([type, count]) => (
              <Link key={type} href={`/leads?websiteType=${type}`} className="flex items-center gap-3 border-b border-slate-200 pb-3 text-sm last:border-0 last:pb-0 dark:border-slate-800">
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

        <div className="panel accent-emerald border-t-4 xl:col-span-4">
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
      </section>

      <section className="panel accent-brand mt-6 border-t-4">
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
      </section>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  context,
  href,
  accent,
  iconClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  context: string;
  href?: string;
  accent: string;
  iconClass: string;
}) {
  const content = (
    <div className={`metric-card ${accent} h-full ${href ? "hover:bg-slate-50 dark:hover:bg-slate-800/60" : ""}`}>
      <span className={`metric-icon ${iconClass}`}>{icon}</span>
      <p className="metric-value">{value}</p>
      <p className="metric-label">{label}</p>
      <p className="metric-context">{context}</p>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

function RunBars({ runs }: { runs: Stats["recentRuns"] }) {
  const data = [...runs].slice(0, 8).reverse();
  const max = Math.max(...data.map((run) => run.totals.created), 1);
  if (data.length === 0) return <div className="skeleton-block h-28" />;
  return (
    <div className="flex h-28 items-end gap-2 border-b border-l border-slate-300 px-2 pt-2 dark:border-slate-700" aria-label="Recent discovery run lead creation chart">
      {data.map((run) => (
        <div key={run._id} className="group flex min-w-0 flex-1 flex-col items-center justify-end">
          <span className="mb-1 text-[10px] font-bold tabular-nums opacity-0 group-hover:opacity-100">{run.totals.created}</span>
          <span className="w-full bg-purple-600" style={{ height: `${Math.max((run.totals.created / max) * 100, run.totals.created > 0 ? 6 : 2)}%` }} />
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
