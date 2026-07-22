import type { ResolvedEmail } from "../../../config/runtime.js";
import type { EmailMessage, EmailProviderAdapter, SendResult } from "./types.js";

const RESEND_API = "https://api.resend.com";

/**
 * Resend (https://resend.com) via its HTTPS API. The sending domain must be
 * verified in the Resend dashboard. No SDK needed, the API is two calls.
 */
export class ResendProvider implements EmailProviderAdapter {
  readonly name = "resend" as const;
  readonly supportsDrafts = false;
  private apiKey: string;
  private fetchImpl: typeof fetch;

  constructor(cfg: ResolvedEmail, fetchImpl: typeof fetch = fetch) {
    this.apiKey = cfg.resend.apiKey;
    this.fetchImpl = fetchImpl;
  }

  async send(msg: EmailMessage): Promise<SendResult> {
    const res = await this.fetchImpl(`${RESEND_API}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: msg.fromName ? `${msg.fromName} <${msg.fromAddress}>` : msg.fromAddress,
        to: [msg.to],
        subject: msg.subject,
        text: msg.body,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Resend error ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { id?: string };
    return { messageId: data.id, threadId: data.id };
  }

  async verify(): Promise<void> {
    const res = await this.fetchImpl(`${RESEND_API}/domains`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Resend key check failed (${res.status}): ${body.slice(0, 200)}`);
    }
  }
}
