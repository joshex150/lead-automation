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

export type AiProvider = "AUTO" | "OPENAI" | "ANTHROPIC" | "NVIDIA" | "CUSTOM" | "NONE";
export type EmailProviderName = "AUTO" | "GMAIL" | "ZOHO" | "RESEND" | "NONE";

export interface AiSettings {
  provider: AiProvider;
  apiKey: string;
  model: string;
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

export interface IntegrationSettings {
  googlePlacesApiKey: string;
  ai: AiSettings;
  email: EmailSettings;
  scheduler: SchedulerSettings;
  checker: CheckerSettings;
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
  integrations: IntegrationSettings;
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
      publicEmail: { type: Number, default: DEFAULT_SCORING_WEIGHTS.publicEmail },
      whatsappAvailable: { type: Number, default: DEFAULT_SCORING_WEIGHTS.whatsappAvailable },
      recentlyOpened: { type: Number, default: DEFAULT_SCORING_WEIGHTS.recentlyOpened },
      activeInstagram: { type: Number, default: DEFAULT_SCORING_WEIGHTS.activeInstagram },
      strongVisualBrand: { type: Number, default: DEFAULT_SCORING_WEIGHTS.strongVisualBrand },
      customWebsitePenalty: { type: Number, default: DEFAULT_SCORING_WEIGHTS.customWebsitePenalty },
      poorWebsite: { type: Number, default: DEFAULT_SCORING_WEIGHTS.poorWebsite },
      menuPlatformOnly: { type: Number, default: DEFAULT_SCORING_WEIGHTS.menuPlatformOnly },
    },
    followUpDays: { type: Number, default: config.FOLLOW_UP_DAYS },
    maxContactAttempts: { type: Number, default: config.MAX_CONTACT_ATTEMPTS },
    dailyEmailCap: { type: Number, default: config.DAILY_EMAIL_CAP },
    discoveryEnabled: { type: Boolean, default: true },
    maxResultsPerQuery: { type: Number, default: 60 },
    integrations: {
      googlePlacesApiKey: { type: String, default: "" },
      ai: {
        provider: {
          type: String,
          enum: ["AUTO", "OPENAI", "ANTHROPIC", "NVIDIA", "CUSTOM", "NONE"],
          default: "AUTO",
        },
        apiKey: { type: String, default: "" },
        model: { type: String, default: "" },
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
    },
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
