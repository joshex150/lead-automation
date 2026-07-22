import { describe, expect, it, vi } from "vitest";
import { buildRawEmail } from "../src/services/outreach/email/gmailProvider.js";
import { ResendProvider } from "../src/services/outreach/email/resendProvider.js";
import { ZohoProvider } from "../src/services/outreach/email/zohoProvider.js";
import type { ResolvedEmail } from "../src/config/runtime.js";

function resolved(overrides: Partial<ResolvedEmail> = {}): ResolvedEmail {
  return {
    provider: "resend",
    configured: true,
    supportsDrafts: false,
    fromAddress: "hello@yean.tech",
    fromName: "YEAN Technologies",
    gmail: { clientId: "", clientSecret: "", refreshToken: "" },
    zoho: { host: "smtp.zoho.com", port: 465, secure: true, user: "u@z.com", password: "pw" },
    resend: { apiKey: "re_test" },
    source: "db",
    ...overrides,
  };
}

describe("buildRawEmail (Gmail)", () => {
  it("builds a valid RFC2822 base64url message", () => {
    const raw = buildRawEmail({ to: "owner@business.ng", subject: "A website for you", body: "Hello!", from: "hello@yean.tech", fromName: "YEAN" });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain("From: YEAN <hello@yean.tech>");
    expect(decoded).toContain("To: owner@business.ng");
    expect(decoded).toContain("MIME-Version: 1.0");
    const bodyPart = decoded.split("\r\n\r\n")[1];
    expect(Buffer.from(bodyPart, "base64").toString("utf8")).toBe("Hello!");
  });

  it("RFC2047-encodes non-ASCII subjects and round-trips unicode bodies", () => {
    const body = "Naija business, 50,000 Naira";
    const raw = buildRawEmail({ to: "a@b.c", subject: "Your café", body, from: "x@y.z" });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toMatch(/Subject: =\?UTF-8\?B\?/);
    const bodyPart = decoded.split("\r\n\r\n")[1];
    expect(Buffer.from(bodyPart, "base64").toString("utf8")).toBe(body);
  });
});

describe("ResendProvider", () => {
  it("POSTs to the Resend API and returns the message id", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ id: "msg_123" }), { status: 200, headers: { "content-type": "application/json" } }),
    ) as unknown as typeof fetch;
    const p = new ResendProvider(resolved(), fetchImpl);
    const r = await p.send({ to: "a@b.c", subject: "Hi", body: "Body", fromAddress: "hello@yean.tech", fromName: "YEAN" });
    expect(r.messageId).toBe("msg_123");
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.from).toBe("YEAN <hello@yean.tech>");
    expect(sent.to).toEqual(["a@b.c"]);
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer re_test" });
  });

  it("throws with the API error body on non-2xx", async () => {
    const fetchImpl = vi.fn(async () => new Response("domain not verified", { status: 403 })) as unknown as typeof fetch;
    const p = new ResendProvider(resolved(), fetchImpl);
    await expect(p.send({ to: "a@b.c", subject: "s", body: "b", fromAddress: "x@y.z", fromName: "" })).rejects.toThrow(
      /Resend error 403/,
    );
  });

  it("verify() hits the domains endpoint", async () => {
    const fetchImpl = vi.fn(async () => new Response("[]", { status: 200 })) as unknown as typeof fetch;
    const p = new ResendProvider(resolved(), fetchImpl);
    await expect(p.verify()).resolves.toBeUndefined();
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("/domains");
  });
});

describe("ZohoProvider", () => {
  it("sends through the injected transporter with a proper From header", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "<abc@zoho>" }));
    const transporter = { sendMail, verify: vi.fn(async () => true) } as never;
    const p = new ZohoProvider(resolved({ provider: "zoho" }), transporter);
    const r = await p.send({ to: "a@b.c", subject: "Hi", body: "Body", fromAddress: "u@z.com", fromName: "YEAN Technologies" });
    expect(r.messageId).toBe("<abc@zoho>");
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "a@b.c", subject: "Hi", text: "Body", from: '"YEAN Technologies" <u@z.com>' }),
    );
  });

  it("threads follow-ups with inReplyTo/references", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "<x@zoho>" }));
    const transporter = { sendMail, verify: vi.fn() } as never;
    const p = new ZohoProvider(resolved({ provider: "zoho" }), transporter);
    await p.send({ to: "a@b.c", subject: "Re: Hi", body: "b", fromAddress: "u@z.com", fromName: "Y", threadId: "<orig@zoho>" });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ inReplyTo: "<orig@zoho>", references: "<orig@zoho>" }));
  });
});
