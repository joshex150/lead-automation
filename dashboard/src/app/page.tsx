"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { motion } from "framer-motion";
import {
  RiInboxArchiveLine,
  RiMailSendLine,
  RiEmotionHappyLine,
  RiTrophyLine,
  RiPlayCircleLine,
  RiRadarLine,
  RiCheckboxCircleFill,
  RiCloseCircleFill,
} from "react-icons/ri";
import { api } from "@/lib/api";
import { useCountUp, useTilt, useVisiblePolling } from "@/lib/motion";
import type { Stats } from "@/lib/types";

export default function OverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    api
      .stats()
      .then((s) => {
        if (cancelled) return;
        setStats(s);
        setError(null);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const cancel = load();
    return cancel;
  }, [load]);
  useVisiblePolling(load, 30000);

  async function runPipeline() {
    setRunning(true);
    const id = toast.loading("Running the discovery pipeline. This can take a few minutes.");
    try {
      const r = await api.runFull();
      toast.success(`Done. Found ${r.found}, created ${r.created}, qualified ${r.qualified}.`, { id, duration: 8000 });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Pipeline failed", { id });
    } finally {
      setRunning(false);
    }
  }

  if (error) {
    return (
      <div className="glass-card mx-auto mt-24 max-w-lg p-10 text-center">
        <h2 className="font-heading text-xl font-bold">Can&apos;t reach the API</h2>
        <p className="mt-2 text-sm text-slate-500">{error}</p>
        <p className="mt-4 text-xs text-slate-400">
          Check NEXT_PUBLIC_API_URL / NEXT_PUBLIC_API_KEY and that the server is running.
        </p>
      </div>
    );
  }

  if (!stats) return <PageSkeleton />;

  const funnel: Array<[string, number]> = [
    ["Discovered", stats.byStage.DISCOVERED ?? 0],
    ["Pending approval", stats.totals.pendingApproval],
    ["Contacted", stats.totals.contacted],
    ["Interested", stats.totals.interested],
    ["Converted", stats.totals.converted],
  ];

  const emailLabel =
    stats.integrations.emailProvider && stats.integrations.emailProvider !== "none"
      ? `Email sending (${stats.integrations.emailProvider})`
      : "Email sending";
  const aiLabel =
    stats.integrations.aiProvider && stats.integrations.aiProvider !== "none"
      ? `AI pitch writer (${stats.integrations.aiProvider})`
      : "AI pitch writer";

  return (
    <div className="mx-auto max-w-6xl">
      <motion.header
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-wrap items-end justify-between gap-4"
      >
        <div>
          <h1 className="font-heading text-3xl font-extrabold tracking-tight sm:text-4xl">
            Lead engine{" "}
            <span className="bg-gradient-to-r from-brand-600 to-purple-600 bg-clip-text text-transparent">
              overview
            </span>
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {stats.totals.total} businesses tracked · {stats.totals.optedOut} suppressed
          </p>
        </div>
        <button onClick={runPipeline} disabled={running || !stats.integrations.googlePlaces} className="btn-cta">
          <RiPlayCircleLine className="h-5 w-5" />
          {running ? "Running…" : "Run discovery now"}
        </button>
      </motion.header>

      {/* Stat cards */}
      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={<RiInboxArchiveLine />}
          label="Awaiting approval"
          value={stats.totals.pendingApproval}
          href="/queue"
          accent="from-brand-600 to-brand-500"
          delay={0}
        />
        <StatCard
          icon={<RiMailSendLine />}
          label="Contacted"
          value={stats.totals.contacted}
          href="/leads?outreachStatus=CONTACTED"
          accent="from-purple-600 to-fuchsia-500"
          delay={0.05}
        />
        <StatCard
          icon={<RiEmotionHappyLine />}
          label="Interested"
          value={stats.totals.interested}
          href="/leads?outreachStatus=INTERESTED"
          accent="from-emerald-600 to-teal-500"
          delay={0.1}
        />
        <StatCard
          icon={<RiTrophyLine />}
          label="Revenue won"
          value={stats.revenue.totalDealValue}
          prefix="₦"
          sub={`${stats.revenue.convertedDeals} deal${stats.revenue.convertedDeals === 1 ? "" : "s"}`}
          accent="from-cta-500 to-amber-500"
          delay={0.15}
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-5">
        {/* Funnel */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-card min-h-[26rem] p-6 lg:col-span-3"
        >
          <h2 className="font-heading text-lg font-bold">Pipeline funnel</h2>
          <div className="mt-5 space-y-3">
            {funnel.map(([label, value], i) => {
              const max = Math.max(...funnel.map(([, v]) => v), 1);
              return (
                <div key={label}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600 dark:text-slate-300">{label}</span>
                    <span className="font-heading font-bold tabular-nums">{value}</span>
                  </div>
                  <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-800">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(value / max) * 100}%` }}
                      transition={{ delay: 0.2 + i * 0.08, duration: 0.6, ease: "easeOut" }}
                      className="h-full rounded-full bg-gradient-to-r from-brand-600 via-purple-500 to-cta-500"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <h3 className="mt-7 font-heading text-sm font-bold uppercase tracking-wider text-slate-400">
            By website type
          </h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(stats.byWebsiteType)
              .sort(([, a], [, b]) => b - a)
              .map(([type, count]) => (
                <Link
                  key={type}
                  href={`/leads?websiteType=${type}`}
                  className="rounded-full border border-slate-200 bg-white/60 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-brand-500 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300"
                >
                  {type.replaceAll("_", " ").toLowerCase()} · <b>{count}</b>
                </Link>
              ))}
          </div>
        </motion.section>

        {/* Right column: integrations + runs */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18 }}
          className="space-y-6 lg:col-span-2"
        >
          <div className="glass-card p-6">
            <h2 className="font-heading text-lg font-bold">Integrations</h2>
            <ul className="mt-4 space-y-2.5 text-sm">
              <IntegrationRow ok={stats.integrations.googlePlaces} label="Google Places API" />
              <IntegrationRow ok={stats.integrations.ai} label={aiLabel} />
              <IntegrationRow ok={stats.integrations.email} label={emailLabel} />
              <IntegrationRow ok={stats.integrations.authEnabled} label="API authentication" />
            </ul>
            <Link
              href="/settings"
              className="mt-4 inline-block text-xs font-semibold text-brand-600 hover:underline dark:text-brand-500"
            >
              Configure providers in settings
            </Link>
          </div>

          <div className="glass-card p-6">
            <h2 className="flex items-center gap-2 font-heading text-lg font-bold">
              <RiRadarLine className="text-brand-600" /> Recent runs
            </h2>
            <ul className="mt-4 space-y-3 text-sm">
              {stats.recentRuns.length === 0 && <li className="text-slate-400">No discovery runs yet.</li>}
              {stats.recentRuns.map((r) => (
                <li key={r._id} className="flex items-center justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400">
                    {new Date(r.startedAt).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                  <span className="font-medium tabular-nums">
                    {r.status === "COMPLETED" ? (
                      <>
                        +{r.totals.created} new · {r.totals.qualified} qualified
                      </>
                    ) : (
                      r.status
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </motion.section>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  prefix = "",
  sub,
  href,
  accent,
  delay,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  prefix?: string;
  sub?: string;
  href?: string;
  accent: string;
  delay: number;
}) {
  const tiltRef = useTilt<HTMLDivElement>(6);
  const countRef = useCountUp(value, (n) => `${prefix}${Math.round(n).toLocaleString()}`);

  const card = (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay }}
      className="h-full"
    >
      <div ref={tiltRef} className="glass-card group flex h-full min-h-[9rem] flex-col p-5">
        <span
          className={`inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br text-lg text-white shadow-lg ${accent}`}
        >
          {icon}
        </span>
        <p className="mt-4 font-heading text-2xl font-extrabold tracking-tight tabular-nums sm:text-3xl">
          <span ref={countRef}>{prefix}0</span>
        </p>
        <p className="mt-0.5 text-xs font-medium uppercase tracking-wider text-slate-400">{label}</p>
        {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
      </div>
    </motion.div>
  );
  return href ? <Link href={href}>{card}</Link> : card;
}

function IntegrationRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2.5">
      {ok ? (
        <RiCheckboxCircleFill className="h-5 w-5 shrink-0 text-emerald-500" />
      ) : (
        <RiCloseCircleFill className="h-5 w-5 shrink-0 text-slate-300 dark:text-slate-600" />
      )}
      <span className={ok ? "" : "text-slate-400"}>{label}</span>
      {!ok && <span className="ml-auto text-xs text-slate-400">not configured</span>}
    </li>
  );
}

function PageSkeleton() {
  return (
    <div className="mx-auto max-w-6xl animate-pulse">
      <div className="h-10 w-72 max-w-full rounded-xl bg-slate-200 dark:bg-slate-800" />
      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="min-h-[9rem] rounded-2xl bg-slate-200 dark:bg-slate-800" />
        ))}
      </div>
      <div className="mt-8 min-h-[26rem] rounded-2xl bg-slate-200 dark:bg-slate-800" />
    </div>
  );
}
