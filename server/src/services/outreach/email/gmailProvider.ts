import { google, type gmail_v1 } from "googleapis";
import type { ResolvedEmail } from "../../../config/runtime.js";
import type { DraftResult, EmailMessage, EmailProviderAdapter, SendResult } from "./types.js";

/** Builds an RFC 2822 message, base64url-encoded as the Gmail API expects. */
export function buildRawEmail(opts: {
  to: string;
  subject: string;
  body: string;
  from: string;
  fromName?: string;
}): string {
  // RFC 2047 encode the subject in case of non-ASCII characters.
  const encodedSubject = /^[\x20-\x7E]*$/.test(opts.subject)
    ? opts.subject
    : `=?UTF-8?B?${Buffer.from(opts.subject, "utf8").toString("base64")}?=`;

  const lines = [
    `From: ${opts.fromName ? `${opts.fromName} <${opts.from}>` : opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(opts.body, "utf8").toString("base64"),
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

export class GmailProvider implements EmailProviderAdapter {
  readonly name = "gmail" as const;
  readonly supportsDrafts = true;
  private client: gmail_v1.Gmail;

  constructor(cfg: ResolvedEmail, client?: gmail_v1.Gmail) {
    if (client) {
      this.client = client;
    } else {
      const oauth2 = new google.auth.OAuth2(cfg.gmail.clientId, cfg.gmail.clientSecret);
      oauth2.setCredentials({ refresh_token: cfg.gmail.refreshToken });
      this.client = google.gmail({ version: "v1", auth: oauth2 });
    }
  }

  async createDraft(msg: EmailMessage): Promise<DraftResult> {
    const raw = buildRawEmail({ to: msg.to, subject: msg.subject, body: msg.body, from: msg.fromAddress, fromName: msg.fromName });
    const res = await this.client.users.drafts.create({ userId: "me", requestBody: { message: { raw } } });
    const draftId = res.data.id;
    if (!draftId) throw new Error("Gmail did not return a draft id");
    return { draftId, messageId: res.data.message?.id ?? undefined };
  }

  async sendDraft(draftId: string): Promise<SendResult> {
    const res = await this.client.users.drafts.send({ userId: "me", requestBody: { id: draftId } });
    return { messageId: res.data.id ?? undefined, threadId: res.data.threadId ?? undefined };
  }

  async send(msg: EmailMessage): Promise<SendResult> {
    const raw = buildRawEmail({ to: msg.to, subject: msg.subject, body: msg.body, from: msg.fromAddress, fromName: msg.fromName });
    const res = await this.client.users.messages.send({
      userId: "me",
      requestBody: { raw, ...(msg.threadId ? { threadId: msg.threadId } : {}) },
    });
    return { messageId: res.data.id ?? undefined, threadId: res.data.threadId ?? undefined };
  }

  async verify(): Promise<void> {
    await this.client.users.getProfile({ userId: "me" });
  }
}
