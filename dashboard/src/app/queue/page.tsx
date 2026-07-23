"use client";

import { useCallback, useEffect, useState } from "react";
import { RiInboxUnarchiveLine, RiRefreshLine, RiMailLine, RiInstagramLine, RiInboxArchiveLine } from "react-icons/ri";
import { api } from "@/lib/api";
import type { Lead } from "@/lib/types";
import { QueueCard } from "@/components/QueueCard";

export default function QueuePage() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState<"ALL" | "EMAIL" | "INSTAGRAM_MANUAL">("ALL");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setRefreshing(true);
    api
      .leads({
        approvalStatus: "PENDING",
        stage: "PENDING_APPROVAL,APPROVED",
        sort: "-score",
        limit: 50,
        channel: channel === "ALL" ? undefined : channel,
      })
      .then((result) => {
        if (cancelled) return;
        setLeads(result.items);
        setError(null);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [channel]);

  useEffect(load, [load]);

  const remove = (id: string) => setLeads((previous) => previous?.filter((lead) => lead._id !== id) ?? null);
  const emailCount = leads?.filter((lead) => lead.outreachChannel === "EMAIL").length ?? 0;
  const instagramCount = leads?.filter((lead) => lead.outreachChannel === "INSTAGRAM_MANUAL").length ?? 0;

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="page-kicker">Human approval gate</p>
          <h1 className="page-title">Approval queue</h1>
          <p className="page-subtitle">
            Review the intelligence, edit the pitch, and approve the next action. Nothing is sent without your decision.
          </p>
        </div>
        <div className="page-actions">
          <span className="status-badge text-brand-600">
            <RiInboxArchiveLine className="mr-1 h-4 w-4" /> {leads?.length ?? 0} waiting
          </span>
          <button type="button" onClick={() => load()} className="btn-ghost" disabled={refreshing}>
            <RiRefreshLine className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </header>

      <div className="toolbar justify-between">
        <div className="segmented-control" aria-label="Filter approval queue by channel">
          <button type="button" aria-pressed={channel === "ALL"} onClick={() => setChannel("ALL")}>
            All {leads ? `(${leads.length})` : ""}
          </button>
          <button type="button" aria-pressed={channel === "EMAIL"} onClick={() => setChannel("EMAIL")}>
            <RiMailLine className="mr-1 inline h-3.5 w-3.5" /> Email {channel === "ALL" && leads ? `(${emailCount})` : ""}
          </button>
          <button type="button" aria-pressed={channel === "INSTAGRAM_MANUAL"} onClick={() => setChannel("INSTAGRAM_MANUAL")}>
            <RiInstagramLine className="mr-1 inline h-3.5 w-3.5" /> Instagram {channel === "ALL" && leads ? `(${instagramCount})` : ""}
          </button>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Highest lead score appears first · edits save on approval
        </p>
      </div>

      {error && (
        <div className="mt-6 border-l-4 border-rose-500 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400">
          {error}
        </div>
      )}

      {!leads && !error && (
        <div className="mt-6 space-y-5">
          {[...Array(3)].map((_, index) => (
            <div key={index} className="skeleton-block h-80" />
          ))}
        </div>
      )}

      {leads && leads.length === 0 && (
        <div className="empty-state mt-6">
          <div className="empty-state-icon">
            <RiInboxUnarchiveLine />
          </div>
          <h2 className="mt-4 font-heading text-xl font-extrabold">Queue is clear</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            No pitches are waiting for this channel. Run discovery from the overview or switch the queue filter.
          </p>
        </div>
      )}

      <div className="mt-6 space-y-5">
        {leads?.map((lead, index) => (
          <QueueCard key={lead._id} lead={lead} onDone={remove} position={index + 1} total={leads.length} />
        ))}
      </div>
    </div>
  );
}
