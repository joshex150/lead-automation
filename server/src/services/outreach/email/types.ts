/** Provider-agnostic email primitives. */

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text body (compliance footer already appended by the caller). */
  body: string;
  fromAddress: string;
  fromName: string;
  /** Provider-specific threading hint (Gmail thread id, Message-ID, …). */
  threadId?: string;
}

export interface SendResult {
  messageId?: string;
  threadId?: string;
}

export interface DraftResult {
  draftId: string;
  messageId?: string;
}

/**
 * A pluggable email backend. `send` is mandatory; drafts are optional,
 * providers without a drafts API (Zoho SMTP, Resend) approve leads into an
 * internal "ready to send" state instead, and `send` dispatches directly.
 */
export interface EmailProviderAdapter {
  readonly name: "gmail" | "zoho" | "resend";
  readonly supportsDrafts: boolean;
  send(msg: EmailMessage): Promise<SendResult>;
  createDraft?(msg: EmailMessage): Promise<DraftResult>;
  sendDraft?(draftId: string): Promise<SendResult>;
  /** Cheap credential check for the dashboard "Test" button. */
  verify(): Promise<void>;
}
