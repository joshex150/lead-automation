import { describe, expect, it } from "vitest";
import {
  isMaskedValue,
  maskSecret,
  resolveAi,
  resolveChecker,
  resolveEmail,
  resolvePlacesKey,
  resolveScheduler,
} from "../src/config/runtime.js";
import type { IntegrationSettings } from "../src/models/Settings.js";

/**
 * These resolvers are pure over a settings snapshot. Env fallback still reads
 * process.env, so tests set only the DB snapshot and assert DB-first wins.
 */

function integrations(overrides: Partial<IntegrationSettings> = {}): IntegrationSettings {
  return {
    googlePlacesApiKey: "",
    ai: { provider: "AUTO", apiKey: "", model: "", baseUrl: "" },
    email: {
      provider: "AUTO",
      fromAddress: "",
      fromName: "",
      gmail: { clientId: "", clientSecret: "", refreshToken: "" },
      zoho: { host: "smtp.zoho.com", port: 465, secure: true, user: "", password: "" },
      resend: { apiKey: "" },
    },
    scheduler: { enabled: null, discoveryCron: "", followUpCron: "", timezone: "" },
    checker: { timeoutMs: 0, maxRedirects: 0, concurrency: 0 },
    ...overrides,
  } as IntegrationSettings;
}

describe("maskSecret / isMaskedValue", () => {
  it("masks all but the last 4 chars", () => {
    expect(maskSecret("sk-abcdef1234")).toBe("••••1234");
    expect(maskSecret("ab")).toBe("••••");
    expect(maskSecret("")).toBe("");
    expect(maskSecret(undefined)).toBe("");
  });
  it("recognises masked placeholders", () => {
    expect(isMaskedValue("••••1234")).toBe(true);
    expect(isMaskedValue("real-secret")).toBe(false);
    expect(isMaskedValue(42)).toBe(false);
  });
});

describe("resolvePlacesKey", () => {
  it("prefers the DB value", () => {
    expect(resolvePlacesKey(integrations({ googlePlacesApiKey: "db-key" }))).toBe("db-key");
  });
});

describe("resolveAi", () => {
  it("returns none for provider NONE even with a key", () => {
    const r = resolveAi(integrations({ ai: { provider: "NONE", apiKey: "x", model: "", baseUrl: "" } }));
    expect(r.configured).toBe(false);
    expect(r.provider).toBe("none");
  });

  it("OPENAI uses the DB key + default model/baseUrl", () => {
    const r = resolveAi(integrations({ ai: { provider: "OPENAI", apiKey: "sk-1", model: "", baseUrl: "" } }));
    expect(r).toMatchObject({ provider: "openai", protocol: "openai", apiKey: "sk-1", source: "db" });
    expect(r.baseUrl).toBe("https://api.openai.com/v1");
    expect(r.model).toBe("gpt-4o-mini");
  });

  it("NVIDIA uses the NIM base URL and openai protocol", () => {
    const r = resolveAi(integrations({ ai: { provider: "NVIDIA", apiKey: "nvapi-1", model: "", baseUrl: "" } }));
    expect(r.provider).toBe("nvidia");
    expect(r.protocol).toBe("openai");
    expect(r.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
    expect(r.model).toContain("llama");
  });

  it("ANTHROPIC uses the anthropic protocol", () => {
    const r = resolveAi(integrations({ ai: { provider: "ANTHROPIC", apiKey: "sk-ant", model: "", baseUrl: "" } }));
    expect(r.protocol).toBe("anthropic");
    expect(r.configured).toBe(true);
  });

  it("CUSTOM needs a base URL AND a model", () => {
    const noModel = resolveAi(
      integrations({ ai: { provider: "CUSTOM", apiKey: "k", model: "", baseUrl: "https://api.groq.com/openai/v1" } }),
    );
    expect(noModel.configured).toBe(false);

    const ok = resolveAi(
      integrations({ ai: { provider: "CUSTOM", apiKey: "k", model: "llama-3.1-70b", baseUrl: "https://api.groq.com/openai/v1/" } }),
    );
    expect(ok).toMatchObject({ provider: "custom", protocol: "openai", model: "llama-3.1-70b" });
    expect(ok.baseUrl).toBe("https://api.groq.com/openai/v1"); // trailing slash trimmed
  });

  it("CUSTOM allows an empty API key (local server)", () => {
    const ok = resolveAi(
      integrations({ ai: { provider: "CUSTOM", apiKey: "", model: "llama3", baseUrl: "http://localhost:11434/v1" } }),
    );
    expect(ok.configured).toBe(true);
    expect(ok.apiKey).toBe("");
  });

  it("custom model overrides the provider default", () => {
    const r = resolveAi(integrations({ ai: { provider: "OPENAI", apiKey: "sk", model: "gpt-4o", baseUrl: "" } }));
    expect(r.model).toBe("gpt-4o");
  });
});

describe("resolveEmail", () => {
  it("GMAIL needs all three creds plus a from address", () => {
    const incomplete = resolveEmail(
      integrations({
        email: {
          provider: "GMAIL",
          fromAddress: "a@b.com",
          fromName: "",
          gmail: { clientId: "id", clientSecret: "sec", refreshToken: "" },
          zoho: { host: "smtp.zoho.com", port: 465, secure: true, user: "", password: "" },
          resend: { apiKey: "" },
        },
      }),
    );
    expect(incomplete.configured).toBe(false);

    const ok = resolveEmail(
      integrations({
        email: {
          provider: "GMAIL",
          fromAddress: "a@b.com",
          fromName: "YEAN",
          gmail: { clientId: "id", clientSecret: "sec", refreshToken: "tok" },
          zoho: { host: "smtp.zoho.com", port: 465, secure: true, user: "", password: "" },
          resend: { apiKey: "" },
        },
      }),
    );
    expect(ok).toMatchObject({ provider: "gmail", configured: true, supportsDrafts: true, fromAddress: "a@b.com" });
  });

  it("ZOHO defaults its from address to the SMTP user", () => {
    const r = resolveEmail(
      integrations({
        email: {
          provider: "ZOHO",
          fromAddress: "",
          fromName: "",
          gmail: { clientId: "", clientSecret: "", refreshToken: "" },
          zoho: { host: "smtp.zoho.com", port: 465, secure: true, user: "hi@shop.ng", password: "pw" },
          resend: { apiKey: "" },
        },
      }),
    );
    expect(r).toMatchObject({ provider: "zoho", configured: true, supportsDrafts: false, fromAddress: "hi@shop.ng" });
  });

  it("RESEND needs an api key AND an explicit from address", () => {
    const noFrom = resolveEmail(
      integrations({
        email: {
          provider: "RESEND",
          fromAddress: "",
          fromName: "",
          gmail: { clientId: "", clientSecret: "", refreshToken: "" },
          zoho: { host: "smtp.zoho.com", port: 465, secure: true, user: "", password: "" },
          resend: { apiKey: "re_123" },
        },
      }),
    );
    expect(noFrom.configured).toBe(false);

    const ok = resolveEmail(
      integrations({
        email: {
          provider: "RESEND",
          fromAddress: "hello@brand.ng",
          fromName: "",
          gmail: { clientId: "", clientSecret: "", refreshToken: "" },
          zoho: { host: "smtp.zoho.com", port: 465, secure: true, user: "", password: "" },
          resend: { apiKey: "re_123" },
        },
      }),
    );
    expect(ok).toMatchObject({ provider: "resend", configured: true, supportsDrafts: false });
  });

  it("AUTO picks Gmail first, then Zoho, then Resend", () => {
    const zohoOnly = resolveEmail(
      integrations({
        email: {
          provider: "AUTO",
          fromAddress: "",
          fromName: "",
          gmail: { clientId: "", clientSecret: "", refreshToken: "" },
          zoho: { host: "smtp.zoho.com", port: 465, secure: true, user: "u@z.com", password: "p" },
          resend: { apiKey: "re_1" },
        },
      }),
    );
    expect(zohoOnly.provider).toBe("zoho");
  });
});

describe("resolveScheduler", () => {
  it("null enabled inherits (truthy env default)", () => {
    const r = resolveScheduler(integrations({ scheduler: { enabled: null, discoveryCron: "", followUpCron: "", timezone: "" } }));
    expect(typeof r.enabled).toBe("boolean");
    expect(r.discoveryCron).toBe("0 7 * * *");
    expect(r.timezone).toBe("Africa/Lagos");
  });
  it("explicit false disables", () => {
    const r = resolveScheduler(
      integrations({ scheduler: { enabled: false, discoveryCron: "*/5 * * * *", followUpCron: "", timezone: "UTC" } }),
    );
    expect(r.enabled).toBe(false);
    expect(r.discoveryCron).toBe("*/5 * * * *");
    expect(r.timezone).toBe("UTC");
  });
});

describe("resolveChecker", () => {
  it("clamps concurrency and falls back to env defaults", () => {
    const r = resolveChecker(integrations({ checker: { timeoutMs: 0, maxRedirects: 0, concurrency: 999 } }));
    expect(r.concurrency).toBe(20);
    expect(r.timeoutMs).toBeGreaterThan(0);
    expect(r.maxRedirects).toBeGreaterThan(0);
  });
});
