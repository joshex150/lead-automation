"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import { motion } from "framer-motion";
import {
  RiArrowLeftLine,
  RiMailLine,
  RiInstagramLine,
  RiWhatsappLine,
  RiGlobalLine,
  RiMapPin2Line,
  RiRefreshLine,
  RiTrophyLine,
  RiForbid2Line,
  RiEmotionHappyLine,
  RiEmotionUnhappyLine,
  RiMailCloseLine,
} from "react-icons/ri";
import { api } from "@/lib/api";
import type { Lead, OutreachLogEntry } from "@/lib/types";
import { ScoreBadge, StagePill, WebsiteTypeBadge } from "@/components/badges";

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [lead, setLead] = useState<Lead | null>(null);
  const [history, setHistory] = useState<OutreachLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: "", instagramUsername: "", notes: "", instagramActive: false, strongVisualBrand: false });

  const load = useCallback(() => {
    let cancelled = false;
    api
      .lead(id)
      .then(({ lead, history }) => {
        if (cancelled) return;
        setLead(lead);
        setHistory(history);
        setForm({
          email: lead.email ?? "",
          instagramUsername: lead.instagramUsername ?? "",
          notes: lead.notes ?? "",
          instagramActive: lead.instagramActive,
          strongVisualBrand: lead.strongVisualBrand,
        });
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(load, [load]);

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveDetails() {
    await act("Saved", () =>
      api.updateLead(id, {
        email: form.email || null,
        instagramUsername: form.instagramUsername || null,
        notes: form.notes || null,
        instagramActive: form.instagramActive,
        strongVisualBrand: form.strongVisualBrand,
      }),
    );
  }

  if (error) return <p className="mt-16 text-center text-rose-500">{error}</p>;
  if (!lead)
    return <div className="mx-auto mt-10 h-96 max-w-4xl animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />;

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/leads" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand-600">
        <RiArrowLeftLine /> All leads
      </Link>

      <motion.header
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-4 flex flex-wrap items-center justify-between gap-4"
      >
        <div className="flex items-center gap-4">
          <ScoreBadge score={lead.leadScore} />
          <div>
            <h1 className="font-heading text-2xl font-extrabold tracking-tight sm:text-3xl">{lead.businessName}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
              <span className="capitalize">{lead.category}</span>
              <span className="inline-flex items-center gap-1">
                <RiMapPin2Line /> {lead.city}
              </span>
              <StagePill stage={lead.pipelineStage} />
              <WebsiteTypeBadge type={lead.websiteType} />
              {lead.optedOut && (
                <span className="rounded-full bg-rose-500/15 px-2.5 py-1 text-[11px] font-bold text-rose-500">
                  DO NOT CONTACT
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" disabled={busy || lead.optedOut} onClick={() => act("Re-checked", () => api.recheck(id))}>
            <RiRefreshLine className="h-4 w-4" /> Re-check
          </button>
          {!lead.optedOut && (
            <button
              className="btn-ghost !text-rose-500 hover:!bg-rose-500/10"
              disabled={busy}
              onClick={() => act("Opted out & suppressed", () => api.optOut(id, "Manual opt-out from lead page"))}
            >
              <RiForbid2Line className="h-4 w-4" /> Opt out
            </button>
          )}
        </div>
      </motion.header>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Contact & signals */}
        <section className="glass-card space-y-4 p-6">
          <h2 className="font-heading text-lg font-bold">Contact & signals</h2>

          <div className="space-y-3 text-sm">
            <Row icon={<RiMailLine />} label="Email">
              <input className="input" value={form.email} placeholder="add email…" onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Row>
            <Row icon={<RiInstagramLine />} label="Instagram">
              <input
                className="input"
                value={form.instagramUsername}
                placeholder="username"
                onChange={(e) => setForm({ ...form, instagramUsername: e.target.value })}
              />
            </Row>
            {lead.phoneNormalized && (
              <Row icon={<RiWhatsappLine />} label="Phone">
                <span className="font-medium">
                  {lead.phoneNormalized} {lead.whatsappAvailable && <span className="text-emerald-500">· WhatsApp likely</span>}
                </span>
              </Row>
            )}
            {lead.websiteUrl && (
              <Row icon={<RiGlobalLine />} label="Website">
                <a href={lead.websiteUrl} className="font-medium text-brand-600 hover:underline" target="_blank" rel="noreferrer">
                  {lead.websiteUrl}
                </a>
              </Row>
            )}
          </div>

          <div className="flex flex-wrap gap-4 pt-1 text-sm">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand-600"
                checked={form.instagramActive}
                onChange={(e) => setForm({ ...form, instagramActive: e.target.checked })}
              />
              Active Instagram (+15)
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand-600"
                checked={form.strongVisualBrand}
                onChange={(e) => setForm({ ...form, strongVisualBrand: e.target.checked })}
              />
              Strong visual brand (+10)
            </label>
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea className="input min-h-20" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>

          <button onClick={saveDetails} disabled={busy} className="btn-primary">
            Save details
          </button>

          {lead.contactSources.length > 0 && (
            <div className="pt-2">
              <p className="label">Data provenance (NDPA)</p>
              <ul className="space-y-1 text-xs text-slate-400">
                {lead.contactSources.map((s, i) => (
                  <li key={i}>
                    {s.field}: {s.value}, from <b>{s.source}</b>
                    {s.sourceUrl ? ` (${shortUrl(s.sourceUrl)})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Outcome tracking */}
        <section className="glass-card space-y-4 p-6">
          <h2 className="font-heading text-lg font-bold">Outcome</h2>
          {lead.websiteProblemSummary && (
            <p className="rounded-xl bg-gradient-to-br from-brand-600/8 to-purple-600/8 p-3.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {lead.websiteProblemSummary}
            </p>
          )}
          <p className="text-sm text-slate-500">
            Status: <b className="text-slate-700 dark:text-slate-200">{lead.outreachStatus.replaceAll("_", " ")}</b>
            {lead.lastContactedAt && ` · last contacted ${new Date(lead.lastContactedAt).toLocaleDateString()}`}
            {lead.followUpAt && ` · follow-up ${new Date(lead.followUpAt).toLocaleDateString()}`}
          </p>

          {!lead.optedOut && (
            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost" disabled={busy} onClick={() => act("Recorded: interested", () => api.recordResponse(id, "POSITIVE"))}>
                <RiEmotionHappyLine className="h-4 w-4 text-emerald-500" /> Interested
              </button>
              <button className="btn-ghost" disabled={busy} onClick={() => act("Recorded: not interested", () => api.recordResponse(id, "NEGATIVE"))}>
                <RiEmotionUnhappyLine className="h-4 w-4 text-slate-400" /> Not interested
              </button>
              <button className="btn-ghost" disabled={busy} onClick={() => act("Recorded: bounced", () => api.recordResponse(id, "BOUNCED"))}>
                <RiMailCloseLine className="h-4 w-4 text-rose-400" /> Bounced
              </button>
              <button
                className="btn-cta"
                disabled={busy}
                onClick={() => {
                  const value = prompt("Deal value in ₦ (optional):");
                  const dealValue = value ? Number(value.replace(/[^\d.]/g, "")) : undefined;
                  void act("Converted", () => api.convert(id, dealValue));
                }}
              >
                <RiTrophyLine className="h-4 w-4" /> Won the deal
              </button>
            </div>
          )}

          <div>
            <p className="label">History</p>
            <ul className="max-h-72 space-y-2.5 overflow-y-auto pr-1 text-xs">
              {history.length === 0 && <li className="text-slate-400">No outreach activity yet.</li>}
              {history.map((h) => (
                <li key={h._id} className="rounded-xl border border-slate-200/70 bg-white/50 p-2.5 dark:border-slate-800 dark:bg-slate-900/50">
                  <p className="font-semibold text-slate-600 dark:text-slate-300">
                    {h.action.replaceAll("_", " ")} <span className="font-normal text-slate-400">· {h.channel}</span>
                  </p>
                  <p className="text-slate-400">{new Date(h.createdAt).toLocaleString()}</p>
                  {h.subject && <p className="mt-1 italic text-slate-500">“{h.subject}”</p>}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      {/* Pitch preview */}
      {lead.pitchMessage && (
        <section className="glass-card mt-6 p-6">
          <h2 className="font-heading text-lg font-bold">Current pitch</h2>
          {lead.pitchSubject && <p className="mt-3 text-sm font-semibold">Subject: {lead.pitchSubject}</p>}
          <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-100/70 p-4 font-body text-sm leading-relaxed dark:bg-slate-900/70">
            {lead.pitchMessage}
          </pre>
          {lead.pipelineStage === "PENDING_APPROVAL" && (
            <button className="btn-primary mt-4" onClick={() => router.push("/queue")}>
              Review in queue
            </button>
          )}
        </section>
      )}
    </div>
  );
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
        {children}
      </div>
    </div>
  );
}

function shortUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
