import { describe, expect, it } from "vitest";
import { buildRawEmail } from "../src/services/outreach/email/gmailProvider.js";
import { COMPLIANCE_FOOTER } from "../src/services/outreach/email/index.js";

describe("buildRawEmail", () => {
  it("builds a valid RFC2822 base64url message", () => {
    const raw = buildRawEmail({
      to: "owner@business.ng",
      subject: "A website for your business",
      body: "Hello!",
      from: "hello@yean.tech",
      fromName: "YEAN Technologies",
    });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain("From: YEAN Technologies <hello@yean.tech>");
    expect(decoded).toContain("To: owner@business.ng");
    expect(decoded).toContain("Subject: A website for your business");
    expect(decoded).toContain("MIME-Version: 1.0");
    // body is base64-encoded within the message
    const bodyPart = decoded.split("\r\n\r\n")[1];
    expect(Buffer.from(bodyPart, "base64").toString("utf8")).toBe("Hello!");
  });

  it("RFC2047-encodes non-ASCII subjects", () => {
    const raw = buildRawEmail({
      to: "a@b.c",
      subject: "Your café, let's talk",
      body: "x",
      from: "hello@yean.tech",
    });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toMatch(/Subject: =\?UTF-8\?B\?/);
  });

  it("round-trips unicode bodies", () => {
    const body = "Naija businesses 🇳🇬, ₦50,000";
    const raw = buildRawEmail({ to: "a@b.c", subject: "s", body, from: "x@y.z" });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const bodyPart = decoded.split("\r\n\r\n")[1];
    expect(Buffer.from(bodyPart, "base64").toString("utf8")).toBe(body);
  });
});

describe("COMPLIANCE_FOOTER", () => {
  it("offers a clear opt-out (NDPA right to object)", () => {
    expect(COMPLIANCE_FOOTER).toMatch(/unsubscribe/i);
    expect(COMPLIANCE_FOOTER).toMatch(/won't contact you/i);
  });

  it("discloses the data source", () => {
    expect(COMPLIANCE_FOOTER).toMatch(/public listing/i);
  });
});
