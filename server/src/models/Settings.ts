import mongoose, { Schema, type Document, type Model } from "mongoose";
import {
  DEFAULT_CATEGORIES,
  DEFAULT_CITIES,
  DEFAULT_SCORING_WEIGHTS,
  type ScoringWeights,
} from "../types.js";
import { config } from "../config/index.js";

/**
 * Singleton settings document. Editable from the dashboard so search
 * targets, scoring, providers and credentials can be tuned without
 * redeploying. Integration credentials live here (DB) with env vars as
 * fallback, see config/runtime.ts for the resolution rules.
 */

export type AiProvider = "AUTO" | "OPENAI" | "ANTHROPIC" | "GROQ" | "NVIDIA" | "CUSTOM" | "NONE";
export type EmailProviderName = "AUTO" | "GMAIL" | "ZOHO" | "RESEND" | "NONE";

export interface AiSettings {
  provider: AiProvider;
  apiKey: string;
  model: string;
  /** Provider request ceiling; adaptive limiter backs off below it on 429. */
  requestsPerMinute?: number;
  /** Base URL for OpenAI-compatible endpoints (used by CUSTOM; optional override for OPENAI/NVIDIA). */
  baseUrl: string;
}

export interface EmailSettings {
  provider: EmailProviderName;
  fromAddress: string;
  fromName: string;
  gmail: { clientId: string; clientSecret: string; refreshToken: string };
  zoho: { host: string; port: number; secure: boolean; user: string; password: string };
  resend: { apiKey: string };
}

export interface SchedulerSettings {
  /** null = inherit from ENABLE_SCHEDULER env (default true). */
  enabled: boolean | null;
  discoveryCron: string;
  followUpCron: string;
  timezone: string;
}

export interface CheckerSettings {
  timeoutMs: number;
  maxRedirects: number;
  concurrency: number;
}

export interface DirectorySourceSettings {
  enabled: boolean;
  /** Public directory/sitemap URLs to crawl for business website links. */
  urls: string[];
  defaultCity: string;
  defaultCategory: string;
  /** Cap on new candidate URLs pulled per run (protects volume + cost). */
  maxPerRun: number;
}

export interface SourceSettings {
  /** Manual/bulk import is always available on demand; this governs UI + auto runs. */
  manualImportEnabled: boolean;
  directory: DirectorySourceSettings;
}

export interface IntegrationSettings {
  googlePlacesApiKey: string;
  ai: AiSettings;
  email: EmailSettings;
  scheduler: SchedulerSettings;
  checker: CheckerSettings;
  sources: SourceSettings;
}

export interface PitchSettings {
  /**
   * Write one message per situation and personalise it per business, instead of
   * one AI call per lead. A scan of several hundred businesses usually contains
   * only a dozen or so distinct situations, so this is the difference between
   * hundreds of calls and a handful. Leads carrying their own specifics, an
   * Instagram bio or a recent post, are always written individually.
   */
  reuseAcrossSimilarLeads: boolean;
}

export interface SettingsDocument extends Document {
  key: "global";
  cities: string[];
  categories: string[];
  scoreThreshold: number;
  scoringWeights: ScoringWeights;
  followUpDays: number;
  maxContactAttempts: number;
  dailyEmailCap: number;
  discoveryEnabled: boolean;
  /** Max Places results requested per query (each page = 20; 3 pages max). */
  maxResultsPerQuery: number;
  /** Project-wide Text Search pacing. Conservative default protects Places quota. */
  placesRequestsPerMinute: number;
  integrations: IntegrationSettings;
  pitch: PitchSettings;
  /** Set once the first-run onboarding wizard is completed. */
  onboardedAt: Date | null;
  updatedAt: Date;
}

const settingsSchema = new Schema<SettingsDocument>(
  {
    key: { type: String, default: "global", unique: true },
    cities: { type: [String], default: DEFAULT_CITIES },
    categories: { type: [String], default: DEFAULT_CATEGORIES },
    scoreThreshold: { type: Number, default: config.SCORE_THRESHOLD },
    scoringWeights: {
      noWebsite: { type: Number, default: DEFAULT_SCORING_WEIGHTS.noWebsite },
      brokenWebsite: { type: Number, default: DEFAULT_SCORING_WEIGHTS.brokenWebsite },
      socialOrLinkInBioOnly: { type: Number, default: DEFAULT_SCORING_WEIGHTS.socialOrLinkInBioOnly },
      shopifyWebsite: { type: Number, default: DEFAULT_SCORING_WEIGHTS.shopifyWebsite },
      poorWebsite: { type: Number, default: DEFAULT_SCORING_WEIGHTS.poorWebsite },
      menuPlatformOnly: { type: Number, default: DEFAULT_SCORING_WEIGHTS.menuPlatformOnly },
      customWebsitePenalty: { type: Number, default: DEFAULT_SCORING_WEIGHTS.customWebsitePenalty },
      openingSoon: { type: Number, default: DEFAULT_SCORING_WEIGHTS.openingSoon },
      newBusiness: { type: Number, default: DEFAULT_SCORING_WEIGHTS.newBusiness },
      emergingBusiness: { type: Number, default: DEFAULT_SCORING_WEIGHTS.emergingBusiness },
      newToGoogle: { type: Number, default: DEFAULT_SCORING_WEIGHTS.newToGoogle },
      risingActivity: { type: Number, default: DEFAULT_SCORING_WEIGHTS.risingActivity },
      wellRated: { type: Number, default: DEFAULT_SCORING_WEIGHTS.wellRated },
      strongVisualBrand: { type: Number, default: DEFAULT_SCORING_WEIGHTS.strongVisualBrand },
      publicEmail: { type: Number, default: DEFAULT_SCORING_WEIGHTS.publicEmail },
      whatsappAvailable: { type: Number, default: DEFAULT_SCORING_WEIGHTS.whatsappAvailable },
      phoneOnly: { type: Number, default: DEFAULT_SCORING_WEIGHTS.phoneOnly },
      activeInstagram: { type: Number, default: DEFAULT_SCORING_WEIGHTS.activeInstagram },
      // Kept only so old settings documents can be read while the UI migrates.
      recentlyOpened: Number,
    },
    followUpDays: { type: Number, default: config.FOLLOW_UP_DAYS },
    maxContactAttempts: { type: Number, default: config.MAX_CONTACT_ATTEMPTS },
    dailyEmailCap: { type: Number, default: config.DAILY_EMAIL_CAP },
    discoveryEnabled: { type: Boolean, default: true },
    maxResultsPerQuery: { type: Number, default: 60 },
    placesRequestsPerMinute: { type: Number, default: 60 },
    integrations: {
      googlePlacesApiKey: { type: String, default: "" },
      ai: {
        provider: {
          type: String,
          enum: ["AUTO", "OPENAI", "ANTHROPIC", "GROQ", "NVIDIA", "CUSTOM", "NONE"],
          default: "AUTO",
        },
        apiKey: { type: String, default: "" },
        model: { type: String, default: "" },
        requestsPerMinute: { type: Number, default: 30 },
        baseUrl: { type: String, default: "" },
      },
      email: {
        provider: {
          type: String,
          enum: ["AUTO", "GMAIL", "ZOHO", "RESEND", "NONE"],
          default: "AUTO",
        },
        fromAddress: { type: String, default: "" },
        fromName: { type: String, default: "" },
        gmail: {
          clientId: { type: String, default: "" },
          clientSecret: { type: String, default: "" },
          refreshToken: { type: String, default: "" },
        },
        zoho: {
          host: { type: String, default: "smtp.zoho.com" },
          port: { type: Number, default: 465 },
          secure: { type: Boolean, default: true },
          user: { type: String, default: "" },
          password: { type: String, default: "" },
        },
        resend: {
          apiKey: { type: String, default: "" },
        },
      },
      scheduler: {
        enabled: { type: Boolean, default: null },
        discoveryCron: { type: String, default: "" },
        followUpCron: { type: String, default: "" },
        timezone: { type: String, default: "" },
      },
      checker: {
        timeoutMs: { type: Number, default: 0 },
        maxRedirects: { type: Number, default: 0 },
        concurrency: { type: Number, default: 0 },
      },
      sources: {
        manualImportEnabled: { type: Boolean, default: true },
        directory: {
          enabled: { type: Boolean, default: false },
          urls: { type: [String], default: [] },
          defaultCity: { type: String, default: "" },
          defaultCategory: { type: String, default: "" },
          maxPerRun: { type: Number, default: 100 },
        },
      },
    },
    pitch: {
      reuseAcrossSimilarLeads: { type: Boolean, default: true },
    },
    onboardedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const Settings: Model<SettingsDocument> =
  (mongoose.models.Settings as Model<SettingsDocument>) ??
  mongoose.model<SettingsDocument>("Settings", settingsSchema);

export async function getSettings(): Promise<SettingsDocument> {
  const existing = await Settings.findOne({ key: "global" });
  if (existing) return existing;
  return Settings.create({ key: "global" });
}
