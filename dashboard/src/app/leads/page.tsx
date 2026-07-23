"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  RiSearchLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiUploadCloud2Line,
  RiCloseLine,
  RiFilter3Line,
  RiContactsBook2Line,
  RiArrowRightLine,
} from "react-icons/ri";
import { api } from "@/lib/api";
import type { Lead } from "@/lib/types";
import { ScoreBadge, StagePill, WebsiteTypeBadge } from "@/components/badges";
import { ImportPanel } from "@/components/ImportPanel";

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
  const [outreachStatus, setOutreachStatus] = useState(params.get("outreachStatus") ?? "");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

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
      .then((result) => {
        if (cancelled) return;
        setData(result);
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
    const timeout = window.setTimeout(() => {
      cancel = load();
    }, search ? 350 : 0);
    return () => {
      window.clearTimeout(timeout);
      cancel?.();
    };
  }, [load, search]);

  const activeFilters = useMemo(
    () => [search, websiteType, stage, outreachStatus].filter(Boolean).length,
    [search, websiteType, stage, outreachStatus],
  );

  function clearFilters() {
    setSearch("");
    setWebsiteType("");
    setStage("");
    setOutreachStatus("");
    setPage(1);
  }

  return (
    <div className="page-shell">
      <ImportPanel open={importOpen} onClose={() => setImportOpen(false)} onDone={load} />

      <header className="page-header">
        <div>
          <p className="page-kicker">Lead database</p>
          <h1 className="page-title">All leads</h1>
          <p className="page-subtitle">
            Search, filter, inspect, and move from raw discovery data to the next commercial action.
          </p>
        </div>
        <div className="page-actions">
          {data && <span className="status-badge text-slate-600 dark:text-slate-300">{data.total.toLocaleString()} results</span>}
          <button onClick={() => setImportOpen(true)} className="btn-cta">
            <RiUploadCloud2Line className="h-4 w-4" /> Import leads
          </button>
        </div>
      </header>

      <div className="toolbar">
        <div className="relative min-w-56 flex-[2_1_22rem]">
          <RiSearchLine className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input !pl-10"
            placeholder="Search business, email, Instagram, or city…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <select
          className="input !w-auto min-w-44 flex-1"
          value={websiteType}
          aria-label="Filter by website type"
          onChange={(event) => {
            setWebsiteType(event.target.value);
            setPage(1);
          }}
        >
          <option value="">All website types</option>
          {WEBSITE_TYPES.map((type) => (
            <option key={type} value={type}>
              {type.replaceAll("_", " ").toLowerCase()}
            </option>
          ))}
        </select>
        <select
          className="input !w-auto min-w-40 flex-1"
          value={stage}
          aria-label="Filter by pipeline stage"
          onChange={(event) => {
            setStage(event.target.value);
            setPage(1);
          }}
        >
          <option value="">All stages</option>
          {STAGES.map((item) => (
            <option key={item} value={item}>
              {item.replaceAll("_", " ").toLowerCase()}
            </option>
          ))}
        </select>
        {outreachStatus && (
          <button type="button" onClick={() => setOutreachStatus("")} className="btn-ghost">
            {outreachStatus.replaceAll("_", " ").toLowerCase()} <RiCloseLine className="h-4 w-4" />
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-500">
            <RiFilter3Line /> {activeFilters} active
          </span>
          {activeFilters > 0 && (
            <button type="button" onClick={clearFilters} className="btn-ghost">
              Clear filters
            </button>
          )}
        </div>
      </div>

      {error && <div className="mt-6 border-l-4 border-rose-500 bg-rose-500/5 p-4 text-sm text-rose-600">{error}</div>}

      <div className="desktop-table table-shell">
        <table className="data-table min-w-[820px]">
          <thead>
            <tr>
              <th title="Sorted highest to lowest">Score ↓</th>
              <th>Business</th>
              <th>Website opportunity</th>
              <th>Contact</th>
              <th>Stage</th>
              <th aria-label="Open lead" />
            </tr>
          </thead>
          <tbody>
            {!data &&
              [...Array(8)].map((_, index) => (
                <tr key={index}>
                  <td colSpan={6}>
                    <div className="skeleton-block h-7" />
                  </td>
                </tr>
              ))}
            {data?.items.map((lead) => (
              <tr key={lead._id}>
                <td>
                  <ScoreBadge score={lead.leadScore} />
                </td>
                <td>
                  <Link href={`/leads/${lead._id}`} className="font-bold text-slate-800 hover:text-brand-600 dark:text-slate-100">
                    {lead.businessName}
                  </Link>
                  <p className="mt-0.5 text-xs capitalize text-slate-400">
                    {lead.category} · {lead.city}
                    {lead.openingSoon && <span className="ml-1 font-bold text-cta-500">· new business</span>}
                  </p>
                </td>
                <td>
                  <WebsiteTypeBadge type={lead.websiteType} />
                  {lead.websiteCheck?.issues && lead.websiteCheck.issues.length > 0 && (
                    <p className="mt-1 text-[11px] text-slate-400">{lead.websiteCheck.issues.length} audit issue(s)</p>
                  )}
                </td>
                <td className="text-xs text-slate-500 dark:text-slate-400">
                  {lead.email && <p className="max-w-52 truncate">{lead.email}</p>}
                  {lead.instagramUsername && <p>@{lead.instagramUsername}</p>}
                  {!lead.email && !lead.instagramUsername && lead.phoneNormalized && <p>{lead.phoneNormalized}</p>}
                  {!lead.email && !lead.instagramUsername && !lead.phoneNormalized && <p className="text-rose-400">No direct contact</p>}
                </td>
                <td>
                  <StagePill stage={lead.pipelineStage} />
                </td>
                <td className="text-right">
                  <Link href={`/leads/${lead._id}`} className="inline-flex h-10 w-10 items-center justify-center border border-slate-300 text-slate-500 hover:border-brand-600 hover:text-brand-600 dark:border-slate-700">
                    <RiArrowRightLine />
                    <span className="sr-only">Open {lead.businessName}</span>
                  </Link>
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={6} className="py-16 text-center text-slate-400">
                  No leads match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mobile-record-list">
        {!data &&
          [...Array(5)].map((_, index) => <div key={index} className="skeleton-block mb-3 h-40" />)}
        {data?.items.map((lead) => (
          <Link key={lead._id} href={`/leads/${lead._id}`} className="mobile-record">
            <div className="flex items-start gap-3">
              <ScoreBadge score={lead.leadScore} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate font-heading text-base font-extrabold">{lead.businessName}</h2>
                    <p className="mt-0.5 truncate text-xs capitalize text-slate-400">{lead.category} · {lead.city}</p>
                  </div>
                  <RiArrowRightLine className="mt-1 shrink-0 text-slate-400" />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <WebsiteTypeBadge type={lead.websiteType} />
                  <StagePill stage={lead.pipelineStage} />
                </div>
              </div>
            </div>
            <div className="mobile-record-grid">
              <div>
                <span className="mobile-record-label">Contact</span>
                <span className="block truncate text-sm text-slate-600 dark:text-slate-300">
                  {lead.email ?? (lead.instagramUsername ? `@${lead.instagramUsername}` : lead.phoneNormalized ?? "No direct contact")}
                </span>
              </div>
              <div>
                <span className="mobile-record-label">Audit</span>
                <span className="text-sm text-slate-600 dark:text-slate-300">
                  {lead.websiteCheck?.issues?.length ?? 0} issue(s) · {lead.websiteCheck?.responseTimeMs ? `${lead.websiteCheck.responseTimeMs}ms` : "not timed"}
                </span>
              </div>
            </div>
          </Link>
        ))}
        {data && data.items.length === 0 && (
          <div className="empty-state mt-4">
            <div className="empty-state-icon"><RiContactsBook2Line /></div>
            <h2 className="mt-4 font-heading text-lg font-extrabold">No matching leads</h2>
            <p className="mt-2 text-sm text-slate-500">Adjust or clear the current filters.</p>
          </div>
        )}
      </div>

      {data && data.pages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-3">
          <button className="btn-ghost !p-2" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
            <RiArrowLeftSLine className="h-5 w-5" />
            <span className="sr-only">Previous page</span>
          </button>
          <span className="border-y border-slate-300 px-4 py-2 text-sm font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300">
            Page {page} of {data.pages}
          </span>
          <button className="btn-ghost !p-2" disabled={page >= data.pages} onClick={() => setPage((value) => value + 1)}>
            <RiArrowRightSLine className="h-5 w-5" />
            <span className="sr-only">Next page</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default function LeadsPage() {
  return (
    <Suspense fallback={<div className="skeleton-block h-[70vh]" />}>
      <LeadsPageInner />
    </Suspense>
  );
}
