"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RiInboxUnarchiveLine,
  RiRefreshLine,
  RiMailLine,
  RiInstagramLine,
  RiWhatsappLine,
  RiInboxArchiveLine,
  RiErrorWarningLine,
  RiExpandUpDownLine,
  RiContractUpDownLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
} from "react-icons/ri";
import { api } from "@/lib/api";
import { useLiveData } from "@/lib/live";
import type { Lead, Stats } from "@/lib/types";
import { QueueCard } from "@/components/QueueCard";

type ChannelFilter = "ALL" | "EMAIL" | "INSTAGRAM_MANUAL" | "WHATSAPP" | "NONE";

/** Enough to work a sitting without scrolling forever, small enough to load fast. */
const PAGE_SIZE = 50;

/**
 * The filter reads `outreachChannel`, which is one value per lead. Showing the
 * count next to each button matters more than it looks: an operator who presses
 * Email, sees an empty queue and has no count concludes the button is broken,
 * when the truth is that no lead in the queue has an email address.
 */
const CHANNELS: Array<{ id: ChannelFilter; label: string; icon?: React.ComponentType<{ className?: string }> }> = [
  { id: "ALL", label: "All" },
  { id: "EMAIL", label: "Email", icon: RiMailLine },
  { id: "INSTAGRAM_MANUAL", label: "Instagram", icon: RiInstagramLine },
  { id: "WHATSAPP", label: "WhatsApp", icon: RiWhatsappLine },
  { id: "NONE", label: "No route", icon: RiErrorWarningLine },
];

export default function QueuePage() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState<ChannelFilter>("ALL");
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /*
   * The queue is worked from the top, but it must still be possible to reach
   * the bottom. It listed the first hundred by priority and stopped: with more
   * than that waiting, the rest could be seen on the leads table but not
   * approved or sent from anywhere, because the queue card is the only place
   * those actions exist.
   */
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [budget, setBudget] = useState<Stats["email"] | null>(null);

  /*
   * What each filter last showed, kept so flipping back is instant.
   *
   * Switching channel used to blank the list to skeletons and refetch, and the
   * refetch waited on the stats endpoint, which counts the whole collection.
   * Choosing "Email" therefore took several seconds to show anything at all.
   * A ref rather than state: writing to it must not itself cause a render.
   */
  const cached = useRef<Map<string, { items: Lead[]; total: number; pages: number }>>(new Map());

  // A page of one channel is what was fetched, so it is what gets cached.
  const cacheKey = `${channel}:${page}`;

  const load = useCallback(() => {
    let cancelled = false;
    setRefreshing(true);

    /*
     * The two requests are answered separately rather than waited on together.
     * The queue itself comes back in well under a second; the channel tallies
     * come from the stats endpoint, which counts the whole collection and takes
     * several seconds. Waiting for both meant the work list sat behind the
     * numbers above it, and the page showed skeletons the whole time for the
     * sake of five figures on some buttons.
     */
    const queue = api
      .leads({
        /*
         * Two kinds of work, not one.
         *
         * A lead awaiting a decision is the obvious one. A lead already
         * approved whose message has not gone out is the one that used to
         * disappear: approving set `approval.status` to APPROVED, this list
         * asked only for PENDING, and every write refetches, so the card
         * carrying the only Send button in the application vanished within a
         * second of pressing Approve. The pitch could then never be sent from
         * anywhere. A lead leaves here when it is rejected, sent, or marked
         * contacted by hand.
         */
        approvalStatus: "PENDING,APPROVED",
        stage: "PENDING_APPROVAL,APPROVED",
        outreachStatus: "NOT_CONTACTED,DRAFT_CREATED",
        hasPitch: "true",
        sort: "-priority",
        limit: PAGE_SIZE,
        page,
        /*
         * "All" means every lead that can actually be contacted. The queue is a
         * work list, and a lead with no email, no handle and no mobile number is
         * not work: it is research. Those are still one click away under "No
         * route", so nothing is hidden, it is just not mixed in with the leads
         * you can act on.
         */
        channel: channel === "ALL" ? "EMAIL,INSTAGRAM_MANUAL,WHATSAPP" : channel,
      })
      .then((result: { items: Lead[]; total: number; pages?: number }) => {
        if (cancelled) return;
        /*
         * Read defensively. A payload that arrives without its envelope, from
         * a proxy that answered but did not pass the body through, used to put
         * undefined into `total` and take the whole page down on the next
         * render. A queue with a wrong count is recoverable; a blank screen is
         * not.
         */
        const items = Array.isArray(result?.items) ? result.items : [];
        const count = Number.isFinite(result?.total) ? result.total : items.length;
        const pageCount = Number.isFinite(result?.pages) ? Math.max(1, result!.pages!) : 1;
        cached.current.set(cacheKey, { items, total: count, pages: pageCount });
        setLeads(items);
        setTotal(count);
        setPages(pageCount);
        setError(null);
        /*
         * Clearing the last page removes it. Working a queue is exactly the
         * activity that shrinks it, so the page under the operator can stop
         * existing mid-sitting, and staying there shows an empty list with a
         * heading that says leads are waiting.
         */
        if (page > pageCount) setPage(pageCount);
        // The first lead opens so the page is useful on arrival; the rest stay
        // shut so a queue of five hundred is scannable.
        setExpanded((current) => (current.size === 0 && items[0] ? new Set([items[0]._id]) : current));
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });

    // Only the queue itself governs the spinner. The tallies are fetched
    // elsewhere and are not what the page is waiting for.
    queue.finally(() => {
      if (!cancelled) setRefreshing(false);
    });

    return () => {
      cancelled = true;
    };
  }, [channel, page, cacheKey]);


  /*
   * The tallies on the filter buttons are counts of the whole collection, and
   * they do not change because you looked at a different filter. Fetching them
   * on the channel-change path put a multi-second request in front of every
   * flip between All and Email. They are loaded on arrival and refreshed with
   * the rest of the data instead.
   */
  const loadCounts = useCallback(() => {
    let cancelled = false;
    api
      .stats()
      .then((stats: Stats) => {
        if (cancelled) return;
        setCounts(stats.queueByChannel ?? null);
        setBudget(stats.email ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useLiveData(load, 20000);
  useLiveData(loadCounts, 60000);

  /*
   * A selection seen before is shown from the cache while it refreshes, so
   * going back and forth is instant.
   *
   * Only from the cache. Filtering whatever happens to be on screen was the
   * first attempt and it is worse than doing nothing: once you are already on
   * Email, filtering those for WhatsApp leaves nothing, so the page flashed an
   * empty queue before the real answer arrived.
   */
  useEffect(() => {
    const hit = cached.current.get(cacheKey);
    if (!hit) return;
    setLeads(hit.items);
    setTotal(hit.total);
    setPages(hit.pages);
  }, [cacheKey]);

  // Changing channel starts at the top of that channel's queue; staying on
  // page 4 of a filter that only has one page shows an empty list.
  useEffect(() => {
    setPage(1);
  }, [channel]);

  const remove = (id: string) => {
    setLeads((previous) => previous?.filter((lead) => lead._id !== id) ?? null);
    setTotal((value) => Math.max(value - 1, 0));
  };

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allOpen = useMemo(
    () => Boolean(leads?.length) && leads!.every((lead) => expanded.has(lead._id)),
    [leads, expanded],
  );

  const toggleAll = () => setExpanded(allOpen ? new Set() : new Set(leads?.map((lead) => lead._id) ?? []));

  // "All" counts what All shows: the reachable ones. Including the no-route
  // leads here would make the number disagree with the list underneath it.
  const countFor = (id: ChannelFilter) =>
    id === "ALL"
      ? counts
        ? (counts.EMAIL ?? 0) + (counts.INSTAGRAM_MANUAL ?? 0) + (counts.WHATSAPP ?? 0)
        : null
      : (counts?.[id] ?? (counts ? 0 : null));

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
            <RiInboxArchiveLine className="mr-1 h-4 w-4" /> {total.toLocaleString()} waiting
          </span>
          <button type="button" onClick={toggleAll} className="btn-ghost" disabled={!leads?.length}>
            {allOpen ? <RiContractUpDownLine className="h-4 w-4" /> : <RiExpandUpDownLine className="h-4 w-4" />}
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
          <button type="button" onClick={() => load()} className="btn-ghost" disabled={refreshing}>
            <RiRefreshLine className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </header>

      <div className="queue-toolbar toolbar min-w-0 justify-between">
        <div className="queue-channel-filter segmented-control max-w-full" aria-label="Filter approval queue by channel">
          {CHANNELS.map(({ id, label, icon: Icon }) => {
            const count = countFor(id);
            return (
              <button key={id} type="button" aria-pressed={channel === id} onClick={() => setChannel(id)}>
                {Icon && <Icon className="mr-1 inline h-3.5 w-3.5" />}
                {label}
                {count !== null && <span className="ml-1.5 tabular-nums opacity-70">{count}</span>}
              </button>
            );
          })}
        </div>
        <p className="min-w-0 break-words text-xs text-slate-500 dark:text-slate-400">
          Highest commercial priority appears first · need qualifies, reach ranks
        </p>
      </div>

      {/*
        The sending budget, before it is spent rather than after.
        The cap used to make itself known as a 429 on the send the operator had
        already decided to make, which is the last possible moment to find out.
      */}
      {budget && budget.dailyCap > 0 && budget.remaining <= Math.max(5, Math.round(budget.dailyCap * 0.2)) && (
        <p
          role="status"
          className={`mt-4 border-l-4 py-2 pl-3 text-xs ${
            budget.remaining === 0
              ? "border-rose-500 text-rose-600 dark:text-rose-400"
              : "border-amber-500 text-amber-700 dark:text-amber-400"
          }`}
        >
          {budget.remaining === 0
            ? `Today's sending cap is reached (${budget.sentToday} of ${budget.dailyCap}). Approving still works and the drafts keep, but email sends will be refused until tomorrow.`
            : `${budget.remaining} email${budget.remaining === 1 ? "" : "s"} left in today's cap of ${budget.dailyCap}. Instagram and WhatsApp are not capped.`}
        </p>
      )}

      {error && (
        <div className="mt-6 border-l-4 border-rose-500 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400">
          {error}
        </div>
      )}

      {!leads && !error && (
        <div className="mt-6 space-y-5">
          {[...Array(3)].map((_, index) => (
            <div key={index} className="skeleton-block h-40" />
          ))}
        </div>
      )}

      {leads && leads.length === 0 && (
        <div className="empty-state mt-6">
          <div className="empty-state-icon">
            <RiInboxUnarchiveLine />
          </div>
          <h2 className="mt-4 font-heading text-xl font-extrabold">
            {channel === "ALL" ? "Queue is clear" : "Nothing on this channel"}
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            {channel === "ALL"
              ? "No pitches are waiting. Run a scan from the overview to find more businesses."
              : "No lead in the queue is reachable this way. Try another channel, or check that enrichment found contacts on your last scan."}
          </p>
        </div>
      )}

      <div className="queue-list mt-6 min-w-0 max-w-full space-y-5">
        {leads?.map((lead, index) => (
          <QueueCard
            key={lead._id}
            lead={lead}
            onDone={remove}
            /* Counted across the whole queue, not within the page: "review 3
               of 50" under a heading that said 412 waiting was two answers to
               one question. */
            position={(page - 1) * PAGE_SIZE + index + 1}
            total={total}
            open={expanded.has(lead._id)}
            onToggle={toggle}
          />
        ))}
      </div>

      {/*
        Offset paging over a list that shrinks as it is worked: clearing leads
        on page 1 pulls the rest up, which is the same behaviour as the leads
        table and the reason the page is re-read rather than kept.
      */}
      {pages > 1 && (
        <nav className="mt-8 flex items-center justify-center gap-0" aria-label="Approval queue pages">
          <button
            type="button"
            className="btn-ghost !p-2"
            disabled={page <= 1 || refreshing}
            onClick={() => {
              setPage((value) => Math.max(1, value - 1));
              window.scrollTo({ top: 0 });
            }}
          >
            <RiArrowLeftSLine className="h-5 w-5" />
            <span className="sr-only">Previous page</span>
          </button>
          <span className="border-y border-slate-300 px-4 py-2 text-sm font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300">
            Page {page} of {pages}
          </span>
          <button
            type="button"
            className="btn-ghost !p-2"
            disabled={page >= pages || refreshing}
            onClick={() => {
              setPage((value) => value + 1);
              window.scrollTo({ top: 0 });
            }}
          >
            <RiArrowRightSLine className="h-5 w-5" />
            <span className="sr-only">Next page</span>
          </button>
        </nav>
      )}
    </div>
  );
}
