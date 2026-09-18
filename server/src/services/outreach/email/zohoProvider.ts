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

  private readonly host: string;
  private readonly port: number;

  constructor(cfg: ResolvedEmail, transporter?: Transporter) {
    this.host = cfg.zoho.host;
    this.port = cfg.zoho.port;
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

  /**
   * Says what a refused SMTP connection almost always means.
   *
   * Hosts block outbound SMTP far more often than they advertise it: Railway
   * allows it on Pro and above and blocks it on Free, Trial and Hobby, and
   * several others do the same. What reaches the operator without this is
   * "connect ECONNREFUSED 136.143.188.15:465", which reads as a broken app or a
   * wrong password, and the two fixes for those are nothing like the fix for
   * this. Only the connection-level failures are rewritten; a rejected password
   * is already telling the truth about itself.
   */
  private explain(err: unknown): never {
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string } | null)?.code ?? "";
    const blocked =
      /ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ESOCKET|Network is unreachable|Greeting never received/i.test(
        `${code} ${message}`,
      );
    if (!blocked) throw err instanceof Error ? err : new Error(message);
    throw new Error(
      `Could not open an SMTP connection to ${this.host}:${this.port} (${message}). ` +
        "Outbound SMTP is usually blocked by the host rather than broken here: on Railway it needs the Pro plan, " +
        "and Free, Trial and Hobby have it disabled. Resend or Gmail both send over HTTPS and work on any plan.",
    );
  }

  async send(msg: EmailMessage): Promise<SendResult> {
    try {
      const info = (await this.transporter.sendMail({
        from: msg.fromName ? `"${msg.fromName.replace(/"/g, "'")}" <${msg.fromAddress}>` : msg.fromAddress,
        to: msg.to,
        subject: msg.subject,
        text: msg.body,
        ...(msg.threadId ? { inReplyTo: msg.threadId, references: msg.threadId } : {}),
      })) as { messageId?: string };
      return { messageId: info.messageId, threadId: info.messageId };
    } catch (err) {
      this.explain(err);
    }
  }

  async verify(): Promise<void> {
    try {
      await this.transporter.verify();
    } catch (err) {
      this.explain(err);
    }
  }
}
