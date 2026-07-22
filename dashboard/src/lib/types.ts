/** Types mirrored from the server API. */

export type WebsiteType =
  | "NO_WEBSITE"
  | "BROKEN_WEBSITE"
  | "SHOPIFY"
  | "LINK_IN_BIO_ONLY"
  | "MENU_PLATFORM_ONLY"
  | "SOCIAL_MEDIA_ONLY"
  | "CUSTOM_WEBSITE"
  | "POOR_WEBSITE";

export type PipelineStage =
  | "DISCOVERED"
  | "CHECKED"
  | "ENRICHED"
  | "SCORED"
  | "QUALIFIED"
  | "DISQUALIFIED"
  | "PITCH_READY"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "CONTACTED"
  | "ARCHIVED";

export type OutreachStatus =
  | "NOT_CONTACTED"
  | "DRAFT_CREATED"
  | "CONTACTED"
  | "FOLLOW_UP_SENT"
  | "RESPONDED"
  | "INTERESTED"
  | "NOT_INTERESTED"
  | "CONVERTED"
  | "DO_NOT_CONTACT";

export interface Lead {
  _id: string;
  businessName: string;
  category: string;
  city: string;
  address?: string;
  googlePlaceId?: string;
  googleMapsUrl?: string;
  businessStatus?: string;
  openingSoon: boolean;
  rating?: number;
  userRatingCount?: number;
  phone?: string;
  phoneNormalized?: string;
  whatsappAvailable: boolean;
  email?: string;
  instagramUsername?: string;
  instagramUrl?: string;
  instagramBio?: string;
  instagramActive: boolean;
  strongVisualBrand: boolean;
  recentPostSummary?: string;
  websiteUrl?: string;
  websiteType: WebsiteType;
  websiteStatus: string;
  websiteProblemSummary?: string;
  websiteCheck?: {
    finalUrl?: string;
    httpStatus?: number;
    responseTimeMs?: number;
    issues?: string[];
    shopifyIndicators?: string[];
    platform?: string;
    error?: string;
    checkedAt?: string;
  };
  leadScore: number;
  scoreBreakdown: Array<{ rule: string; points: number }>;
  personalisedObservation?: string;
  pitchSubject?: string;
  pitchMessage?: string;
  pitchModel?: string;
  outreachChannel: "EMAIL" | "INSTAGRAM_MANUAL" | "WHATSAPP" | "NONE";
  pipelineStage: PipelineStage;
  outreachStatus: OutreachStatus;
  approval: { status: "NONE" | "PENDING" | "APPROVED" | "REJECTED"; reviewedAt?: string; notes?: string };
  gmailDraftId?: string;
  timesContacted: number;
  lastContactedAt?: string;
  followUpAt?: string;
  responseStatus: string;
  estimatedDealValue?: number;
  optedOut: boolean;
  notes?: string;
  tags: string[];
  contactSources: Array<{ field: string; value: string; source: string; sourceUrl?: string; collectedAt: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface OutreachLogEntry {
  _id: string;
  channel: string;
  direction: string;
  action: string;
  subject?: string;
  message?: string;
  createdAt: string;
  leadId?: { _id: string; businessName?: string; city?: string } | string;
}

export interface Stats {
  totals: {
    total: number;
    pendingApproval: number;
    contacted: number;
    interested: number;
    converted: number;
    optedOut: number;
  };
  revenue: { totalDealValue: number; convertedDeals: number };
  byStage: Record<string, number>;
  byWebsiteType: Record<string, number>;
  byCity: Record<string, number>;
  byOutreachStatus: Record<string, number>;
  recentRuns: Array<{
    _id: string;
    trigger: string;
    status: string;
    startedAt: string;
    finishedAt?: string;
    totals: { found: number; created: number; duplicates: number; suppressed: number; processed: number; qualified: number };
  }>;
  recentActivity: OutreachLogEntry[];
  integrations: {
    googlePlaces: boolean;
    ai: boolean;
    aiProvider: string;
    email: boolean;
    emailProvider: string;
    gmail: boolean;
    authEnabled: boolean;
  };
}

export interface SuppressionEntry {
  _id: string;
  type: string;
  value: string;
  reason?: string;
  source: string;
  createdAt: string;
}

export type AiProvider = "AUTO" | "OPENAI" | "ANTHROPIC" | "NVIDIA" | "CUSTOM" | "NONE";
export type EmailProviderName = "AUTO" | "GMAIL" | "ZOHO" | "RESEND" | "NONE";

export interface IntegrationSettings {
  googlePlacesApiKey: string;
  ai: { provider: AiProvider; apiKey: string; model: string; baseUrl: string };
  email: {
    provider: EmailProviderName;
    fromAddress: string;
    fromName: string;
    gmail: { clientId: string; clientSecret: string; refreshToken: string };
    zoho: { host: string; port: number; secure: boolean; user: string; password: string };
    resend: { apiKey: string };
  };
  scheduler: { enabled: boolean | null; discoveryCron: string; followUpCron: string; timezone: string };
  checker: { timeoutMs: number; maxRedirects: number; concurrency: number };
}

export interface Settings {
  cities: string[];
  categories: string[];
  scoreThreshold: number;
  scoringWeights: Record<string, number>;
  followUpDays: number;
  maxContactAttempts: number;
  dailyEmailCap: number;
  discoveryEnabled: boolean;
  maxResultsPerQuery: number;
  integrations: IntegrationSettings;
}

export interface IntegrationStatus {
  googlePlaces: { configured: boolean; source: string };
  ai: { configured: boolean; provider: string; model: string; source: string };
  email: { configured: boolean; provider: string; fromAddress: string; supportsDrafts: boolean; source: string };
  scheduler: { enabled: boolean; discoveryCron: string; followUpCron: string; timezone: string };
  authEnabled: boolean;
}

export interface TestResult {
  ok: boolean;
  provider?: string;
  model?: string;
  fromAddress?: string;
  supportsDrafts?: boolean;
  latencyMs?: number;
  reply?: string;
  sample?: string | null;
  error?: string;
}
