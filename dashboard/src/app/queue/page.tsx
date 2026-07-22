"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { RiInboxUnarchiveLine, RiRefreshLine } from "react-icons/ri";
import { api } from "@/lib/api";
import type { Lead } from "@/lib/types";
import { QueueCard } from "@/components/QueueCard";

export default function QueuePage() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState<"ALL" | "EMAIL" | "INSTAGRAM_MANUAL">("ALL");

  const load = useCallback(() => {
    let cancelled = false;
    api
      .leads({
        approvalStatus: "PENDING",
        stage: "PENDING_APPROVAL,APPROVED",
        sort: "-score",
        limit: 50,
        channel: channel === "ALL" ? undefined : channel,
      })
      .then((r) => {
        if (cancelled) return;
        setLeads(r.items);
        setError(null);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [channel]);

  useEffect(load, [load]);

  const remove = (id: string) => setLeads((prev) => prev?.filter((l) => l._id !== id) ?? null);

  return (
    <div className="mx-auto max-w-5xl">
      <motion.header initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-extrabold tracking-tight sm:text-4xl">
            Approval{" "}
            <span className="bg-gradient-to-r from-brand-600 to-purple-600 bg-clip-text text-transparent">queue</span>
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Review each pitch, tweak the words, approve, nothing is sent without you.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(["ALL", "EMAIL", "INSTAGRAM_MANUAL"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setChannel(c)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                channel === c
                  ? "bg-gradient-to-r from-brand-600 to-brand-500 text-white shadow-lg shadow-brand-500/25"
                  : "border border-slate-200 bg-white/60 text-slate-500 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900/60"
              }`}
            >
              {c === "ALL" ? "All" : c === "EMAIL" ? "Email" : "Instagram"}
            </button>
          ))}
          <button onClick={load} className="btn-ghost !p-2" title="Refresh">
            <RiRefreshLine className="h-4 w-4" />
          </button>
        </div>
      </motion.header>

      {error && <p className="mt-8 rounded-xl bg-rose-500/10 p-4 text-sm text-rose-500">{error}</p>}

      {!leads && !error && (
        <div className="mt-8 space-y-6">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-72 animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
          ))}
        </div>
      )}

      {leads && leads.length === 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-card mt-10 p-12 text-center"
        >
          <RiInboxUnarchiveLine className="mx-auto h-12 w-12 text-slate-300 dark:text-slate-600" />
          <h2 className="mt-4 font-heading text-xl font-bold">Queue is clear</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">
            No pitches waiting for review. Run discovery from the overview page, or wait for the next scheduled run.
          </p>
        </motion.div>
      )}

      <div className="mt-8 space-y-6">
        <AnimatePresence mode="popLayout">
          {leads?.map((lead) => <QueueCard key={lead._id} lead={lead} onDone={remove} />)}
        </AnimatePresence>
      </div>
    </div>
  );
}
