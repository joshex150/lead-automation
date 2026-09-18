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

export type LeadMaturity = "NEW" | "EMERGING" | "ESTABLISHED" | "UNKNOWN";
export type DiscoverySource = "google_places" | "manual_import" | "directory" | string;
export interface ScoreBreakdownEntry {
  rule: string;
  points: number;
}

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
  discoverySource: DiscoverySource;
  discoveredAt?: string;
  maturity: LeadMaturity;
  firstSeenAt?: string;
  newToGoogle: boolean;
  ratingObservations: Array<{ at: string; count: number; rating?: number }>;
  ratingVelocity?: number;
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
  needScore: number;
  reachScore: number;
  priorityScore: number;
  scoreBreakdown: ScoreBreakdownEntry[];
  needBreakdown: ScoreBreakdownEntry[];
  reachBreakdown: ScoreBreakdownEntry[];
  personalisedObservation?: string;
  pitchSubject?: string;
  pitchMessage?: string;
  pitchModel?: string;
  /** Written once for a whole situation, with this business's name filled in. */
  pitchShared?: boolean;
  pitchGroupKey?: string;
  pitchFallbackReason?: string;
  outreachChannel: "EMAIL" | "INSTAGRAM_MANUAL" | "WHATSAPP" | "NONE";
  pipelineStage: PipelineStage;
  /** 0-100 confidence that the stored address reaches the owner. */
  emailConfidence?: number;
  /** Why that confidence, in words. */
  emailAssessment?: string;
  /** Addresses found on the site but judged to belong to somebody else. */
  rejectedEmails?: Array<{ value: string; reason: string }>;
  /** Addresses a message has already bounced from. */
  bouncedEmails?: string[];
  /** Why the pipeline last failed on this lead, if it did. */
  lastProcessingError?: string;
  /** How many times processing has thrown. Three is where retrying stops. */
  processingAttempts?: number;
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
  /**
   * Cumulative, never current-state: each figure counts the leads that reached
   * that point *or went past it*. A converted lead is still counted as
   * contacted, which is what makes the funnel narrow from top to bottom and the
   * rates between steps land under 100%.
   */
  totals: {
    /** Every business on file, opted out or not. The page heading's figure. */
    total: number;
    /** The funnel's first step: everything still in play. */
    discovered: number;
    /** Exactly what the approval queue lists, so the badge and the page agree. */
    pendingApproval: number;
    qualified: number;
    approved: number;
    contacted: number;
    responded: number;
    interested: number;
    converted: number;
    optedOut: number;
  };
  /** The need score at which a lead qualifies, so links can reproduce it. */
  qualificationThreshold: number;
  revenue: { totalDealValue: number; convertedDeals: number };
  byStage: Record<string, number>;
  byWebsiteType: Record<string, number>;
  byCity: Record<string, number>;
  byOutreachStatus: Record<string, number>;
  bySource: Record<string, number>;
  /** How the approval queue splits by outreach channel. */
  queueByChannel?: Record<string, number>;
  /** Today's sending budget, so the cap is known before a send is attempted. */
  email?: { sentToday: number; dailyCap: number; remaining: number };
  onboardedAt: string | null;
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

export type PipelineJobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED";

export interface PipelineJob {
  _id: string;
  type: "FULL" | "DISCOVERY" | "PROCESS" | "RESUME_DISCOVERY";
  status: PipelineJobStatus;
  phase: "QUEUED" | "DISCOVERY" | "PROCESSING" | "COMPLETE";
  searchRunId?: string;
  resumedFromRunId?: string;
  startedAt?: string;
  finishedAt?: string;
  heartbeatAt: string;
  progress: {
    /** One monotonic 0-100 for the whole job. Absent on jobs from older builds. */
    percent?: number;
    current: number;
    total: number;
    message: string;
    found: number;
    created: number;
    failedQueries: number;
    processed: number;
    qualified: number;
    duplicates: number;
    suppressed: number;
    processingErrors: number;
    aiFallbacks: number;
  };
  error?: string;
  /** Set once the operator has dismissed the report of a run that went wrong. */
  acknowledgedAt?: string;
  /** When a counter last moved. Silence here, not in the heartbeat, means wedged. */
  progressAt?: string;
}

export interface PipelineOperationalStatus {
  activeJob: PipelineJob | null;
  latestJob: PipelineJob | null;
  discoveredPending: number;
  /** Qualified leads still waiting for a message to be written. */
  pitchPending?: number;
  /** Leads that failed processing often enough that nothing retries them. */
  stalledLeads?: number;
  resumableRun: {
    runId: string;
    status: string;
    recoverableQueries: number;
    startedAt: string;
  } | null;
}

export interface AnalyticsStats {
  window: {
    days: number | "all";
    label: string;
    from: string | null;
    to: string;
  };
  qualificationThreshold: number;
  totals: {
    total: number;
    qualified: number;
    newBusinesses: number;
    emergingBusinesses: number;
    newToGoogle: number;
    openingSoon: number;
    risingActivity: number;
    contactableAny: number;
    contactableNone: number;
    contacted: number;
    interested: number;
    converted: number;
  };
  revenue: { totalDealValue: number; convertedDeals: number };
  contactability: Record<"email" | "phone" | "whatsapp" | "instagram" | "any" | "none", number>;
  scores: {
    averageNeed: number;
    averageReach: number;
    averagePriority: number;
    needBuckets: Record<string, number>;
    reachBuckets: Record<string, number>;
  };
  /** Ordered pipeline stages, each carrying how much of the previous survived. */
  funnel: Array<{
    id: string;
    label: string;
    count: number;
    fromPrevious: number;
    ofDiscovered: number;
    dropped: number;
  }>;
  /** Discovery over the window. The bucket widens as the window does. */
  timeline: {
    bucket: "day" | "week" | "month";
    points: Array<{ date: string; discovered: number; qualified: number }>;
  };
  qualificationByCity: QualificationRate[];
  qualificationByCategory: QualificationRate[];
  byMaturity: Record<string, number>;
  bySource: Record<string, number>;
  byCity: Record<string, number>;
  byCategory: Record<string, number>;
  byWebsiteType: Record<string, number>;
  recentRuns: Stats["recentRuns"];
}

/** How much of a group was worth pitching, not just how big the group is. */
export interface QualificationRate {
  name: string;
  total: number;
  qualified: number;
  rate: number;
}

export interface SuppressionEntry {
  _id: string;
  type: string;
  value: string;
  reason?: string;
  source: string;
  createdAt: string;
}

export type AiProvider = "AUTO" | "OPENAI" | "ANTHROPIC" | "GROQ" | "NVIDIA" | "CUSTOM" | "NONE";
export type EmailProviderName = "AUTO" | "GMAIL" | "ZOHO" | "RESEND" | "NONE";

export interface IntegrationSettings {
  googlePlacesApiKey: string;
  ai: { provider: AiProvider; apiKey: string; model: string; requestsPerMinute: number; baseUrl: string };
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
  sources: {
    manualImportEnabled: boolean;
    directory: { enabled: boolean; urls: string[]; defaultCity: string; defaultCategory: string; maxPerRun: number };
  };
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
  placesRequestsPerMinute: number;
  integrations: IntegrationSettings;
  /** Optional so a dashboard talking to an older server still typechecks. */
  pitch?: { reuseAcrossSimilarLeads?: boolean };
  /** ISO-2 country a phone number without a country code is read as. */

  onboardedAt: string | null;
}

export interface ImportRow {
  businessName: string;
  category?: string;
  city?: string;
  email?: string;
  phone?: string;
  instagramUsername?: string;
  websiteUrl?: string;
}

export interface ImportResult {
  received: number;
  created: number;
  duplicates: number;
  suppressed: number;
  invalid: number;
  processing?: { qualified: number };
  /** Set when the leads were saved but could not be processed right away. */
  processingError?: string;
  /** Set when the batch was too large to audit inline and was left queued. */
  processingDeferred?: boolean;
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
