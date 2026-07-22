import nodemailer, { type Transporter } from "nodemailer";
import type { ResolvedEmail } from "../../../config/runtime.js";
import type { EmailMessage, EmailProviderAdapter, SendResult } from "./types.js";

/**
 * Zoho Mail over SMTP (works with any Zoho plan; use an app-specific
 * password when 2FA is on). Host/port default to smtp.zoho.com:465 but are
 * configurable, which also makes this adapter usable for any generic SMTP
 * mailbox, not just Zoho.
 */
export class ZohoProvider implements EmailProviderAdapter {
  readonly name = "zoho" as const;
  readonly supportsDrafts = false;
  private transporter: Transporter;

  constructor(cfg: ResolvedEmail, transporter?: Transporter) {
    this.transporter =
      transporter ??
      nodemailer.createTransport({
        host: cfg.zoho.host,
        port: cfg.zoho.port,
        secure: cfg.zoho.secure,
        auth: { user: cfg.zoho.user, pass: cfg.zoho.password },
        connectionTimeout: 15000,
        socketTimeout: 20000,
      });
  }

  async send(msg: EmailMessage): Promise<SendResult> {
    const info = (await this.transporter.sendMail({
      from: msg.fromName ? `"${msg.fromName.replace(/"/g, "'")}" <${msg.fromAddress}>` : msg.fromAddress,
      to: msg.to,
      subject: msg.subject,
      text: msg.body,
      ...(msg.threadId ? { inReplyTo: msg.threadId, references: msg.threadId } : {}),
    })) as { messageId?: string };
    return { messageId: info.messageId, threadId: info.messageId };
  }

  async verify(): Promise<void> {
    await this.transporter.verify();
  }
}
