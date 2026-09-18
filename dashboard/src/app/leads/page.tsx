"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  RiArrowLeftSLine,
  RiArrowRightLine,
  RiArrowRightSLine,
  RiCloseLine,
  RiContactsBook2Line,
  RiFilter3Line,
  RiLoader4Line,
  RiSearchLine,
  RiUploadCloud2Line,
} from "react-icons/ri";
import { api } from "@/lib/api";
import {
  CONTACTABLE_LABELS,
  CONTACTABLE_OPTIONS,
  DISCOVERY_SOURCES,
  MATURITIES,
  OUTREACH_STATUSES,
  PIPELINE_STAGES,
  SORT_LABELS,
  SORT_OPTIONS,
  WEBSITE_TYPES,
  optionLabel,
} from "@/lib/enums";
import type { Lead } from "@/lib/types";
import { whatsappNumber } from "@/lib/contacts";
import {
  IntelligenceScores,
  MaturityBadge,
  SourceBadge,
  StagePill,
  WebsiteTypeBadge,
} from "@/components/badges";
import { ImportPanel } from "@/components/ImportPanel";

const SORTS = [
  ["-priority", "Highest priority"],
  ["-score", "Highest need"],
  ["-reach", "Easiest to reach"],
  ["-created", "Newest discovered"],
  ["reviews", "Fewest reviews"],
  ["-reviews", "Most reviews"],
  ["name", "Business name A–Z"],
  ["-name", "Business name Z–A"],
] as const;

type Filters = {
  search: string;
  websiteType: string;
  stage: string;
  /** Carried so a link from the overview funnel reproduces the figure it showed. */
  approvalStatus: string;
  outreachStatus: string;
  contactable: string;
  maturity: string;
  source: string;
  city: string;
  category: string;
  minScore: string;
  maxScore: string;
  minReach: string;
  createdWithinDays: string;
  minRating: string;
  maxReviews: string;
  minRatingVelocity: string;
  newToGoogle: string;
  openingSoon: string;
  hasPitch: string;
  optedOut: string;
  sort: string;
};

const DEFAULT_FILTERS: Filters = {
  search: "",
  websiteType: "",
  stage: "",
  approvalStatus: "",
  outreachStatus: "",
  contactable: "",
  maturity: "",
  source: "",
  city: "",
  category: "",
  minScore: "",
  maxScore: "",
  minReach: "",
  createdWithinDays: "",
  minRating: "",
  maxReviews: "",
  minRatingVelocity: "",
  newToGoogle: "",
  openingSoon: "",
  hasPitch: "",
  optedOut: "",
  sort: "-priority",
};

const FILTER_LABELS: Record<keyof Omit<Filters, "sort">, string> = {
  search: "Search",
  websiteType: "Website",
  stage: "Stage",
  approvalStatus: "Approval",
  outreachStatus: "Outreach",
  contactable: "Contact",
  maturity: "Maturity",
  source: "Source",
  city: "City",
  category: "Category",
  minScore: "Need from",
  maxScore: "Need to",
  minReach: "Reach from",
  createdWithinDays: "Discovered",
  minRating: "Rating from",
  maxReviews: "Reviews to",
  minRatingVelocity: "Review growth",
  newToGoogle: "New to Google",
  openingSoon: "Opening soon",
  hasPitch: "Pitch",
  optedOut: "Opted out",
};

function readFilters(params: URLSearchParams): Filters {
  const next = { ...DEFAULT_FILTERS };
  for (const key of Object.keys(next) as Array<keyof Filters>) next[key] = params.get(key) ?? next[key];
  return next;
}

function displayValue(key: keyof Omit<Filters, "sort">, value: string): string {
  if (key === "createdWithinDays") return `last ${value} days`;
  if (key === "minRatingVelocity") return `${value}+ reviews/week`;
  if (value === "true") return "yes";
  if (value === "false") return "no";
  return value.replaceAll("_", " ").replaceAll(",", " or ").toLowerCase();
}

function LeadsPageInner() {
  const params = useSearchParams();
  const router = useRouter();
  const initialParams = useRef(params.toString());
  const [filters, setFilters] = useState<Filters>(() => readFilters(new URLSearchParams(initialParams.current)));
  const [page, setPage] = useState(() => Math.max(Number(params.get("page") ?? 1), 1));
  const [data, setData] = useState<{ items: Lead[]; total: number; pages: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const requestSequence = useRef(0);
  const lastWrittenQuery = useRef(initialParams.current);

  useEffect(() => {
    const incoming = params.toString();
    if (incoming === lastWrittenQuery.current) return;
    setFilters(readFilters(new URLSearchParams(incoming)));
    setPage(Math.max(Number(params.get("page") ?? 1), 1));
  }, [params]);

  useEffect(() => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (!value) continue;
      if (key === "sort" && value === DEFAULT_FILTERS.sort) continue;
      query.set(key, value);
    }
    if (page > 1) query.set("page", String(page));
    const serialized = query.toString();
    lastWrittenQuery.current = serialized;
    router.replace(serialized ? `/leads?${serialized}` : "/leads", { scroll: false });
  }, [filters, page, router]);

  useEffect(() => {
    if (!advancedOpen || window.matchMedia("(min-width: 768px)").matches) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [advancedOpen]);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    try {
      const result = await api.leads({
        ...filters,
        page,
        limit: 25,
      });
      if (sequence !== requestSequence.current) return;
      setData(result);
      setError(null);
    } catch (caught) {
      if (sequence !== requestSequence.current) return;
      setError(caught instanceof Error ? caught.message : "Could not load leads");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), filters.search ? 350 : 0);
    return () => window.clearTimeout(timeout);
  }, [filters.search, load]);

  const activeEntries = useMemo(
    () =>
      (Object.entries(filters) as Array<[keyof Filters, string]>).filter(
        ([key, value]) => key !== "sort" && Boolean(value),
      ) as Array<[keyof Omit<Filters, "sort">, string]>,
    [filters],
  );

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  function clearFilters() {
    setFilters({ ...DEFAULT_FILTERS });
    setPage(1);
  }

  function applyPreset(patch: Partial<Filters>) {
    setFilters({ ...DEFAULT_FILTERS, search: filters.search, ...patch });
    setPage(1);
  }

  return (
    <div className="page-shell">
      <ImportPanel open={importOpen} onClose={() => setImportOpen(false)} onDone={() => void load()} />

      <header className="page-header">
        <div>
          <p className="page-kicker">Lead intelligence</p>
          <h1 className="page-title">All leads</h1>
          <p className="page-subtitle">
            Prioritise genuine website need, recency, activity, and the fastest available route to a conversation.
          </p>
        </div>
        <div className="page-actions">
          <span className="status-badge text-slate-600 dark:text-slate-300">
            {loading ? <RiLoader4Line className="mr-1 animate-spin" /> : null}
            {data?.total.toLocaleString() ?? "—"} results
          </span>
          <button onClick={() => setImportOpen(true)} className="btn-primary">
            <RiUploadCloud2Line className="h-4 w-4" /> Import leads
          </button>
        </div>
      </header>

      <div className="toolbar">
        <div className="relative min-w-0 flex-[2_1_22rem]">
          <RiSearchLine className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input !pl-10"
            aria-label="Search leads"
            placeholder="Search business, email, phone, website, category, or city…"
            value={filters.search}
            onChange={(event) => updateFilter("search", event.target.value)}
          />
        </div>
        <select
          className="input !w-auto min-w-48 flex-1"
          value={filters.websiteType}
          aria-label="Filter by website type"
          onChange={(event) => updateFilter("websiteType", event.target.value)}
        >
          <option value="">All website opportunities</option>
          {WEBSITE_TYPES.map((value) => <option key={value} value={value}>{displayValue("websiteType", value)}</option>)}
        </select>
        <select
          className="input !w-auto min-w-44 flex-1"
          value={filters.stage}
          aria-label="Filter by pipeline stage"
          onChange={(event) => updateFilter("stage", event.target.value)}
        >
          <option value="">All pipeline stages</option>
          {PIPELINE_STAGES.map((value) => <option key={value} value={value}>{displayValue("stage", value)}</option>)}
        </select>
        <select
          className="input !w-auto min-w-44 flex-1"
          value={filters.sort}
          aria-label="Sort leads"
          onChange={(event) => updateFilter("sort", event.target.value)}
        >
          {SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button
          type="button"
          className="btn-ghost shrink-0"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          <RiFilter3Line /> Filters
          {activeEntries.length > 0 && (
            <span className="inline-flex min-w-5 items-center justify-center bg-brand-600 px-1 text-[10px] font-extrabold text-white">
              {activeEntries.length}
            </span>
          )}
        </button>
      </div>

      <div className="mt-3 flex max-w-full flex-wrap gap-2" aria-label="Quick lead filters">
        <QuickFilter label="Highest priority" onClick={() => applyPreset({ sort: "-priority" })} />
        <QuickFilter label="New businesses" onClick={() => applyPreset({ maturity: "NEW" })} />
        <QuickFilter label="Opening soon" onClick={() => applyPreset({ openingSoon: "true" })} />
        <QuickFilter label="Rising activity" onClick={() => applyPreset({ minRatingVelocity: "2" })} />
        <QuickFilter label="Contactable now" onClick={() => applyPreset({ contactable: "any" })} />
        <QuickFilter label="Needs contact research" onClick={() => applyPreset({ contactable: "none" })} />
        <QuickFilter label="No website" onClick={() => applyPreset({ websiteType: "NO_WEBSITE" })} />
      </div>

      {advancedOpen && (
        <div className="fixed inset-0 z-[80] overflow-y-auto bg-white p-4 md:static md:z-auto md:mt-4 md:overflow-visible md:border md:border-slate-300 md:bg-transparent md:p-0 dark:bg-slate-950 md:dark:border-slate-700 md:dark:bg-transparent">
          <div className="mx-auto w-full max-w-6xl bg-white md:max-w-none dark:bg-slate-950">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4 md:p-4 dark:border-slate-800">
              <div>
                <p className="page-kicker">Advanced filters</p>
                <h2 className="font-heading text-xl font-extrabold">Find the exact leads worth working</h2>
              </div>
              <button type="button" onClick={() => setAdvancedOpen(false)} className="btn-ghost h-11 w-11 !p-0" aria-label="Close filters">
                <RiCloseLine />
              </button>
            </div>
            <div className="grid gap-4 py-5 md:p-5 sm:grid-cols-2 lg:grid-cols-4">
              <FilterSelect label="Outreach status" value={filters.outreachStatus} onChange={(value) => updateFilter("outreachStatus", value)} options={OUTREACH_STATUSES} />
              <FilterSelect label="Contact route" value={filters.contactable} onChange={(value) => updateFilter("contactable", value)} options={["any", "email", "phone", "whatsapp", "instagram", "none"]} />
              <FilterSelect label="Business maturity" value={filters.maturity} onChange={(value) => updateFilter("maturity", value)} options={MATURITIES} />
              <FilterSelect label="Discovery source" value={filters.source} onChange={(value) => updateFilter("source", value)} options={DISCOVERY_SOURCES} />
              <FilterInput label="City" value={filters.city} onChange={(value) => updateFilter("city", value)} placeholder="e.g. Lagos" />
              <FilterInput label="Category" value={filters.category} onChange={(value) => updateFilter("category", value)} placeholder="e.g. restaurants" />
              <FilterInput label="Minimum need score" value={filters.minScore} onChange={(value) => updateFilter("minScore", value)} type="number" placeholder="0" />
              <FilterInput label="Maximum need score" value={filters.maxScore} onChange={(value) => updateFilter("maxScore", value)} type="number" placeholder="100" />
              <FilterInput label="Minimum reach score" value={filters.minReach} onChange={(value) => updateFilter("minReach", value)} type="number" placeholder="0" />
              <FilterSelect label="Discovered within" value={filters.createdWithinDays} onChange={(value) => updateFilter("createdWithinDays", value)} options={["1", "7", "30", "90", "365"]} suffix=" days" />
              <FilterInput label="Minimum rating" value={filters.minRating} onChange={(value) => updateFilter("minRating", value)} type="number" placeholder="4.0" step="0.1" />
              <FilterInput label="Maximum reviews" value={filters.maxReviews} onChange={(value) => updateFilter("maxReviews", value)} type="number" placeholder="50" />
              <FilterInput label="Minimum reviews/week" value={filters.minRatingVelocity} onChange={(value) => updateFilter("minRatingVelocity", value)} type="number" placeholder="2" step="0.1" />
              <BooleanSelect label="New to Google" value={filters.newToGoogle} onChange={(value) => updateFilter("newToGoogle", value)} />
              <BooleanSelect label="Opening soon" value={filters.openingSoon} onChange={(value) => updateFilter("openingSoon", value)} />
              <BooleanSelect label="Pitch available" value={filters.hasPitch} onChange={(value) => updateFilter("hasPitch", value)} />
              <BooleanSelect label="Opted-out records" value={filters.optedOut} onChange={(value) => updateFilter("optedOut", value)} />
            </div>
            <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white py-4 md:px-5 dark:border-slate-800 dark:bg-slate-950">
              <p className="text-xs text-slate-500">Every change applies immediately.</p>
              <div className="flex gap-2">
                <button type="button" onClick={clearFilters} className="btn-ghost">Clear all</button>
                <button type="button" onClick={() => setAdvancedOpen(false)} className="btn-primary">View {data?.total.toLocaleString() ?? ""} leads</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeEntries.length > 0 && (
        <div className="mt-4 flex max-w-full flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-500">Applied:</span>
          {activeEntries.map(([key, value]) => (
            <button key={key} type="button" onClick={() => updateFilter(key, "")} className="inline-flex min-h-9 max-w-full items-center gap-1 border border-brand-500/40 bg-brand-500/5 px-2.5 text-xs font-bold text-brand-700 dark:text-brand-400">
              <span className="truncate">{FILTER_LABELS[key]}: {displayValue(key, value)}</span>
              <RiCloseLine className="shrink-0" />
            </button>
          ))}
          <button type="button" onClick={clearFilters} className="min-h-9 px-2 text-xs font-bold text-slate-500 hover:text-rose-500">Clear all</button>
        </div>
      )}

      {error && <div className="mt-6 border-l-4 border-rose-500 bg-rose-500/5 p-4 text-sm text-rose-600">{error}</div>}

      <div className={`desktop-table table-shell transition-opacity ${loading && data ? "opacity-60" : ""}`} aria-busy={loading}>
        {/*
          A fixed column model, not automatic widths.
          Left to itself the browser sizes columns from their content, so a page
          of DISCOVERED leads, which have no score, no classification and no
          contact yet, collapsed five columns to nothing and squeezed the
          business name into what was left. The widths below are the same
          whatever the rows happen to contain; only the business column takes
          the slack.
        */}
        <table className="data-table data-table-fixed min-w-[1340px]">
          <colgroup>
            <col style={{ width: "180px" }} />
            <col />
            <col style={{ width: "180px" }} />
            <col style={{ width: "168px" }} />
            <col style={{ width: "224px" }} />
            <col style={{ width: "168px" }} />
            <col style={{ width: "68px" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Priority</th>
              <th>Business</th>
              <th>Website opportunity</th>
              <th>Recency & activity</th>
              <th>Best contact</th>
              <th>Stage</th>
              <th aria-label="Open lead" />
            </tr>
          </thead>
          <tbody>
            {!data && [...Array(8)].map((_, index) => <tr key={index}><td colSpan={7}><div className="skeleton-block h-9" /></td></tr>)}
            {data?.items.map((lead) => (
              <tr key={lead._id}>
                <td><IntelligenceScores compact priority={lead.priorityScore} need={lead.needScore ?? lead.leadScore} reach={lead.reachScore} /></td>
                <td>
                  <Link href={`/leads/${lead._id}`} className="block truncate font-bold text-slate-800 hover:text-brand-600 dark:text-slate-100">{lead.businessName}</Link>
                  <p className="mt-1 truncate text-xs capitalize text-slate-400">{lead.category} · {lead.city}</p>
                  <div className="mt-2"><SourceBadge source={lead.discoverySource} /></div>
                </td>
                <td>
                  {/* An unchecked lead has no classification yet. Saying so is
                      more use than an empty cell that looks like a fault. */}
                  {lead.websiteCheck || lead.websiteType !== "NO_WEBSITE" || lead.pipelineStage !== "DISCOVERED" ? (
                    <WebsiteTypeBadge type={lead.websiteType} />
                  ) : (
                    <span className="status-badge text-slate-400">Not checked yet</span>
                  )}
                  <p className="mt-1 text-[11px] text-slate-400">
                    {lead.rating != null ? `${lead.rating.toFixed(1)}★` : "No rating"} · {lead.userRatingCount ?? 0} reviews
                  </p>
                </td>
                <td>
                  <MaturityBadge maturity={lead.maturity} newToGoogle={lead.newToGoogle} />
                  <p className="mt-1 text-[11px] text-slate-400">
                    {lead.openingSoon ? "Opening soon" : (lead.ratingVelocity ?? 0) >= 2 ? `+${lead.ratingVelocity?.toFixed(1)} reviews/week` : "No rising signal"}
                  </p>
                </td>
                <td className="text-xs text-slate-500 dark:text-slate-400">
                  <BestContact lead={lead} />
                </td>
                <td><StagePill stage={lead.pipelineStage} /></td>
                <td className="text-right">
                  <Link href={`/leads/${lead._id}`} className="inline-flex h-11 w-11 items-center justify-center border border-slate-300 text-slate-500 hover:border-brand-600 hover:text-brand-600 dark:border-slate-700">
                    <RiArrowRightLine /><span className="sr-only">Open {lead.businessName}</span>
                  </Link>
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && <tr><td colSpan={7} className="py-16 text-center text-slate-400">No leads match these filters.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className={`mobile-record-list transition-opacity ${loading && data ? "opacity-60" : ""}`} aria-busy={loading}>
        {!data && [...Array(5)].map((_, index) => <div key={index} className="skeleton-block mb-3 h-48" />)}
        {data?.items.map((lead) => (
          <Link key={lead._id} href={`/leads/${lead._id}`} className="mobile-record">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-heading text-base font-extrabold">{lead.businessName}</h2>
                <p className="mt-0.5 truncate text-xs capitalize text-slate-400">{lead.category} · {lead.city}</p>
              </div>
              <RiArrowRightLine className="mt-1 shrink-0 text-slate-400" />
            </div>
            <div className="mt-3 overflow-x-auto pb-1">
              <IntelligenceScores priority={lead.priorityScore} need={lead.needScore ?? lead.leadScore} reach={lead.reachScore} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <WebsiteTypeBadge type={lead.websiteType} />
              <MaturityBadge maturity={lead.maturity} newToGoogle={lead.newToGoogle} />
              <StagePill stage={lead.pipelineStage} />
            </div>
            <div className="mobile-record-grid">
              <div>
                <span className="mobile-record-label">Best contact</span>
                <span className="block truncate text-sm text-slate-600 dark:text-slate-300">
                  {lead.email ?? (lead.whatsappAvailable ? lead.phoneNormalized : lead.instagramUsername ? `@${lead.instagramUsername}` : lead.phoneNormalized ?? "Needs research")}
                </span>
              </div>
              <div>
                <span className="mobile-record-label">Activity</span>
                <span className="text-sm text-slate-600 dark:text-slate-300">
                  {lead.rating ?? "—"}★ · {lead.userRatingCount ?? 0} reviews
                  {(lead.ratingVelocity ?? 0) >= 2 ? ` · +${lead.ratingVelocity?.toFixed(1)}/week` : ""}
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
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button className="btn-ghost !p-2" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>
            <RiArrowLeftSLine className="h-5 w-5" /><span className="sr-only">Previous page</span>
          </button>
          <span className="border-y border-slate-300 px-4 py-2 text-sm font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300">Page {page} of {data.pages}</span>
          <button className="btn-ghost !p-2" disabled={page >= data.pages || loading} onClick={() => setPage((value) => value + 1)}>
            <RiArrowRightSLine className="h-5 w-5" /><span className="sr-only">Next page</span>
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The one contact worth showing in a table cell, chosen the same way outreach
 * chooses a channel, so the column and the queue never disagree.
 */
function BestContact({ lead }: { lead: Lead }) {
  const wa = whatsappNumber(lead);
  if (lead.email) return <p className="truncate" title={lead.email}>{lead.email}</p>;
  if (lead.instagramUsername) return <p className="truncate">@{lead.instagramUsername}</p>;
  if (wa) {
    return (
      <p className="truncate">
        {wa} <span className="text-slate-400">· WhatsApp</span>
      </p>
    );
  }
  if (lead.phone || lead.phoneNormalized) return <p className="truncate">{lead.phoneNormalized ?? lead.phone}</p>;
  return <p className="truncate text-rose-400">Needs contact research</p>;
}

function QuickFilter({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="min-h-9 border border-slate-300 bg-white px-3 text-xs font-bold text-slate-600 hover:border-brand-500 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">{label}</button>;
}

function FilterSelect({ label, value, options, onChange, suffix = "" }: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void; suffix?: string }) {
  return (
    <label>
      <span className="label">{label}</span>
      <select className="input" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option.replaceAll("_", " ").replaceAll(",", " or ").toLowerCase()}{suffix}
          </option>
        ))}
      </select>
    </label>
  );
}

function BooleanSelect({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      <span className="label">{label}</span>
      <select className="input" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Either</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    </label>
  );
}

function FilterInput({ label, value, onChange, type = "text", placeholder, step }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string; step?: string }) {
  return (
    <label>
      <span className="label">{label}</span>
      <input className="input" type={type} min={type === "number" ? "0" : undefined} step={step} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export default function LeadsPage() {
  return (
    <Suspense fallback={<div className="skeleton-block h-[70vh]" />}>
      <LeadsPageInner />
    </Suspense>
  );
}
