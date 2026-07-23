"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import {
  RiMailLine,
  RiInstagramLine,
  RiWhatsappLine,
  RiGlobalLine,
  RiMapPin2Line,
  RiCheckLine,
  RiCloseLine,
  RiFileCopyLine,
  RiExternalLinkLine,
  RiSendPlaneFill,
  RiSparkling2Line,
  RiLoader4Line,
  RiTimeLine,
  RiErrorWarningLine,
} from "react-icons/ri";
import { api } from "@/lib/api";
import type { Lead } from "@/lib/types";
import { ScoreBadge, WebsiteTypeBadge } from "./badges";

export function QueueCard({
  lead: initial,
  onDone,
  position,
  total,
}: {
  lead: Lead;
  onDone: (id: string) => void;
  position?: number;
  total?: number;
}) {
  const [lead, setLead] = useState(initial);
  const [subject, setSubject] = useState(initial.pitchSubject ?? "");
  const [message, setMessage] = useState(initial.pitchMessage ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const dirty = subject !== (lead.pitchSubject ?? "") || message !== (lead.pitchMessage ?? "");

  async function run<T>(label: string, fn: () => Promise<T>, after?: (result: T) => void) {
    setBusy(label);
    try {
      const result = await fn();
      after?.(result);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `${label} failed`);
    } finally {
      setBusy(null);
    }
  }

  async function saveIfDirty(): Promise<void> {
    if (!dirty) return;
    const { lead: updated } = await api.updateLead(lead._id, { pitchSubject: subject, pitchMessage: message });
    setLead(updated);
  }

  const approve = () =>
    run(
      "approve",
      async () => {
        await saveIfDirty();
        return api.approve(lead._id);
      },
      (result) => {
        if (result.draft?.draftId) toast.success("Approved. Draft created in Gmail.");
        else if (result.draft?.internal) toast.success(`Approved. Ready to send via ${result.draft.provider}.`);
        else if (result.draftError) toast.success(`Approved. ${result.draftError}`);
        else toast.success("Approved");
        setLead(result.lead);
        if (lead.outreachChannel !== "EMAIL") onDone(lead._id);
      },
    );

  const sendNow = () =>
    run("send", () => api.send(lead._id), () => {
      toast.success(`Sent to ${lead.email}`);
      onDone(lead._id);
    });

  const reject = () =>
    run("reject", () => api.reject(lead._id), () => {
      toast.success("Rejected");
      onDone(lead._id);
    });

  const regenerate = () =>
    run("regen", () => api.regeneratePitch(lead._id), (result) => {
      setLead(result.lead);
      setSubject(result.lead.pitchSubject ?? "");
      setMessage(result.lead.pitchMessage ?? "");
      toast.success("New pitch generated");
    });

  const markContacted = () =>
    run("contacted", () => api.markContacted(lead._id, "INSTAGRAM_MANUAL"), () => {
      toast.success("Marked as contacted");
      onDone(lead._id);
    });

  function copyMessage() {
    navigator.clipboard.writeText(message).then(
      () => toast.success("Message copied. Paste it in the DM."),
      () => toast.error("Copy failed"),
    );
  }

  const isApproved = lead.approval.status === "APPROVED";
  const emailChannel = lead.outreachChannel === "EMAIL" && Boolean(lead.email);
  const accent = lead.leadScore >= 70 ? "border-l-emerald-500" : lead.leadScore >= 50 ? "border-l-cta-500" : "border-l-slate-500";
  const issueCount = lead.websiteCheck?.issues?.length ?? 0;

  return (
    <article className={`queue-card glass-card overflow-hidden border-l-4 ${accent}`}>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 p-5 dark:border-slate-800">
        <div className="flex min-w-0 items-start gap-3.5">
          <ScoreBadge score={lead.leadScore} />
          <div className="min-w-0">
            {position && total && (
              <p className="mb-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-400">
                Review {position} of {total}
              </p>
            )}
            <h2 className="truncate font-heading text-xl font-extrabold tracking-tight">{lead.businessName}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <span className="capitalize">{lead.category}</span>
              <span className="inline-flex items-center gap-1">
                <RiMapPin2Line /> {lead.city}
              </span>
              <span className="font-bold text-slate-700 dark:text-slate-200">{lead.outreachChannel.replaceAll("_", " ")}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <WebsiteTypeBadge type={lead.websiteType} />
          {isApproved && <span className="status-badge text-emerald-600">Approved{lead.gmailDraftId ? " · draft ready" : ""}</span>}
        </div>
      </div>

      <div className="grid lg:grid-cols-12">
        <aside className="border-b border-slate-200 p-5 lg:col-span-4 lg:border-b-0 lg:border-r dark:border-slate-800">
          <div className="section-heading">
            <div>
              <h3 className="section-title">Lead intelligence</h3>
              <p className="section-description">Why the business qualified and how to reach it.</p>
            </div>
          </div>

          {lead.websiteProblemSummary && (
            <div className="border-l-4 border-brand-600 bg-slate-50 p-3.5 text-sm leading-relaxed text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
              {lead.websiteProblemSummary}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            {lead.email && <Chip icon={<RiMailLine />} text={lead.email} />}
            {lead.instagramUsername && (
              <a href={lead.instagramUrl} target="_blank" rel="noreferrer">
                <Chip icon={<RiInstagramLine />} text={`@${lead.instagramUsername}`} link />
              </a>
            )}
            {lead.whatsappAvailable && lead.phoneNormalized && <Chip icon={<RiWhatsappLine />} text={lead.phoneNormalized} />}
            {lead.websiteUrl && (
              <a href={lead.websiteUrl} target="_blank" rel="noreferrer">
                <Chip icon={<RiGlobalLine />} text={shortUrl(lead.websiteUrl)} link />
              </a>
            )}
          </div>

          <div className="mt-5 grid grid-cols-2 border border-slate-200 text-xs dark:border-slate-800">
            <AuditMetric label="HTTP" value={lead.websiteCheck?.httpStatus?.toString() ?? "—"} />
            <AuditMetric label="Response" value={lead.websiteCheck?.responseTimeMs ? `${lead.websiteCheck.responseTimeMs}ms` : "—"} />
            <AuditMetric label="Issues" value={issueCount.toString()} />
            <AuditMetric label="Contact attempts" value={lead.timesContacted.toString()} />
          </div>

          {lead.scoreBreakdown.length > 0 && (
            <div className="mt-5">
              <p className="label">Score breakdown</p>
              <ul className="divide-y divide-slate-200 border-y border-slate-200 text-xs dark:divide-slate-800 dark:border-slate-800">
                {lead.scoreBreakdown.map((item) => (
                  <li key={item.rule} className="flex justify-between gap-3 py-2">
                    <span className="text-slate-500 dark:text-slate-400">{item.rule}</span>
                    <span className={`font-extrabold tabular-nums ${item.points > 0 ? "text-emerald-600" : "text-rose-500"}`}>
                      {item.points > 0 ? `+${item.points}` : item.points}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {issueCount > 0 && (
            <div className="mt-5 border border-cta-500/40 bg-cta-500/5 p-3 text-xs text-slate-600 dark:text-slate-300">
              <p className="flex items-center gap-2 font-bold text-cta-600 dark:text-cta-400">
                <RiErrorWarningLine /> Website issues
              </p>
              <p className="mt-1 leading-relaxed">{lead.websiteCheck?.issues?.join(", ").toLowerCase().replaceAll("_", " ")}</p>
            </div>
          )}
        </aside>

        <section className="p-5 lg:col-span-8">
          <div className="section-heading">
            <div>
              <h3 className="section-title">Pitch review</h3>
              <p className="section-description">Edit the message before approval. Changes save automatically when approved.</p>
            </div>
            {lead.pitchModel && <span className="status-badge text-purple-600">AI · {lead.pitchModel}</span>}
          </div>

          <div className="space-y-4">
            {emailChannel && (
              <div>
                <label className="label" htmlFor={`subj-${lead._id}`}>
                  Subject
                </label>
                <input
                  id={`subj-${lead._id}`}
                  className="input font-semibold"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>
            )}
            <div>
              <label className="label" htmlFor={`msg-${lead._id}`}>
                {emailChannel ? "Email message" : "Instagram DM"}
              </label>
              <textarea
                id={`msg-${lead._id}`}
                className="input min-h-56 resize-y leading-relaxed"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                <span>{message.trim().split(/\s+/).filter(Boolean).length} words</span>
                {dirty && <span className="font-bold text-cta-500">Edited · saves on approval</span>}
              </div>
            </div>
          </div>

          <div className="queue-actions flex flex-wrap items-center gap-2">
            {!isApproved && (
              <button onClick={approve} disabled={busy !== null} className="btn-primary">
                {busy === "approve" ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : <RiCheckLine className="h-4 w-4" />}
                {busy === "approve" ? "Approving…" : "Approve"}
              </button>
            )}
            {isApproved && emailChannel && (
              <button onClick={sendNow} disabled={busy !== null} className="btn-cta">
                {busy === "send" ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : <RiSendPlaneFill className="h-4 w-4" />}
                {busy === "send" ? "Sending…" : "Send email"}
              </button>
            )}
            {!emailChannel && lead.instagramUrl && (
              <>
                <a href={lead.instagramUrl} target="_blank" rel="noreferrer" className="btn-primary">
                  <RiExternalLinkLine className="h-4 w-4" /> Open profile
                </a>
                <button onClick={copyMessage} className="btn-ghost">
                  <RiFileCopyLine className="h-4 w-4" /> Copy message
                </button>
                <button onClick={markContacted} disabled={busy !== null} className="btn-cta">
                  {busy === "contacted" ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : <RiCheckLine className="h-4 w-4" />}
                  {busy === "contacted" ? "Saving…" : "Mark contacted"}
                </button>
              </>
            )}
            <button onClick={regenerate} disabled={busy !== null} className="btn-ghost">
              {busy === "regen" ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : <RiSparkling2Line className="h-4 w-4" />}
              Regenerate
            </button>
            <button onClick={reject} disabled={busy !== null} className="btn-ghost !border-rose-300 !text-rose-500 hover:!bg-rose-500/10">
              {busy === "reject" ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : <RiCloseLine className="h-4 w-4" />}
              Reject
            </button>
            {lead.followUpAt && (
              <span className="ml-auto inline-flex items-center gap-1 text-xs text-slate-400">
                <RiTimeLine /> Follow-up {new Date(lead.followUpAt).toLocaleDateString("en-NG")}
              </span>
            )}
          </div>
        </section>
      </div>
    </article>
  );
}

function Chip({ icon, text, link }: { icon: React.ReactNode; text: string; link?: boolean }) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 border border-slate-300 bg-white px-2.5 py-1.5 font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 ${
        link ? "hover:border-brand-500 hover:text-brand-600" : ""
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{text}</span>
    </span>
  );
}

function AuditMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-r border-slate-200 p-3 last:border-r-0 dark:border-slate-800">
      <span className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-400">{label}</span>
      <span className="mt-1 block font-heading text-base font-extrabold tabular-nums">{value}</span>
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

export { RiTimeLine };
