"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { motion } from "framer-motion";
import {
  RiMailLine,
  RiInstagramLine,
  RiWhatsappLine,
  RiGlobalLine,
  RiMapPin2Line,
  RiCheckLine,
  RiCloseLine,
  RiRefreshLine,
  RiFileCopyLine,
  RiExternalLinkLine,
  RiSendPlaneFill,
  RiSparkling2Line,
} from "react-icons/ri";
import { api } from "@/lib/api";
import type { Lead } from "@/lib/types";
import { ScoreBadge, WebsiteTypeBadge } from "./badges";

export function QueueCard({ lead: initial, onDone }: { lead: Lead; onDone: (id: string) => void }) {
  const [lead, setLead] = useState(initial);
  const [subject, setSubject] = useState(initial.pitchSubject ?? "");
  const [message, setMessage] = useState(initial.pitchMessage ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const dirty = subject !== (lead.pitchSubject ?? "") || message !== (lead.pitchMessage ?? "");

  async function run<T>(label: string, fn: () => Promise<T>, after?: (r: T) => void) {
    setBusy(label);
    try {
      const r = await fn();
      after?.(r);
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
    run("approve", async () => {
      await saveIfDirty();
      return api.approve(lead._id);
    }, (r) => {
      if (r.draft?.draftId) toast.success("Approved. Draft created in your Gmail.");
      else if (r.draft?.internal) toast.success(`Approved. Ready to send via ${r.draft.provider}.`);
      else if (r.draftError) toast.success(`Approved. ${r.draftError}`);
      else toast.success("Approved");
      setLead(r.lead);
      if (lead.outreachChannel !== "EMAIL") onDone(lead._id);
    });

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
    run("regen", () => api.regeneratePitch(lead._id), (r) => {
      setLead(r.lead);
      setSubject(r.lead.pitchSubject ?? "");
      setMessage(r.lead.pitchMessage ?? "");
      toast.success("New pitch generated");
    });

  const markContacted = () =>
    run("contacted", () => api.markContacted(lead._id, "INSTAGRAM_MANUAL"), () => {
      toast.success("Marked as contacted");
      onDone(lead._id);
    });

  function copyMessage() {
    navigator.clipboard.writeText(message).then(
      () => toast.success("Message copied, paste it in the DM"),
      () => toast.error("Copy failed"),
    );
  }

  const isApproved = lead.approval.status === "APPROVED";
  const emailChannel = lead.outreachChannel === "EMAIL" && Boolean(lead.email);

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      className="glass-card overflow-hidden"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200/60 p-5 dark:border-slate-800/60">
        <div className="flex items-center gap-3.5">
          <ScoreBadge score={lead.leadScore} />
          <div>
            <h3 className="font-heading text-lg font-bold leading-tight">{lead.businessName}</h3>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="capitalize">{lead.category}</span>
              <span className="inline-flex items-center gap-0.5">
                <RiMapPin2Line /> {lead.city}
              </span>
              {lead.openingSoon && <span className="font-semibold text-cta-500">opening soon</span>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <WebsiteTypeBadge type={lead.websiteType} />
          {isApproved && (
            <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              approved{lead.gmailDraftId ? " · draft ready" : ""}
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-5">
        {/* Left: intel */}
        <div className="space-y-4 border-b border-slate-200/60 p-5 lg:col-span-2 lg:border-b-0 lg:border-r dark:border-slate-800/60">
          {lead.websiteProblemSummary && (
            <p className="rounded-xl bg-gradient-to-br from-brand-600/8 to-purple-600/8 p-3.5 text-sm leading-relaxed text-slate-600 dark:from-brand-500/10 dark:to-purple-500/10 dark:text-slate-300">
              {lead.websiteProblemSummary}
            </p>
          )}

          <div className="flex flex-wrap gap-2 text-xs">
            {lead.email && (
              <Chip icon={<RiMailLine />} text={lead.email} />
            )}
            {lead.instagramUsername && (
              <a href={lead.instagramUrl} target="_blank" rel="noreferrer">
                <Chip icon={<RiInstagramLine />} text={`@${lead.instagramUsername}`} link />
              </a>
            )}
            {lead.whatsappAvailable && lead.phoneNormalized && (
              <Chip icon={<RiWhatsappLine />} text={lead.phoneNormalized} />
            )}
            {lead.websiteUrl && (
              <a href={lead.websiteUrl} target="_blank" rel="noreferrer">
                <Chip icon={<RiGlobalLine />} text={shortUrl(lead.websiteUrl)} link />
              </a>
            )}
          </div>

          {lead.scoreBreakdown.length > 0 && (
            <div>
              <p className="label">Why this score</p>
              <ul className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
                {lead.scoreBreakdown.map((b) => (
                  <li key={b.rule} className="flex justify-between gap-2">
                    <span>{b.rule}</span>
                    <span className={`font-bold ${b.points > 0 ? "text-emerald-500" : "text-rose-500"}`}>
                      {b.points > 0 ? `+${b.points}` : b.points}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {lead.websiteCheck?.issues && lead.websiteCheck.issues.length > 0 && (
            <p className="text-xs text-slate-400">
              Site issues: {lead.websiteCheck.issues.join(", ").toLowerCase().replaceAll("_", " ")}
            </p>
          )}
        </div>

        {/* Right: pitch editor */}
        <div className="space-y-3 p-5 lg:col-span-3">
          {emailChannel && (
            <div>
              <label className="label" htmlFor={`subj-${lead._id}`}>
                Subject
              </label>
              <input
                id={`subj-${lead._id}`}
                className="input font-medium"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
          )}
          <div>
            <label className="label" htmlFor={`msg-${lead._id}`}>
              {emailChannel ? "Email message" : "Instagram DM"}
              {lead.pitchModel && (
                <span className="ml-2 normal-case tracking-normal text-slate-400">via {lead.pitchModel}</span>
              )}
            </label>
            <textarea
              id={`msg-${lead._id}`}
              className="input min-h-44 leading-relaxed"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {!isApproved && (
              <button onClick={approve} disabled={busy !== null} className="btn-primary">
                <RiCheckLine className="h-4 w-4" />
                {busy === "approve" ? "Approving…" : "Approve"}
              </button>
            )}
            {isApproved && emailChannel && (
              <button onClick={sendNow} disabled={busy !== null} className="btn-cta">
                <RiSendPlaneFill className="h-4 w-4" />
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
                  <RiWhatsappLine className="hidden" />
                  <RiCheckLine className="h-4 w-4" />
                  {busy === "contacted" ? "Saving…" : "Mark contacted"}
                </button>
              </>
            )}
            <button onClick={regenerate} disabled={busy !== null} className="btn-ghost">
              <RiSparkling2Line className={`h-4 w-4 ${busy === "regen" ? "animate-spin" : ""}`} />
              Regenerate
            </button>
            <button onClick={reject} disabled={busy !== null} className="btn-ghost !text-rose-500 hover:!bg-rose-500/10">
              <RiCloseLine className="h-4 w-4" /> Reject
            </button>
            {dirty && <span className="text-xs font-medium text-cta-500">edited, saved on approve</span>}
          </div>
        </div>
      </div>
    </motion.article>
  );
}

function Chip({ icon, text, link }: { icon: React.ReactNode; text: string; link?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/70 px-2.5 py-1.5 font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 ${
        link ? "transition hover:border-brand-500 hover:text-brand-600" : ""
      }`}
    >
      {icon}
      {text}
    </span>
  );
}

function shortUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// Re-export for the queue page refresh icon
export { RiRefreshLine };
