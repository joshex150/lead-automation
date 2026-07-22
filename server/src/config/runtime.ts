import { config } from "./index.js";
import { getSettings, type IntegrationSettings, type SettingsDocument } from "../models/Settings.js";

/**
 * Runtime configuration resolution.
 *
 * Everything operational is configurable from the dashboard and stored in
 * MongoDB (Settings.integrations). Environment variables remain a fallback
 * so existing deployments keep working, and so secrets CAN still be supplied
 * via env where that's preferred. Resolution order for every value:
 *
 *     dashboard/DB value  >  environment variable  >  built-in default
 *
 * All resolvers here are PURE over the settings snapshot (easy to test);
 * async wrappers fetch the singleton for callers.
 */

/* ------------------------------------------------------------------ */
/* Secret masking                                                      */
/* ------------------------------------------------------------------ */

export const MASK_PREFIX = "••••";

/** Masks a secret for API responses: keeps only the last 4 characters. */
export function maskSecret(value: string | undefined | null): string {
  if (!value) return "";
  return `${MASK_PREFIX}${value.length > 4 ? value.slice(-4) : ""}`;
}

/** True when a submitted value is a masked placeholder (i.e. "keep existing"). */
export function isMaskedValue(value: unknown): boolean {
  return typeof value === "string" && value.trim().startsWith(MASK_PREFIX);
}

/* ------------------------------------------------------------------ */
/* Google Places                                                       */
/* ------------------------------------------------------------------ */

export function resolvePlacesKey(integrations?: IntegrationSettings): string {
  return integrations?.googlePlacesApiKey?.trim() || config.GOOGLE_PLACES_API_KEY;
}

/* ------------------------------------------------------------------ */
/* AI provider                                                         */
/* ------------------------------------------------------------------ */

export type ResolvedAiProvider = "openai" | "anthropic" | "nvidia" | "custom" | "none";

export interface ResolvedAi {
  provider: ResolvedAiProvider;
  /** Wire protocol the provider speaks. */
  protocol: "openai" | "anthropic" | "none";
  apiKey: string;
  model: string;
  baseUrl: string;
  configured: boolean;
  /** Where the deciding config came from (for the dashboard status panel). */
  source: "db" | "env" | "none";
}

const AI_DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  nvidia: { baseUrl: "https://integrate.api.nvidia.com/v1", model: "meta/llama-3.3-70b-instruct" },
  anthropic: { baseUrl: "https://api.anthropic.com", model: "claude-haiku-4-5-20251001" },
};

const NONE_AI: ResolvedAi = {
  provider: "none",
  protocol: "none",
  apiKey: "",
  model: "",
  baseUrl: "",
  configured: false,
  source: "none",
};

export function resolveAi(integrations?: IntegrationSettings): ResolvedAi {
  const ai = integrations?.ai;
  const provider = ai?.provider ?? "AUTO";
  const dbKey = ai?.apiKey?.trim() ?? "";
  const dbModel = ai?.model?.trim() ?? "";
  const dbBaseUrl = ai?.baseUrl?.trim().replace(/\/+$/, "") ?? "";

  const build = (
    p: ResolvedAiProvider,
    protocol: "openai" | "anthropic",
    apiKey: string,
    source: "db" | "env",
  ): ResolvedAi => {
    const defaults = AI_DEFAULTS[p === "custom" ? "openai" : p];
    return {
      provider: p,
      protocol,
      apiKey,
      model: dbModel || config.PITCH_MODEL || defaults.model,
      baseUrl: dbBaseUrl || defaults.baseUrl,
      configured: true,
      source,
    };
  };

  switch (provider) {
    case "NONE":
      return NONE_AI;
    case "OPENAI": {
      const key = dbKey || config.OPENAI_API_KEY;
      return key ? build("openai", "openai", key, dbKey ? "db" : "env") : NONE_AI;
    }
    case "NVIDIA": {
      const key = dbKey || process.env.NVIDIA_API_KEY?.trim() || "";
      return key ? build("nvidia", "openai", key, dbKey ? "db" : "env") : NONE_AI;
    }
    case "ANTHROPIC": {
      const key = dbKey || config.ANTHROPIC_API_KEY;
      return key ? build("anthropic", "anthropic", key, dbKey ? "db" : "env") : NONE_AI;
    }
    case "CUSTOM": {
      // Custom OpenAI-compatible endpoint (Groq, Together, Ollama, vLLM, …).
      // Base URL is required; API key may legitimately be empty (local servers).
      const baseUrl = dbBaseUrl || process.env.AI_BASE_URL?.trim().replace(/\/+$/, "") || "";
      if (!baseUrl) return NONE_AI;
      const resolved = build("custom", "openai", dbKey, dbKey || dbBaseUrl ? "db" : "env");
      resolved.baseUrl = baseUrl;
      if (!dbModel && !config.PITCH_MODEL) return NONE_AI; // a model name is required for custom endpoints
      return resolved;
    }
    case "AUTO":
    default: {
      // Legacy/env-driven detection, same order as before.
      if (config.PITCH_PROVIDER === "openai") {
        return config.OPENAI_API_KEY ? build("openai", "openai", config.OPENAI_API_KEY, "env") : NONE_AI;
      }
      if (config.PITCH_PROVIDER === "anthropic") {
        return config.ANTHROPIC_API_KEY ? build("anthropic", "anthropic", config.ANTHROPIC_API_KEY, "env") : NONE_AI;
      }
      if (config.OPENAI_API_KEY) return build("openai", "openai", config.OPENAI_API_KEY, "env");
      if (config.ANTHROPIC_API_KEY) return build("anthropic", "anthropic", config.ANTHROPIC_API_KEY, "env");
      return NONE_AI;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Email provider                                                      */
/* ------------------------------------------------------------------ */

export type ResolvedEmailProvider = "gmail" | "zoho" | "resend" | "none";

export interface ResolvedEmail {
  provider: ResolvedEmailProvider;
  configured: boolean;
  supportsDrafts: boolean;
  fromAddress: string;
  fromName: string;
  gmail: { clientId: string; clientSecret: string; refreshToken: string };
  zoho: { host: string; port: number; secure: boolean; user: string; password: string };
  resend: { apiKey: string };
  source: "db" | "env" | "none";
}

const NONE_EMAIL: ResolvedEmail = {
  provider: "none",
  configured: false,
  supportsDrafts: false,
  fromAddress: "",
  fromName: "",
  gmail: { clientId: "", clientSecret: "", refreshToken: "" },
  zoho: { host: "smtp.zoho.com", port: 465, secure: true, user: "", password: "" },
  resend: { apiKey: "" },
  source: "none",
};

export function resolveEmail(integrations?: IntegrationSettings): ResolvedEmail {
  const email = integrations?.email;
  const provider = email?.provider ?? "AUTO";
  const fromName = email?.fromName?.trim() || config.GMAIL_SENDER_NAME;

  const gmail = {
    clientId: email?.gmail?.clientId?.trim() || config.GMAIL_CLIENT_ID,
    clientSecret: email?.gmail?.clientSecret?.trim() || config.GMAIL_CLIENT_SECRET,
    refreshToken: email?.gmail?.refreshToken?.trim() || config.GMAIL_REFRESH_TOKEN,
  };
  const zoho = {
    host: email?.zoho?.host?.trim() || process.env.ZOHO_SMTP_HOST?.trim() || "smtp.zoho.com",
    port: email?.zoho?.port || Number(process.env.ZOHO_SMTP_PORT) || 465,
    secure: email?.zoho?.secure ?? true,
    user: email?.zoho?.user?.trim() || process.env.ZOHO_SMTP_USER?.trim() || "",
    password: email?.zoho?.password?.trim() || process.env.ZOHO_SMTP_PASSWORD?.trim() || "",
  };
  const resend = {
    apiKey: email?.resend?.apiKey?.trim() || process.env.RESEND_API_KEY?.trim() || "",
  };

  const gmailReady = Boolean(gmail.clientId && gmail.clientSecret && gmail.refreshToken);
  const zohoReady = Boolean(zoho.user && zoho.password);
  const resendReady = Boolean(resend.apiKey);

  const fromFor = (p: ResolvedEmailProvider): string => {
    const explicit = email?.fromAddress?.trim();
    if (explicit) return explicit;
    if (p === "gmail") return config.GMAIL_SENDER;
    if (p === "zoho") return zoho.user;
    return process.env.EMAIL_FROM?.trim() || "";
  };

  const build = (p: Exclude<ResolvedEmailProvider, "none">): ResolvedEmail => {
    const fromAddress = fromFor(p);
    const ready =
      (p === "gmail" && gmailReady && Boolean(fromAddress)) ||
      (p === "zoho" && zohoReady && Boolean(fromAddress)) ||
      (p === "resend" && resendReady && Boolean(fromAddress));
    if (!ready) return NONE_EMAIL;
    const dbDriven = Boolean(
      email?.fromAddress?.trim() ||
        (p === "gmail" && email?.gmail?.clientId) ||
        (p === "zoho" && email?.zoho?.user) ||
        (p === "resend" && email?.resend?.apiKey),
    );
    return {
      provider: p,
      configured: true,
      supportsDrafts: p === "gmail",
      fromAddress,
      fromName,
      gmail,
      zoho,
      resend,
      source: dbDriven ? "db" : "env",
    };
  };

  switch (provider) {
    case "NONE":
      return NONE_EMAIL;
    case "GMAIL":
      return build("gmail");
    case "ZOHO":
      return build("zoho");
    case "RESEND":
      return build("resend");
    case "AUTO":
    default: {
      if (gmailReady) return build("gmail");
      if (zohoReady) return build("zoho");
      if (resendReady) return build("resend");
      return NONE_EMAIL;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Scheduler + checker                                                 */
/* ------------------------------------------------------------------ */

export interface ResolvedScheduler {
  enabled: boolean;
  discoveryCron: string;
  followUpCron: string;
  timezone: string;
}

export function resolveScheduler(integrations?: IntegrationSettings): ResolvedScheduler {
  const s = integrations?.scheduler;
  return {
    enabled: s?.enabled ?? config.ENABLE_SCHEDULER,
    discoveryCron: s?.discoveryCron?.trim() || config.DISCOVERY_CRON,
    followUpCron: s?.followUpCron?.trim() || config.FOLLOWUP_CRON,
    timezone: s?.timezone?.trim() || config.TIMEZONE,
  };
}

export interface ResolvedChecker {
  timeoutMs: number;
  maxRedirects: number;
  concurrency: number;
}

export function resolveChecker(integrations?: IntegrationSettings): ResolvedChecker {
  const c = integrations?.checker;
  return {
    timeoutMs: c?.timeoutMs || config.CHECKER_TIMEOUT_MS,
    maxRedirects: c?.maxRedirects || config.CHECKER_MAX_REDIRECTS,
    concurrency: Math.max(1, Math.min(c?.concurrency || config.CHECKER_CONCURRENCY, 20)),
  };
}

/* ------------------------------------------------------------------ */
/* Async wrappers over the settings singleton                          */
/* ------------------------------------------------------------------ */

async function integrationsSnapshot(): Promise<IntegrationSettings | undefined> {
  try {
    const settings: SettingsDocument = await getSettings();
    return settings.integrations;
  } catch {
    // DB unavailable, fall back to env-only resolution so the caller
    // still gets a usable answer instead of a crash.
    return undefined;
  }
}

export async function getAiRuntime(): Promise<ResolvedAi> {
  return resolveAi(await integrationsSnapshot());
}

export async function getEmailRuntime(): Promise<ResolvedEmail> {
  return resolveEmail(await integrationsSnapshot());
}

export async function getPlacesKey(): Promise<string> {
  return resolvePlacesKey(await integrationsSnapshot());
}

export async function getSchedulerRuntime(): Promise<ResolvedScheduler> {
  return resolveScheduler(await integrationsSnapshot());
}

export async function getCheckerRuntime(): Promise<ResolvedChecker> {
  return resolveChecker(await integrationsSnapshot());
}

/** Integration status summary for the dashboard/stats. */
export async function integrationStatus(): Promise<{
  googlePlaces: { configured: boolean; source: "db" | "env" | "none" };
  ai: { configured: boolean; provider: ResolvedAiProvider; model: string; source: "db" | "env" | "none" };
  email: {
    configured: boolean;
    provider: ResolvedEmailProvider;
    fromAddress: string;
    supportsDrafts: boolean;
    source: "db" | "env" | "none";
  };
  scheduler: ResolvedScheduler;
  authEnabled: boolean;
}> {
  const snapshot = await integrationsSnapshot();
  const placesKey = resolvePlacesKey(snapshot);
  const ai = resolveAi(snapshot);
  const email = resolveEmail(snapshot);
  return {
    googlePlaces: {
      configured: Boolean(placesKey),
      source: snapshot?.googlePlacesApiKey?.trim() ? "db" : placesKey ? "env" : "none",
    },
    ai: { configured: ai.configured, provider: ai.provider, model: ai.model, source: ai.source },
    email: {
      configured: email.configured,
      provider: email.provider,
      fromAddress: email.fromAddress,
      supportsDrafts: email.supportsDrafts,
      source: email.source,
    },
    scheduler: resolveScheduler(snapshot),
    authEnabled: Boolean(config.API_KEY),
  };
}
