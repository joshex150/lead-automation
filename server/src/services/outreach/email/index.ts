import { getEmailRuntime, type ResolvedEmail } from "../../../config/runtime.js";
import { logger } from "../../../utils/logger.js";
import { OutreachLog } from "../../../models/OutreachLog.js";
import type { LeadDocument } from "../../../models/Lead.js";
import type { DraftResult, EmailProviderAdapter, SendResult } from "./types.js";
import { GmailProvider } from "./gmailProvider.js";
import { ZohoProvider } from "./zohoProvider.js";
import { ResendProvider } from "./resendProvider.js";

/**
 * Provider registry + lead-level email operations. Every outgoing email
 * carries a polite decline line (NDPA right-to-object), non-negotiable.
 */

export const COMPLIANCE_FOOTER =
  "\n\n--\nYEAN Technologies, custom websites for Nigerian businesses\n" +
  "We found your business through its public listing. " +
  "If you'd rather not hear from us again, just reply \"unsubscribe\" and we won't contact you further.";

let testOverride: { provider: EmailProviderAdapter; runtime: ResolvedEmail } | null = null;

/** Test hook: force a specific provider (pass null to clear). */
export function _setEmailProviderForTests(provider: EmailProviderAdapter | null, runtime?: ResolvedEmail): void {
  testOverride = provider && runtime ? { provider, runtime } : null;
}

export interface ActiveEmail {
  provider: EmailProviderAdapter | null;
  runtime: ResolvedEmail;
}

/** Resolves the active provider from settings (DB > env). Never throws. */
export async function getActiveEmail(): Promise<ActiveEmail> {
  if (testOverride) return testOverride;
  const runtime = await getEmailRuntime();
  if (!runtime.configured) return { provider: null, runtime };
  try {
    switch (runtime.provider) {
      case "gmail":
        return { provider: new GmailProvider(runtime), runtime };
      case "zoho":
        return { provider: new ZohoProvider(runtime), runtime };
      case "resend":
        return { provider: new ResendProvider(runtime), runtime };
      default:
        return { provider: null, runtime };
    }
  } catch (err) {
    logger.error({ err: String(err), provider: runtime.provider }, "email provider construction failed");
    return { provider: null, runtime };
  }
}

function guardLead(lead: LeadDocument): void {
  if (!lead.email) throw new Error(`Lead ${lead.businessName} has no email address`);
  if (!lead.pitchSubject || !lead.pitchMessage) throw new Error(`Lead ${lead.businessName} has no pitch yet`);
  if (lead.optedOut) throw new Error(`Lead ${lead.businessName} has opted out`);
}

/**
 * Approval step. Gmail: creates a real draft in the mailbox. Other
 * providers: records an internal "ready to send" draft (the message content
 * already lives on the lead). Returns null draftId for internal drafts.
 */
export async function createDraftForLead(
  lead: LeadDocument,
): Promise<{ draftId: string | null; provider: string; internal: boolean }> {
  guardLead(lead);
  const { provider, runtime } = await getActiveEmail();
  if (!provider) throw new Error("No email provider is configured");

  if (provider.supportsDrafts && provider.createDraft) {
    const draft: DraftResult = await provider.createDraft({
      to: lead.email!,
      subject: lead.pitchSubject!,
      body: lead.pitchMessage! + COMPLIANCE_FOOTER,
      fromAddress: runtime.fromAddress,
      fromName: runtime.fromName,
    });
    await OutreachLog.create({
      leadId: lead._id,
      channel: "EMAIL",
      direction: "OUTBOUND",
      action: "DRAFT_CREATED",
      subject: lead.pitchSubject,
      message: lead.pitchMessage,
      meta: { draftId: draft.draftId, provider: provider.name },
    });
    logger.info({ lead: lead.businessName, draftId: draft.draftId, provider: provider.name }, "draft created");
    return { draftId: draft.draftId, provider: provider.name, internal: false };
  }

  // Draft-less providers: the approved pitch on the lead IS the draft.
  await OutreachLog.create({
    leadId: lead._id,
    channel: "EMAIL",
    direction: "OUTBOUND",
    action: "DRAFT_CREATED",
    subject: lead.pitchSubject,
    message: lead.pitchMessage,
    meta: { provider: provider.name, internal: true },
  });
  return { draftId: null, provider: provider.name, internal: true };
}

/** Sends the approved pitch (via stored provider draft when one exists). */
export async function sendPitchForLead(lead: LeadDocument): Promise<SendResult & { provider: string }> {
  guardLead(lead);
  const { provider, runtime } = await getActiveEmail();
  if (!provider) throw new Error("No email provider is configured");

  let result: SendResult;
  if (lead.gmailDraftId && provider.supportsDrafts && provider.sendDraft) {
    result = await provider.sendDraft(lead.gmailDraftId);
  } else {
    result = await provider.send({
      to: lead.email!,
      subject: lead.pitchSubject!,
      body: lead.pitchMessage! + COMPLIANCE_FOOTER,
      fromAddress: runtime.fromAddress,
      fromName: runtime.fromName,
    });
  }
  return { ...result, provider: provider.name };
}

/** Sends an arbitrary email (follow-ups). Footer appended here. */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
}): Promise<SendResult & { provider: string }> {
  const { provider, runtime } = await getActiveEmail();
  if (!provider) throw new Error("No email provider is configured");
  const result = await provider.send({
    to: opts.to,
    subject: opts.subject,
    body: opts.body + COMPLIANCE_FOOTER,
    fromAddress: runtime.fromAddress,
    fromName: runtime.fromName,
    threadId: opts.threadId,
  });
  return { ...result, provider: provider.name };
}

/** Count of outreach emails sent today (for the daily cap). */
export async function emailsSentToday(): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return OutreachLog.countDocuments({
    channel: "EMAIL",
    action: { $in: ["SENT", "FOLLOW_UP_SENT"] },
    createdAt: { $gte: startOfDay },
  });
}
