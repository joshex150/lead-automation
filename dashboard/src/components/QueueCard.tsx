"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import {
  RiMailLine,
  RiInstagramLine,
  RiWhatsappLine,
  RiPhoneLine,
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
  RiArrowDownSLine,
  RiGroupLine,
} from "react-icons/ri";
import { api } from "@/lib/api";
import type { Lead } from "@/lib/types";
import { CHANNEL_LABELS, MESSAGE_LABELS, contactRoutes, whatsappLink, whatsappNumber } from "@/lib/contacts";
import { IntelligenceScores, MaturityBadge, SourceBadge, WebsiteTypeBadge } from "./badges";

export function QueueCard({
  lead: initial,
  onDone,
  position,
  total,
  open,
  onToggle,
}: {
  lead: Lead;
  onDone: (id: string) => void;
  position?: number;
  total?: number;
  /** Controlled by the page so it can expand or collapse the whole list. */
  open: boolean;
  onToggle: (id: string) => void;
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

  const channel = lead.outreachChannel;
  const emailChannel = channel === "EMAIL" && Boolean(lead.email);
  const routes = contactRoutes(lead);
  const waNumber = whatsappNumber(lead);

  /*
   * Approving records the decision. It does not finish the lead.
   *
   * This used to call onDone for anything that was not an email lead, which
   * dropped the card the moment the decision was made, while the outreach it
   * had just authorised had not happened yet: an Instagram lead was approved
   * and then had nowhere to be messaged from. The card now stays until the work
   * is genuinely done, which is Send for email and Mark contacted for the
   * manual channels, and the server keeps it in the queue for the same reason.
   */
  const approve = () =>
    run(
      "approve",
      async () => {
        await saveIfDirty();
        return api.approve(lead._id);
      },
      (result) => {
        if (result.draft?.draftId) toast.success("Approved. Draft created in Gmail, ready to send.");
        else if (result.draft?.internal) toast.success(`Approved. Ready to send via ${result.draft.provider}.`);
        else if (result.draftError) toast.success(`Approved. ${result.draftError}`);
        else if (emailChannel) toast.success("Approved. Press Send email to dispatch it.");
        else toast.success(`Approved. Send the message, then press "Mark contacted".`);
        setLead(result.lead);
        setSubject(result.lead.pitchSubject ?? subject);
        setMessage(result.lead.pitchMessage ?? message);
        // Approving is the moment the card becomes a send instruction, so it
        // opens itself if the operator had it shut.
        if (!open) onToggle(lead._id);
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
      if (result.pitch.fallbackReason) {
        // The reason, in the toast as well as on the card. Without it the only
        // feedback from pressing Regenerate was that it had not worked.
        toast.error(`Could not write a new message: ${result.pitch.fallbackReason}`, { duration: 9000 });
      } else {
        toast.success(`New pitch written for this business with ${result.pitch.provider}.`);
      }
    });

  const markContacted = (via: "INSTAGRAM_MANUAL" | "WHATSAPP") =>
    run("contacted", () => api.markContacted(lead._id, via), () => {
      toast.success("Marked as contacted");
      onDone(lead._id);
    });

  function copyMessage() {
    navigator.clipboard.writeText(message).then(
      () => toast.success("Message copied."),
      () => toast.error("Copy failed"),
    );
  }

  const isApproved = lead.approval.status === "APPROVED";
  const priority = lead.priorityScore ?? Math.round((lead.needScore ?? lead.leadScore) * 0.75 + (lead.reachScore ?? 0) * 0.25);
  const accent = priority >= 70 ? "border-l-emerald-500" : priority >= 50 ? "border-l-brand-500" : "border-l-slate-500";
  const issueCount = lead.websiteCheck?.issues?.length ?? 0;
  const bodyId = `queue-body-${lead._id}`;

  return (
    <article className={`queue-card glass-card w-full min-w-0 max-w-full overflow-hidden border-l-4 ${accent}`}>
      <div className="queue-card-header flex min-w-0 flex-col items-start gap-4 border-b border-slate-200 p-4 sm:flex-row sm:flex-wrap sm:justify-between sm:p-5 dark:border-slate-800">
        <div className="queue-card-identity flex w-full min-w-0 flex-col items-start gap-3.5 sm:w-auto sm:flex-1 sm:flex-row">
          <div className="queue-score-wrap w-full min-w-0 sm:w-auto">
            <IntelligenceScores priority={priority} need={lead.needScore ?? lead.leadScore} reach={lead.reachScore} />
          </div>
          <div className="w-full min-w-0 sm:w-auto">
            {position && total && (
              <p className="mb-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-400">
                Review {position} of {total}
              </p>
            )}
            {/*
              The whole heading is the toggle. A separate chevron would be a
              small target on a phone, and the title is the thing an operator
              reaches for when scanning a long queue.
            */}
            <button
              type="button"
              onClick={() => onToggle(lead._id)}
              aria-expanded={open}
              aria-controls={bodyId}
              className="queue-card-toggle flex w-full min-w-0 items-start gap-2 text-left"
            >
              <RiArrowDownSLine
                className={`mt-1 h-5 w-5 shrink-0 text-slate-400 transition-transform duration-theme ease-theme ${open ? "" : "-rotate-90"}`}
                aria-hidden
              />
              <h2 className="min-w-0 break-words font-heading text-xl font-extrabold tracking-tight">{lead.businessName}</h2>
            </button>
            <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 pl-7 text-xs text-slate-500 dark:text-slate-400">
              <span className="min-w-0 break-words capitalize">{lead.category}</span>
              <span className="inline-flex min-w-0 items-center gap-1 break-words">
                <RiMapPin2Line className="shrink-0" /> {lead.city}
              </span>
            </p>
            {/*
              Contact routes are shown whether the card is open or shut, and on
              every lead. Which routes exist is the first thing that decides
              whether a lead is workable at all, so it does not belong behind a
              disclosure.
            */}
            <div className="mt-2 pl-7">
              <ContactRoutes lead={lead} routes={routes} />
            </div>
          </div>
        </div>
        <div className="queue-card-badges flex w-full min-w-0 flex-wrap items-center justify-start gap-2 sm:w-auto sm:max-w-full sm:justify-end">
          <WebsiteTypeBadge type={lead.websiteType} />
          <MaturityBadge maturity={lead.maturity} newToGoogle={lead.newToGoogle} />
          <SourceBadge source={lead.discoverySource} />
          {isApproved && (
            <span className="status-badge text-emerald-600">
              {emailChannel
                ? lead.gmailDraftId
                  ? "Approved · draft ready to send"
                  : "Approved · ready to send"
                : "Approved · waiting to be sent"}
            </span>
          )}
        </div>
      </div>

      {open && (
        <div id={bodyId} className="queue-card-body grid min-w-0 lg:grid-cols-12">
          <aside className="min-w-0 overflow-hidden border-b border-slate-200 p-4 sm:p-5 lg:col-span-4 lg:border-b-0 lg:border-r dark:border-slate-800">
            <div className="section-heading">
              <div>
                <h3 className="section-title">Lead intelligence</h3>
                <p className="section-description">Why the business qualified and how to reach it.</p>
              </div>
            </div>

            {lead.websiteProblemSummary && (
              <div className="break-words border-l-4 border-brand-600 bg-slate-50 p-3.5 text-sm leading-relaxed text-slate-600 [overflow-wrap:anywhere] dark:bg-slate-800/60 dark:text-slate-300">
                {lead.websiteProblemSummary}
              </div>
            )}

            <div className="queue-contact-chips mt-4 flex min-w-0 flex-wrap gap-2 text-xs">
              {lead.email && <Chip icon={<RiMailLine />} text={lead.email} />}
              {lead.instagramUsername && (
                <a href={lead.instagramUrl} target="_blank" rel="noreferrer" className="min-w-0 max-w-full">
                  <Chip icon={<RiInstagramLine />} text={`@${lead.instagramUsername}`} link />
                </a>
              )}
              {waNumber && <Chip icon={<RiWhatsappLine />} text={waNumber} />}
              {!waNumber && lead.phone && <Chip icon={<RiPhoneLine />} text={lead.phone} />}
              {lead.websiteUrl && (
                <a href={lead.websiteUrl} target="_blank" rel="noreferrer" className="min-w-0 max-w-full">
                  <Chip icon={<RiGlobalLine />} text={shortUrl(lead.websiteUrl)} link />
                </a>
              )}
            </div>

            <div className="mt-5 grid grid-cols-2 border border-slate-200 text-xs dark:border-slate-800">
              <AuditMetric label="HTTP" value={lead.websiteCheck?.httpStatus?.toString() ?? "—"} />
              <AuditMetric label="Response" value={lead.websiteCheck?.responseTimeMs ? `${lead.websiteCheck.responseTimeMs}ms` : "—"} />
              <AuditMetric label="Reviews" value={(lead.userRatingCount ?? 0).toString()} />
              <AuditMetric label="Growth/week" value={lead.ratingVelocity != null ? lead.ratingVelocity.toFixed(1) : "—"} />
            </div>

            {(lead.needBreakdown?.length ?? 0) > 0 && (
              <div className="mt-5">
                <p className="label">Why this lead needs the work</p>
                <ul className="divide-y divide-slate-200 border-y border-slate-200 text-xs dark:divide-slate-800 dark:border-slate-800">
                  {lead.needBreakdown.map((item) => (
                    <li key={item.rule} className="flex min-w-0 justify-between gap-3 py-2">
                      <span className="min-w-0 break-words text-slate-500 [overflow-wrap:anywhere] dark:text-slate-400">{item.rule}</span>
                      <span className={`shrink-0 font-extrabold tabular-nums ${item.points > 0 ? "text-emerald-600" : "text-rose-500"}`}>
                        {item.points > 0 ? `+${item.points}` : item.points}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(lead.reachBreakdown?.length ?? 0) > 0 && (
              <div className="mt-5">
                <p className="label">How to reach them</p>
                <ul className="divide-y divide-slate-200 border-y border-slate-200 text-xs dark:divide-slate-800 dark:border-slate-800">
                  {lead.reachBreakdown.map((item) => (
                    <li key={item.rule} className="flex min-w-0 justify-between gap-3 py-2">
                      <span className="min-w-0 break-words text-slate-500 [overflow-wrap:anywhere] dark:text-slate-400">{item.rule}</span>
                      <span className="shrink-0 font-extrabold tabular-nums text-brand-600">+{item.points}</span>
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
                <p className="mt-1 break-words leading-relaxed [overflow-wrap:anywhere]">
                  {lead.websiteCheck?.issues?.join(", ").toLowerCase().replaceAll("_", " ")}
                </p>
              </div>
            )}
          </aside>

          <section className="min-w-0 overflow-hidden p-4 sm:p-5 lg:col-span-8">
            <div className="section-heading">
              <div>
                <h3 className="section-title">Pitch review</h3>
                <p className="section-description">Edit the message before approval. Changes save automatically when approved.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {lead.pitchShared && (
                  <span className="status-badge text-slate-500" title="Written once for every business in this situation, with the name and city filled in per lead. Regenerate writes this one its own.">
                    <RiGroupLine className="mr-1 h-3.5 w-3.5" /> Shared message
                  </span>
                )}
                {lead.pitchFallbackReason ? (
                  <span className="status-badge text-amber-600">Template fallback</span>
                ) : (
                  lead.pitchModel && <span className="status-badge text-purple-600">AI · {lead.pitchModel}</span>
                )}
              </div>
            </div>

            {/*
              The actual reason, not a paraphrase of it.
              This said "the AI provider was unavailable, regenerate it after
              the provider recovers" whatever had happened, so an operator whose
              key was wrong, whose model name did not exist, or who was over
              their quota was told to wait for a recovery that was never going
              to come, and pressing Regenerate produced the same sentence again.
              The provider's own words are the only thing that says which it is.
            */}
            {lead.pitchFallbackReason && (
              <div className="mb-4 break-words border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-700 [overflow-wrap:anywhere] dark:text-amber-400">
                <p className="font-bold">This lead has the built-in template message, not an AI-written one.</p>
                <p className="mt-1">
                  The writer said: <span className="font-semibold">{lead.pitchFallbackReason}</span>
                </p>
                <p className="mt-1.5 opacity-90">{fallbackAdvice(lead.pitchFallbackReason)}</p>
              </div>
            )}

            {/*
              The one step left, said outright. An approved lead is half-done
              work, and the difference between that and finished is the single
              most expensive thing to get wrong here: a pitch nobody sent.
            */}
            {isApproved && (
              <p className="mb-4 break-words border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs leading-relaxed text-emerald-700 [overflow-wrap:anywhere] dark:text-emerald-400">
                {emailChannel
                  ? "Approved. Nothing has been sent yet: press Send email below to dispatch it. This lead stays here until you do."
                  : `Approved. Open ${CHANNEL_LABELS[channel]}, send the message, then press "Mark contacted". This lead stays here until you do.`}
              </p>
            )}

            {channel === "NONE" && (
              <p className="mb-4 break-words border border-rose-500/30 bg-rose-500/5 p-3 text-xs leading-relaxed text-rose-600 [overflow-wrap:anywhere] dark:text-rose-400">
                {/*
                  An address that bounced is not an address that was never
                  found, and telling the operator to go looking for one they
                  already have sends them round the same loop again.
                */}
                {(lead.bouncedEmails?.length ?? 0) > 0
                  ? `The only address we had for this business bounced (${lead.bouncedEmails?.join(", ")}), and there is no handle or mobile number either, so there is nowhere to send this message. Add a working contact on the lead page, or open it on Google Maps and check its listing.`
                  : "No email, Instagram handle or mobile number was found for this business, so there is nowhere to send this message yet. Add a contact on the lead page, or open it on Google Maps and check its listing."}
              </p>
            )}

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
                  {MESSAGE_LABELS[channel]}
                </label>
                <textarea
                  id={`msg-${lead._id}`}
                  className="input min-h-56 min-w-0 max-w-full resize-y leading-relaxed"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                  <span>{message.trim().split(/\s+/).filter(Boolean).length} words</span>
                  {dirty && <span className="font-bold text-brand-600">Edited · saves on approval</span>}
                </div>
              </div>
            </div>

            <div className="queue-actions flex flex-wrap items-center gap-2">
              {/*
                Nothing to approve when there is nowhere to send it. Approving a
                lead with no route recorded a decision that authorised an
                outreach that could never happen, and the lead then sat in the
                queue in a state with no next step at all. Add a contact on the
                lead page and it comes back as ordinary work.
              */}
              {!isApproved && channel !== "NONE" && (
                <button onClick={approve} disabled={busy !== null} className="btn-primary">
                  {busy === "approve" ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : <RiCheckLine className="h-4 w-4" />}
                  {busy === "approve" ? "Approving…" : "Approve"}
                </button>
              )}
              {isApproved && emailChannel && (
                <button onClick={sendNow} disabled={busy !== null} className="btn-primary">
                  {busy === "send" ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : <RiSendPlaneFill className="h-4 w-4" />}
                  {busy === "send" ? "Sending…" : "Send email"}
                </button>
              )}

              {channel === "INSTAGRAM_MANUAL" && lead.instagramUrl && (
                <>
                  <a href={lead.instagramUrl} target="_blank" rel="noreferrer" className="btn-ghost">
                    <RiExternalLinkLine className="h-4 w-4" /> Open profile
                  </a>
                  <button onClick={copyMessage} className="btn-ghost">
                    <RiFileCopyLine className="h-4 w-4" /> Copy message
                  </button>
                  <button onClick={() => markContacted("INSTAGRAM_MANUAL")} disabled={busy !== null} className="btn-ghost">
                    {busy === "contacted" ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : <RiCheckLine className="h-4 w-4" />}
                    {busy === "contacted" ? "Saving…" : "Mark contacted"}
                  </button>
                </>
              )}

              {channel === "WHATSAPP" && waNumber && (
                <>
                  {/* wa.me carries the message, so the operator only presses send. */}
                  <a href={whatsappLink(lead, message) ?? "#"} target="_blank" rel="noreferrer" className="btn-ghost">
                    <RiWhatsappLine className="h-4 w-4" /> Open WhatsApp
                  </a>
                  <button onClick={copyMessage} className="btn-ghost">
                    <RiFileCopyLine className="h-4 w-4" /> Copy message
                  </button>
                  <button onClick={() => markContacted("WHATSAPP")} disabled={busy !== null} className="btn-ghost">
                    {busy === "contacted" ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : <RiCheckLine className="h-4 w-4" />}
                    {busy === "contacted" ? "Saving…" : "Mark contacted"}
                  </button>
                </>
              )}

              {channel === "NONE" && lead.googleMapsUrl && (
                <a href={lead.googleMapsUrl} target="_blank" rel="noreferrer" className="btn-ghost">
                  <RiExternalLinkLine className="h-4 w-4" /> Open on Google Maps
                </a>
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
                <span className="queue-follow-up ml-auto inline-flex min-w-0 items-center gap-1 break-words text-xs text-slate-400">
                  <RiTimeLine className="shrink-0" /> Follow-up {new Date(lead.followUpAt).toLocaleDateString("en-NG")}
                </span>
              )}
            </div>
          </section>
        </div>
      )}
    </article>
  );
}

/**
 * What to do about it, read off what the provider actually said.
 *
 * Every one of these has a different answer, and the old wording gave the same
 * one to all of them. A wrong key never recovers on its own; a rate limit
 * always does.
 */
function fallbackAdvice(reason: string): string {
  const text = reason.toLowerCase();
  if (/\b401\b|unauthor|invalid[_ ]?api[_ ]?key|authentication/.test(text)) {
    return "That reads as a rejected API key. Check the key in Settings, then use Test to confirm it before regenerating.";
  }
  if (/\b404\b|model.*not.*(found|exist)|unknown model|does not exist/.test(text)) {
    return "That reads as a model name the provider does not recognise. Correct the model in Settings, then use Test.";
  }
  if (/\b429\b|rate.?limit|quota|insufficient[_ ]?quota|billing/.test(text)) {
    return "That is a rate or quota limit. It clears on its own, unless it is a billing limit, in which case it will not.";
  }
  if (/unsupported|unrecognized|not supported|invalid.*parameter/.test(text)) {
    return "The provider rejected one of the request's settings. This usually means the model expects different parameters; check the model name in Settings.";
  }
  if (/json|parse|empty response/.test(text)) {
    return "The provider answered but the reply could not be read as a message. Regenerating often works; a different model is the fix if it keeps happening.";
  }
  if (/timeout|timed out|aborted|fetch failed|network|enotfound|econnrefused/.test(text)) {
    return "That is a connection problem rather than a rejection. Regenerating usually works once the provider or the network settles.";
  }
  return "Regenerate to try again. If the same thing comes back, the answer is in Settings under the AI provider.";
}

const ROUTE_ICONS = {
  EMAIL: RiMailLine,
  INSTAGRAM: RiInstagramLine,
  WHATSAPP: RiWhatsappLine,
  PHONE: RiPhoneLine,
} as const;

const ROUTE_LABELS = {
  EMAIL: "Email",
  INSTAGRAM: "Instagram",
  WHATSAPP: "WhatsApp",
  PHONE: "Phone",
} as const;

/** Every route into the business, with the one outreach will use marked. */
function ContactRoutes({ lead, routes }: { lead: Lead; routes: ReturnType<typeof contactRoutes> }) {
  if (routes.length === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 border border-rose-300 px-2 py-1 text-[11px] font-bold text-rose-500 dark:border-rose-500/40">
        <RiErrorWarningLine className="h-3.5 w-3.5 shrink-0" /> No contact route
      </span>
    );
  }

  const using: Record<Lead["outreachChannel"], string | null> = {
    EMAIL: "EMAIL",
    INSTAGRAM_MANUAL: "INSTAGRAM",
    WHATSAPP: "WHATSAPP",
    NONE: null,
  };

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
      {routes.map((route) => {
        const Icon = ROUTE_ICONS[route];
        const active = using[lead.outreachChannel] === route;
        return (
          <span
            key={route}
            title={active ? `Outreach will use ${CHANNEL_LABELS[lead.outreachChannel]}` : ROUTE_LABELS[route]}
            className={`inline-flex items-center gap-1 border px-2 py-1 text-[11px] font-bold ${
              active
                ? "border-brand-600 bg-brand-500/10 text-brand-700 dark:text-brand-400"
                : "border-slate-300 text-slate-500 dark:border-slate-700 dark:text-slate-400"
            }`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {ROUTE_LABELS[route]}
            {active && <RiCheckLine className="h-3 w-3 shrink-0" aria-hidden />}
          </span>
        );
      })}
    </span>
  );
}

function Chip({ icon, text, link }: { icon: React.ReactNode; text: string; link?: boolean }) {
  return (
    <span
      className={`inline-flex min-w-0 max-w-full items-center gap-1.5 border border-slate-300 bg-white px-2.5 py-1.5 font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 ${
        link ? "hover:border-brand-500 hover:text-brand-600" : ""
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 truncate">{text}</span>
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
