import { Lead, type LeadDocument } from "../../models/Lead.js";
import { OutreachLog } from "../../models/OutreachLog.js";
import { getSettings } from "../../models/Settings.js";
import { logger } from "../../utils/logger.js";
import { emailsSentToday, getActiveEmail, sendEmail } from "./email/index.js";

/**
 * Follow-up engine. Policy (compliance-driven):
 *  - Exactly ONE follow-up per lead, `followUpDays` after first contact.
 *  - Never follow up with anyone who responded, opted out, or is suppressed.
 *  - Respect maxContactAttempts and the daily email cap.
 */

export function buildFollowUpMessage(lead: LeadDocument): { subject: string; body: string } {
  const subject = `Re: ${lead.pitchSubject ?? `Your online presence, ${lead.businessName}`}`;
  const body = `Hello ${lead.businessName},

Just a gentle nudge on my earlier note. I know inboxes get busy.

If improving your online presence is on your radar this season, we'd love to show you what a custom website could look like for ${lead.businessName}. No pressure at all; a one-line reply is enough.

If now isn't the right time, that's completely fine. This is the last you'll hear from us unless you reach out.

Warm regards,
The YEAN Technologies team`;
  return { subject, body };
}

export interface FollowUpRunResult {
  eligible: number;
  sent: number;
  skipped: number;
  errors: Array<{ lead: string; error: string }>;
}

export async function runFollowUps(now = new Date()): Promise<FollowUpRunResult> {
  const settings = await getSettings();
  const result: FollowUpRunResult = { eligible: 0, sent: 0, skipped: 0, errors: [] };

  const candidates = await Lead.find({
    outreachStatus: "CONTACTED",
    outreachChannel: "EMAIL",
    optedOut: { $ne: true },
    followUpAt: { $lte: now },
    followUpSentAt: { $exists: false },
    responseStatus: "NONE",
    timesContacted: { $lt: settings.maxContactAttempts },
    email: { $exists: true, $nin: [null, ""] },
  }).limit(100);

  result.eligible = candidates.length;
  if (candidates.length === 0) return result;

  const { provider } = await getActiveEmail();
  if (!provider) {
    logger.warn("Follow-ups due but no email provider is configured, skipping");
    result.skipped = candidates.length;
    return result;
  }

  let sentToday = await emailsSentToday();

  for (const lead of candidates) {
    if (sentToday >= settings.dailyEmailCap) {
      result.skipped++;
      continue;
    }
    try {
      const { subject, body } = buildFollowUpMessage(lead);
      const send = await sendEmail({
        to: lead.email!,
        subject,
        body,
        threadId: lead.gmailThreadId,
      });

      lead.followUpSentAt = now;
      lead.timesContacted += 1;
      lead.lastContactedAt = now;
      lead.outreachStatus = "FOLLOW_UP_SENT";
      await lead.save();

      await OutreachLog.create({
        leadId: lead._id,
        channel: "EMAIL",
        direction: "OUTBOUND",
        action: "FOLLOW_UP_SENT",
        subject,
        message: body,
        meta: { messageId: send.messageId, threadId: send.threadId, provider: send.provider },
      });

      sentToday++;
      result.sent++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ lead: lead.businessName, error: msg });
      logger.error({ lead: lead.businessName, err: msg }, "follow-up send failed");
    }
  }

  logger.info(result, "follow-up run complete");
  return result;
}
