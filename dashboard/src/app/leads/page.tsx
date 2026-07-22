"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { RiSearchLine, RiArrowLeftSLine, RiArrowRightSLine } from "react-icons/ri";
import { api } from "@/lib/api";
import type { Lead } from "@/lib/types";
import { ScoreBadge, StagePill, WebsiteTypeBadge } from "@/components/badges";

const WEBSITE_TYPES = [
  "NO_WEBSITE",
  "BROKEN_WEBSITE",
  "SHOPIFY",
  "LINK_IN_BIO_ONLY",
  "MENU_PLATFORM_ONLY",
  "SOCIAL_MEDIA_ONLY",
  "CUSTOM_WEBSITE",
  "POOR_WEBSITE",
];

const STAGES = [
  "DISCOVERED",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "CONTACTED",
  "QUALIFIED",
  "DISQUALIFIED",
  "ARCHIVED",
];

function LeadsPageInner() {
  const params = useSearchParams();
  const [data, setData] = useState<{ items: Lead[]; total: number; pages: number } | null>(null);
  const [search, setSearch] = useState("");
  const [websiteType, setWebsiteType] = useState(params.get("websiteType") ?? "");
  const [stage, setStage] = useState(params.get("stage") ?? "");
  const [outreachStatus] = useState(params.get("outreachStatus") ?? "");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    api
      .leads({
        search: search || undefined,
        websiteType: websiteType || undefined,
        stage: stage || undefined,
        outreachStatus: outreachStatus || undefined,
        page,
        limit: 25,
        sort: "-score",
      })
      .then((r) => {
        if (cancelled) return; // a newer filter/page request superseded this one
        setData(r);
        setError(null);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [search, websiteType, stage, outreachStatus, page]);

  useEffect(() => {
    let cancel: (() => void) | undefined;
    const t = setTimeout(() => {
      cancel = load();
    }, search ? 350 : 0);
    return () => {
      clearTimeout(t);
      cancel?.();
    };
  }, [load, search]);

  return (
    <div className="mx-auto max-w-6xl">
      <motion.header initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="font-heading text-3xl font-extrabold tracking-tight sm:text-4xl">
          All <span className="bg-gradient-to-r from-brand-600 to-purple-600 bg-clip-text text-transparent">leads</span>
        </h1>
        {data && (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{data.total} leads match your filters</p>
        )}
      </motion.header>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <RiSearchLine className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input !pl-10"
            placeholder="Search name, email, Instagram…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <select
          className="input !w-auto"
          value={websiteType}
          onChange={(e) => {
            setWebsiteType(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All website types</option>
          {WEBSITE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replaceAll("_", " ").toLowerCase()}
            </option>
          ))}
        </select>
        <select
          className="input !w-auto"
          value={stage}
          onChange={(e) => {
            setStage(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All stages</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {s.replaceAll("_", " ").toLowerCase()}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="mt-8 rounded-xl bg-rose-500/10 p-4 text-sm text-rose-500">{error}</p>}

      {/* Table */}
      <div className="glass-card mt-6 overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-slate-200/60 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-slate-800/60">
              <th className="px-5 py-3.5">Score</th>
              <th className="px-5 py-3.5">Business</th>
              <th className="px-5 py-3.5">Website</th>
              <th className="px-5 py-3.5">Contact</th>
              <th className="px-5 py-3.5">Stage</th>
            </tr>
          </thead>
          <tbody>
            {!data &&
              [...Array(8)].map((_, i) => (
                <tr key={i} className="border-b border-slate-100 dark:border-slate-800/40">
                  <td colSpan={5} className="px-5 py-4">
                    <div className="h-6 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
                  </td>
                </tr>
              ))}
            {data?.items.map((lead) => (
              <tr
                key={lead._id}
                className="group border-b border-slate-100 transition hover:bg-brand-500/5 dark:border-slate-800/40"
              >
                <td className="px-5 py-3.5">
                  <ScoreBadge score={lead.leadScore} />
                </td>
                <td className="px-5 py-3.5">
                  <Link href={`/leads/${lead._id}`} className="font-semibold text-slate-800 group-hover:text-brand-600 dark:text-slate-100">
                    {lead.businessName}
                  </Link>
                  <p className="text-xs capitalize text-slate-400">
                    {lead.category} · {lead.city}
                    {lead.openingSoon && <span className="ml-1 font-semibold text-cta-500">new</span>}
                  </p>
                </td>
                <td className="px-5 py-3.5">
                  <WebsiteTypeBadge type={lead.websiteType} />
                </td>
                <td className="px-5 py-3.5 text-xs text-slate-500 dark:text-slate-400">
                  {lead.email && <p>{lead.email}</p>}
                  {lead.instagramUsername && <p>@{lead.instagramUsername}</p>}
                  {!lead.email && !lead.instagramUsername && lead.phoneNormalized && <p>{lead.phoneNormalized}</p>}
                </td>
                <td className="px-5 py-3.5">
                  <StagePill stage={lead.pipelineStage} />
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-14 text-center text-slate-400">
                  No leads match these filters yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="mt-5 flex items-center justify-center gap-3">
          <button className="btn-ghost !p-2" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <RiArrowLeftSLine className="h-5 w-5" />
          </button>
          <span className="text-sm text-slate-500">
            Page {page} of {data.pages}
          </span>
          <button className="btn-ghost !p-2" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>
            <RiArrowRightSLine className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );
}

export default function LeadsPage() {
  return (
    <Suspense>
      <LeadsPageInner />
    </Suspense>
  );
}
