"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
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
  RiSaveLine,
  RiLoader4Line,
  RiExternalLinkLine,
  RiErrorWarningLine,
  RiTimeLine,
  RiArrowRightLine,
  RiCheckboxCircleFill,
} from "react-icons/ri";
import { api } from "@/lib/api";
import { isTemplatePitch } from "@/lib/pitch";
import type { Lead, OutreachLogEntry } from "@/lib/types";
import {
  IntelligenceScores,
  MaturityBadge,
  SourceBadge,
  StagePill,
  WebsiteTypeBadge,
} from "@/components/badges";

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [lead, setLead] = useState<Lead | null>(null);
  const [history, setHistory] = useState<OutreachLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({
    email: "",
    instagramUsername: "",
    notes: "",
    instagramActive: false,
    strongVisualBrand: false,
  });

  const load = useCallback(() => {
    let cancelled = false;
    api
      .lead(id)
      .then(({ lead: nextLead, history: nextHistory }) => {
        if (cancelled) return;
        setLead(nextLead);
        setHistory(nextHistory);
        setForm({
          email: nextLead.email ?? "",
          instagramUsername: nextLead.instagramUsername ?? "",
          notes: nextLead.notes ?? "",
          instagramActive: nextLead.instagramActive,
          strongVisualBrand: nextLead.strongVisualBrand,
        });
        setError(null);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(load, [load]);

  async function act(label: string, action: () => Promise<unknown>, successMessage: string) {
    setBusy(label);
    try {
      await action();
      toast.success(successMessage);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  async function saveDetails() {
    await act(
      "save",
      () =>
        api.updateLead(id, {
          email: form.email || null,
          instagramUsername: form.instagramUsername || null,
          notes: form.notes || null,
          instagramActive: form.instagramActive,
          strongVisualBrand: form.strongVisualBrand,
        }),
      "Lead details saved",
    );
  }

  const nextAction = useMemo(() => {
    if (!lead) return null;
    if (lead.optedOut) return { title: "No further contact", detail: "This lead is suppressed and must remain outside outreach.", href: "/suppression", action: "View suppression" };
    if (lead.outreachStatus === "CONVERTED") return { title: "Maintain the relationship", detail: "The deal is recorded as won. Keep delivery and account notes current.", href: null, action: null };
    if (lead.pipelineStage === "PENDING_APPROVAL") return { title: "Review the pitch", detail: "The lead is qualified and waiting for your approval decision.", href: "/queue", action: "Open approval queue" };
    if (lead.outreachStatus === "INTERESTED") return { title: "Move to commercial follow-up", detail: "The lead has shown interest and is ready for a proposal or sales conversation.", href: null, action: "Record deal outcome below" };
    if (lead.outreachStatus === "NOT_CONTACTED") return { title: "Prepare first outreach", detail: "Validate the contact details and route the lead into approval.", href: null, action: "Review contact signals" };
    return { title: "Monitor the next response", detail: lead.followUpAt ? `Follow-up is scheduled for ${new Date(lead.followUpAt).toLocaleDateString("en-NG")}.` : "Review outreach history and record the next response.", href: null, action: null };
  }, [lead]);

  if (error) {
    return (
      <div className="page-shell">
        <div className="empty-state mt-10">
          <div className="empty-state-icon text-rose-500"><RiErrorWarningLine /></div>
          <h1 className="mt-4 font-heading text-xl font-extrabold">Could not load this lead</h1>
          <p className="mt-2 text-sm text-rose-500">{error}</p>
        </div>
      </div>
    );
  }

  if (!lead || !nextAction) {
    return (
      <div className="page-shell">
        <div className="skeleton-block h-28" />
        <div className="mt-6 grid gap-6 xl:grid-cols-12">
          <div className="skeleton-block h-[34rem] xl:col-span-8" />
          <div className="skeleton-block h-[34rem] xl:col-span-4" />
        </div>
      </div>
    );
  }

  const issueCount = lead.websiteCheck?.issues?.length ?? 0;

  return (
    <div className="page-shell">
      <header className="page-header">
        <div className="min-w-0">
          <Link href="/leads" className="mb-3 inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-brand-600">
            <RiArrowLeftLine /> All leads
          </Link>
          <div className="flex min-w-0 flex-col items-start gap-4 sm:flex-row">
            <IntelligenceScores
              priority={lead.priorityScore}
              need={lead.needScore ?? lead.leadScore}
              reach={lead.reachScore}
            />
            <div className="min-w-0">
              <p className="page-kicker">Lead workspace</p>
              <h1 className="page-title truncate">{lead.businessName}</h1>
              <p className="page-subtitle flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="capitalize">{lead.category}</span>
                <span className="inline-flex items-center gap-1"><RiMapPin2Line /> {lead.city}</span>
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <StagePill stage={lead.pipelineStage} />
                <WebsiteTypeBadge type={lead.websiteType} />
                <MaturityBadge maturity={lead.maturity} newToGoogle={lead.newToGoogle} />
                <SourceBadge source={lead.discoverySource} />
                {lead.optedOut && <span className="status-badge border-rose-500 bg-rose-500/5 text-rose-500">Do not contact</span>}
              </div>
            </div>
          </div>
        </div>
        <div className="page-actions">
          <button
            className="btn-ghost"
            disabled={busy !== null || lead.optedOut}
            onClick={() => act("recheck", () => api.recheck(id), "Website re-checked")}
          >
            {busy === "recheck" ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : <RiRefreshLine className="h-4 w-4" />}
            Re-check
          </button>
          {!lead.optedOut && (
            <button
              className="btn-ghost !border-rose-300 !text-rose-500 hover:!bg-rose-500/10"
              disabled={busy !== null}
              onClick={() => act("optout", () => api.optOut(id, "Manual opt-out from lead page"), "Lead opted out and suppressed")}
            >
              {busy === "optout" ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : <RiForbid2Line className="h-4 w-4" />}
              Opt out
            </button>
          )}
        </div>
      </header>

      {/*
        Why this lead stopped moving, on the lead itself.
        The overview can say that some leads could not be processed, but the
        reason is per lead and was recorded and then never shown anywhere, so
        the only way to find out was to read the server log.
      */}
      {lead.lastProcessingError && (
        <div className="mt-6 border-l-4 border-rose-500 bg-rose-500/5 p-4" role="status">
          <p className="text-sm font-bold text-rose-600 dark:text-rose-400">
            {(lead.processingAttempts ?? 0) >= 3
              ? "This lead could not be processed, and is no longer retried automatically"
              : "The last attempt to process this lead failed"}
          </p>
          <p className="mt-1 break-words text-xs leading-relaxed text-slate-600 [overflow-wrap:anywhere] dark:text-slate-300">
            {lead.lastProcessingError}
          </p>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Re-check runs the whole audit again for this one lead, which is usually enough once the cause is fixed.
          </p>
        </div>
      )}

      <div className="mt-8 grid items-start gap-6 xl:grid-cols-12">
        <main className="space-y-6 xl:col-span-8">
          <section className="panel accent-brand border-t-4">
            <div className="section-heading">
              <div>
                <h2 className="section-title">Commercial intelligence</h2>
                <p className="section-description">
                  Need decides qualification. Reach only controls how high this lead appears in the work queue.
                </p>
              </div>
              <IntelligenceScores
                priority={lead.priorityScore}
                need={lead.needScore ?? lead.leadScore}
                reach={lead.reachScore}
                compact
              />
            </div>

            <div className="grid grid-cols-2 border border-slate-200 sm:grid-cols-4 dark:border-slate-800">
              <AuditMetric label="Maturity" value={(lead.maturity ?? "UNKNOWN").toLowerCase()} />
              <AuditMetric label="Rating" value={lead.rating != null ? `${lead.rating.toFixed(1)}★` : "—"} />
              <AuditMetric label="Reviews" value={(lead.userRatingCount ?? 0).toLocaleString()} />
              <AuditMetric label="Reviews/week" value={lead.ratingVelocity != null ? lead.ratingVelocity.toFixed(1) : "—"} />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {lead.newToGoogle && <span className="status-badge text-cyan-600">New to Google</span>}
              {lead.openingSoon && <span className="status-badge text-cta-500">Opening soon</span>}
              {(lead.ratingVelocity ?? 0) >= 2 && <span className="status-badge text-emerald-600">Rising review activity</span>}
              <SourceBadge source={lead.discoverySource} />
              {lead.firstSeenAt && (
                <span className="status-badge text-slate-500">
                  First seen {new Date(lead.firstSeenAt).toLocaleDateString("en-NG")}
                </span>
              )}
            </div>

            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <ScoreBreakdown
                title="Why they need the work"
                items={lead.needBreakdown?.length ? lead.needBreakdown : lead.scoreBreakdown ?? []}
              />
              <ScoreBreakdown title="How to reach them" items={lead.reachBreakdown ?? []} />
            </div>
          </section>

          <section className="panel accent-brand border-t-4">
            <div className="section-heading">
              <div>
                <h2 className="section-title">Contact and qualification signals</h2>
                <p className="section-description">Edit verified contact details and scoring inputs for this lead.</p>
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <Field icon={<RiMailLine />} label="Email">
                <input className="input" value={form.email} placeholder="Add email" onChange={(event) => setForm({ ...form, email: event.target.value })} />
                {/*
                  What the pipeline knows about this address, and why the field
                  may be empty. All three were carefully recorded during
                  enrichment and then shown nowhere, so a lead with an address
                  sitting in plain sight on its own website looked like one
                  nobody had bothered to look for, and an address that had
                  bounced looked like one that had never existed.
                */}
                <EmailProvenance lead={lead} />
              </Field>
              <Field icon={<RiInstagramLine />} label="Instagram">
                <input
                  className="input"
                  value={form.instagramUsername}
                  placeholder="Username"
                  onChange={(event) => setForm({ ...form, instagramUsername: event.target.value })}
                />
              </Field>
              {lead.phoneNormalized && (
                <Field icon={<RiWhatsappLine />} label="Phone">
                  <p className="min-h-11 border border-slate-300 px-3.5 py-2.5 text-sm font-semibold dark:border-slate-700">
                    {lead.phoneNormalized}
                    {lead.whatsappAvailable && <span className="ml-2 text-emerald-600">WhatsApp likely</span>}
                  </p>
                </Field>
              )}
              {lead.websiteUrl && (
                <Field icon={<RiGlobalLine />} label="Website">
                  <a href={lead.websiteUrl} target="_blank" rel="noreferrer" className="flex min-h-11 items-center justify-between border border-slate-300 px-3.5 py-2.5 text-sm font-bold text-brand-600 hover:bg-brand-500/5 dark:border-slate-700">
                    <span className="truncate">{shortUrl(lead.websiteUrl)}</span><RiExternalLinkLine />
                  </a>
                </Field>
              )}
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="flex cursor-pointer items-center gap-3 border border-slate-300 p-3 text-sm font-semibold dark:border-slate-700">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-brand-600"
                  checked={form.instagramActive}
                  onChange={(event) => setForm({ ...form, instagramActive: event.target.checked })}
                />
                <span>Active Instagram <span className="text-slate-400">improves reach</span></span>
              </label>
              <label className="flex cursor-pointer items-center gap-3 border border-slate-300 p-3 text-sm font-semibold dark:border-slate-700">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-brand-600"
                  checked={form.strongVisualBrand}
                  onChange={(event) => setForm({ ...form, strongVisualBrand: event.target.checked })}
                />
                <span>Strong visual brand <span className="text-slate-400">improves need</span></span>
              </label>
            </div>

            <div className="mt-5">
              <label className="label" htmlFor="lead-notes">Internal notes</label>
              <textarea id="lead-notes" className="input min-h-28 resize-y" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            </div>

            <button onClick={saveDetails} disabled={busy !== null} className="btn-primary mt-5">
              {busy === "save" ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : <RiSaveLine className="h-4 w-4" />}
              {busy === "save" ? "Saving…" : "Save details"}
            </button>
          </section>

          <section className="panel accent-cta border-t-4">
            <div className="section-heading">
              <div>
                <h2 className="section-title">Website audit</h2>
                <p className="section-description">Technical evidence supporting the sales angle and lead score.</p>
              </div>
              <WebsiteTypeBadge type={lead.websiteType} />
            </div>

            {lead.websiteProblemSummary && (
              <div className="border-l-4 border-cta-500 bg-cta-500/5 p-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                {lead.websiteProblemSummary}
              </div>
            )}

            <div className="mt-5 grid grid-cols-2 border border-slate-200 sm:grid-cols-4 dark:border-slate-800">
              <AuditMetric label="HTTP status" value={lead.websiteCheck?.httpStatus?.toString() ?? "—"} />
              <AuditMetric label="Response time" value={lead.websiteCheck?.responseTimeMs ? `${lead.websiteCheck.responseTimeMs}ms` : "—"} />
              <AuditMetric label="Issues found" value={issueCount.toString()} />
              <AuditMetric label="Platform" value={lead.websiteCheck?.platform ?? "Unknown"} />
            </div>

            {issueCount > 0 ? (
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {lead.websiteCheck?.issues?.map((issue) => (
                  <div key={issue} className="flex items-start gap-2 border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-600 dark:text-rose-400">
                    <RiErrorWarningLine className="mt-0.5 shrink-0" />
                    <span className="capitalize">{issue.replaceAll("_", " ").toLowerCase()}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-5 flex items-center gap-2 border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-600">
                <RiCheckboxCircleFill /> No website audit issues recorded.
              </div>
            )}
          </section>

          {lead.pitchMessage && (
            <section className="panel accent-purple border-t-4">
              <div className="section-heading">
                <div>
                  <h2 className="section-title">Current pitch</h2>
                  <p className="section-description">The latest generated outreach copy stored for this business.</p>
                </div>
                {isTemplatePitch(lead) ? (
                  <span className="status-badge text-amber-600">Built-in template</span>
                ) : (
                  lead.pitchModel && <span className="status-badge text-purple-600">{lead.pitchModel}</span>
                )}
              </div>
              {isTemplatePitch(lead) && (
                <p className="mb-4 break-words border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-700 [overflow-wrap:anywhere] dark:text-amber-400">
                  {lead.pitchFallbackReason
                    ? `The AI writer was unavailable, so this is the built-in template. It said: ${lead.pitchFallbackReason}`
                    : "Written before an AI provider was connected, so every business in this situation got the same words."}
                </p>
              )}
              {lead.pitchSubject && (
                <p className="border-b border-slate-200 pb-3 text-sm font-bold dark:border-slate-800">Subject: {lead.pitchSubject}</p>
              )}
              <pre className="mt-4 whitespace-pre-wrap border border-slate-200 bg-slate-50 p-4 font-body text-sm leading-relaxed dark:border-slate-800 dark:bg-slate-950">
                {lead.pitchMessage}
              </pre>
              {lead.pipelineStage === "PENDING_APPROVAL" && (
                <button className="btn-primary mt-4" onClick={() => router.push("/queue")}>
                  Review in approval queue <RiArrowRightLine />
                </button>
              )}
            </section>
          )}

          {lead.contactSources.length > 0 && (
            <section className="panel accent-slate border-t-4">
              <div className="section-heading">
                <div>
                  <h2 className="section-title">Data provenance</h2>
                  <p className="section-description">NDPA traceability for every contact field collected.</p>
                </div>
              </div>
              <div className="desktop-table table-shell !mt-0">
                <table className="data-table min-w-[620px]">
                  <thead><tr><th>Field</th><th>Value</th><th>Source</th><th>Collected</th></tr></thead>
                  <tbody>
                    {lead.contactSources.map((source, index) => (
                      <tr key={`${source.field}-${source.value}-${index}`}>
                        <td className="font-bold capitalize">{source.field}</td>
                        <td>{source.value}</td>
                        <td>
                          {source.sourceUrl ? (
                            <a href={source.sourceUrl} target="_blank" rel="noreferrer" className="font-semibold text-brand-600 hover:underline">{source.source}</a>
                          ) : source.source}
                        </td>
                        <td className="text-xs text-slate-400">{new Date(source.collectedAt).toLocaleDateString("en-NG")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mobile-record-list !mt-0">
                {lead.contactSources.map((source, index) => (
                  <article key={`${source.field}-${source.value}-${index}`} className="mobile-record">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="mobile-record-label">{source.field}</span>
                        <p className="break-all text-sm font-bold">{source.value}</p>
                      </div>
                      <span className="status-badge max-w-32 truncate text-slate-500">{source.source}</span>
                    </div>
                    <p className="mt-2 text-xs text-slate-400">
                      Collected {new Date(source.collectedAt).toLocaleDateString("en-NG")}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          )}
        </main>

        <aside className="space-y-6 xl:sticky xl:top-28 xl:col-span-4">
          <section className="panel accent-brand border-t-4">
            <p className="page-kicker">Recommended next action</p>
            <h2 className="font-heading text-xl font-extrabold">{nextAction.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{nextAction.detail}</p>
            {nextAction.href && (
              <Link href={nextAction.href} className="btn-primary mt-4 w-full">
                {nextAction.action} <RiArrowRightLine />
              </Link>
            )}
          </section>

          <section className="panel accent-emerald border-t-4">
            <div className="section-heading">
              <div>
                <h2 className="section-title">Outcome</h2>
                <p className="section-description">Record replies and commercial results.</p>
              </div>
            </div>
            <div className="border border-slate-200 p-3 text-sm dark:border-slate-800">
              <span className="mobile-record-label">Outreach status</span>
              <strong className="capitalize">{lead.outreachStatus.replaceAll("_", " ").toLowerCase()}</strong>
              {lead.lastContactedAt && <p className="mt-2 text-xs text-slate-400">Last contacted {new Date(lead.lastContactedAt).toLocaleDateString("en-NG")}</p>}
              {lead.followUpAt && <p className="mt-1 text-xs text-slate-400">Follow-up {new Date(lead.followUpAt).toLocaleDateString("en-NG")}</p>}
            </div>

            {!lead.optedOut && (
              <div className="mt-4 grid gap-2">
                <button className="btn-ghost justify-start" disabled={busy !== null} onClick={() => act("positive", () => api.recordResponse(id, "POSITIVE"), "Recorded as interested")}>
                  {busy === "positive" ? <RiLoader4Line className="animate-spin" /> : <RiEmotionHappyLine className="text-emerald-500" />} Interested
                </button>
                <button className="btn-ghost justify-start" disabled={busy !== null} onClick={() => act("negative", () => api.recordResponse(id, "NEGATIVE"), "Recorded as not interested")}>
                  {busy === "negative" ? <RiLoader4Line className="animate-spin" /> : <RiEmotionUnhappyLine className="text-slate-400" />} Not interested
                </button>
                <button className="btn-ghost justify-start" disabled={busy !== null} onClick={() => act("bounced", () => api.recordResponse(id, "BOUNCED"), "Recorded as bounced")}>
                  {busy === "bounced" ? <RiLoader4Line className="animate-spin" /> : <RiMailCloseLine className="text-rose-400" />} Bounced
                </button>
                <button
                  className="btn-primary justify-start"
                  disabled={busy !== null}
                  onClick={() => {
                    const value = prompt("Deal value in ₦ (optional):");
                    const dealValue = value ? Number(value.replace(/[^\d.]/g, "")) : undefined;
                    void act("convert", () => api.convert(id, dealValue), "Deal recorded as won");
                  }}
                >
                  {busy === "convert" ? <RiLoader4Line className="animate-spin" /> : <RiTrophyLine />} Won the deal
                </button>
              </div>
            )}
          </section>

          <section className="panel accent-purple border-t-4">
            <div className="section-heading">
              <div>
                <h2 className="section-title flex items-center gap-2"><RiTimeLine /> Activity timeline</h2>
                <p className="section-description">{history.length} outreach event{history.length === 1 ? "" : "s"}</p>
              </div>
            </div>
            {history.length === 0 ? (
              <p className="border border-dashed border-slate-300 p-5 text-center text-sm text-slate-400 dark:border-slate-700">No outreach activity yet.</p>
            ) : (
              <ol className="timeline max-h-[30rem] overflow-y-auto pr-2">
                {history.map((item) => (
                  <li key={item._id} className="timeline-item">
                    <p className="text-sm font-bold capitalize">{item.action.replaceAll("_", " ").toLowerCase()}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{item.channel} · {item.direction}</p>
                    <p className="mt-1 text-[11px] text-slate-400">{new Date(item.createdAt).toLocaleString("en-NG")}</p>
                    {item.subject && <p className="mt-2 border-l-2 border-slate-300 pl-2 text-xs italic text-slate-500">“{item.subject}”</p>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function Field({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label flex items-center gap-1.5">{icon} {label}</label>
      {children}
    </div>
  );
}

function AuditMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-r border-slate-200 p-3 last:border-r-0 dark:border-slate-800">
      <span className="mobile-record-label">{label}</span>
      <span className="block truncate font-heading text-base font-extrabold tabular-nums">{value}</span>
    </div>
  );
}

function ScoreBreakdown({
  title,
  items,
}: {
  title: string;
  items: Array<{ rule: string; points: number }>;
}) {
  return (
    <div>
      <p className="label">{title}</p>
      {items.length === 0 ? (
        <p className="border border-dashed border-slate-300 p-4 text-sm text-slate-400 dark:border-slate-700">
          No contributing signals recorded.
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 border-y border-slate-200 text-xs dark:divide-slate-800 dark:border-slate-800">
          {items.map((item) => (
            <li key={item.rule} className="flex justify-between gap-3 py-2">
              <span className="text-slate-500 dark:text-slate-400">{item.rule}</span>
              <strong className={`tabular-nums ${item.points >= 0 ? "text-emerald-600" : "text-rose-500"}`}>
                {item.points > 0 ? `+${item.points}` : item.points}
              </strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Confidence in the stored address, and every address ruled out so far. */
function EmailProvenance({ lead }: { lead: Lead }) {
  const bounced = lead.bouncedEmails ?? [];
  const rejected = lead.rejectedEmails ?? [];
  const hasAssessment = Boolean(lead.email && lead.emailAssessment);
  if (!hasAssessment && bounced.length === 0 && rejected.length === 0) return null;

  return (
    <div className="mt-2 space-y-2 text-xs">
      {hasAssessment && (
        <p className="break-words text-slate-500 [overflow-wrap:anywhere] dark:text-slate-400">
          {typeof lead.emailConfidence === "number" && (
            <span
              className={`mr-1.5 font-extrabold tabular-nums ${
                lead.emailConfidence >= 70
                  ? "text-emerald-600"
                  : lead.emailConfidence >= 40
                    ? "text-amber-600"
                    : "text-rose-500"
              }`}
            >
              {lead.emailConfidence}%
            </span>
          )}
          {lead.emailAssessment}
        </p>
      )}

      {bounced.length > 0 && (
        <p className="break-words border-l-2 border-rose-400 pl-2 text-rose-600 [overflow-wrap:anywhere] dark:text-rose-400">
          {bounced.length === 1 ? "Bounced, so no longer used:" : "Bounced, so no longer used:"}{" "}
          <span className="font-semibold">{bounced.join(", ")}</span>
        </p>
      )}

      {rejected.length > 0 && (
        <details className="text-slate-500 dark:text-slate-400">
          <summary className="cursor-pointer font-semibold">
            {rejected.length} address{rejected.length === 1 ? "" : "es"} on the site were not used
          </summary>
          <ul className="mt-1.5 space-y-1">
            {rejected.map((entry) => (
              <li key={entry.value} className="break-words [overflow-wrap:anywhere]">
                <span className="font-semibold">{entry.value}</span> — {entry.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
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
