import mongoose, { Schema, type Document, type Model } from "mongoose";
import {
  OUTREACH_CHANNELS,
  OUTREACH_STATUSES,
  PIPELINE_STAGES,
  RESPONSE_STATUSES,
  WEBSITE_STATUSES,
  WEBSITE_TYPES,
  type OutreachChannel,
  type OutreachStatus,
  type PipelineStage,
  type ResponseStatus,
  type ScoreBreakdownEntry,
  type WebsiteStatus,
  type WebsiteType,
} from "../types.js";

/**
 * A contact-provenance record: where each piece of contact data came from.
 * Required by our compliance controls (NDPA, record the source of every
 * email / phone number we process).
 */
export interface ContactSource {
  field: "email" | "phone" | "whatsapp" | "instagram" | "website";
  value: string;
  source: string; // e.g. "google_places", "website", "link_in_bio", "manual"
  sourceUrl?: string;
  collectedAt: Date;
}

export interface WebsiteCheckSnapshot {
  inputUrl?: string | null;
  finalUrl?: string | null;
  domain?: string | null;
  dnsResolved?: boolean;
  sslValid?: boolean;
  sslError?: string | null;
  httpStatus?: number | null;
  responseTimeMs?: number | null;
  redirectChain?: string[];
  redirectLoop?: boolean;
  reachable?: boolean;
  title?: string | null;
  metaDescription?: string | null;
  hasViewport?: boolean;
  isShopify?: boolean;
  shopifyIndicators?: string[];
  platform?: string | null;
  platformKind?: string | null;
  redirectsToSocialOnly?: boolean;
  socialTarget?: string | null;
  isParkingPage?: boolean;
  brokenInternalLinks?: number;
  internalLinksChecked?: number;
  issues?: string[];
  error?: string | null;
  checkedAt?: Date;
}

export interface LeadDocument extends Document {
  // Identity
  businessName: string;
  businessNameNormalized: string;
  category: string;
  categoryRaw: string[];
  city: string;
  address?: string;
  location?: { lat: number; lng: number };

  // Discovery
  googlePlaceId?: string;
  googleMapsUrl?: string;
  businessStatus?: string;
  openingSoon: boolean;
  rating?: number;
  userRatingCount?: number;
  searchQuery?: string;
  discoverySource: string;
  discoveredAt: Date;

  // Contacts
  phone?: string;
  phoneNormalized?: string;
  whatsappAvailable: boolean;
  email?: string;
  emailVerifiedFormat: boolean;
  instagramUsername?: string;
  instagramUrl?: string;
  instagramBio?: string;
  instagramActive: boolean;
  strongVisualBrand: boolean;
  recentPostSummary?: string;
  facebookUrl?: string;
  contactSources: ContactSource[];

  // Website
  websiteUrl?: string;
  websiteType: WebsiteType;
  websiteStatus: WebsiteStatus;
  websiteProblemSummary?: string;
  websiteCheck?: WebsiteCheckSnapshot;

  // Scoring
  leadScore: number;
  /** How badly they need a website. Qualification is decided on this alone. */
  needScore: number;
  /** How contactable they are. Ranks the queue; never gates qualification. */
  reachScore: number;
  /** Blended ordering value used to sort the approval queue. */
  priorityScore: number;
  scoreBreakdown: ScoreBreakdownEntry[];
  needBreakdown: ScoreBreakdownEntry[];
  reachBreakdown: ScoreBreakdownEntry[];
  scoredAt?: Date;

  /** 0-100 confidence that the stored email reaches the owner. */
  emailConfidence?: number;
  /** Why that confidence, in words, for the queue to show. */
  emailAssessment?: string;
  /** Addresses found on the page but judged to belong to somebody else. */
  rejectedEmails: Array<{ value: string; reason: string }>;
  /**
   * Addresses a message has already bounced from.
   *
   * Kept on the lead rather than thrown away, for two reasons: enrichment must
   * not scrape the same dead address back onto the lead on the next re-check,
   * and an operator looking at a business with no email needs to see that we
   * had one and it failed, not an empty field that looks like we never tried.
   */
  bouncedEmails: string[];
  /** Set when the real site was found behind a link page or bio. */
  websiteFoundVia?: string;

  /** How many times processing has thrown for this lead. */
  processingAttempts: number;
  /** What it threw last, so a stuck lead can be diagnosed without the logs. */
  lastProcessingError?: string;

  // Recency and activity
  /** NEW / EMERGING / ESTABLISHED, inferred from review count and opening status. */
  maturity: string;
  /** First time this business appeared in any of our scans. */
  firstSeenAt?: Date;
  /** True when it appeared in a sweep of an area we had already covered. */
  newToGoogle: boolean;
  /** Review count each time we saw it, so growth can be measured over scans. */
  ratingObservations: Array<{ at: Date; count: number; rating?: number }>;
  /** Reviews gained per week since first sight. Requires two or more scans. */
  ratingVelocity?: number;

  // Pitch
  personalisedObservation?: string;
  pitchSubject?: string;
  pitchMessage?: string;
  pitchGeneratedAt?: Date;
  pitchModel?: string;
  pitchFallbackReason?: string;
  /** Which situation this message was written for, when it was shared. */
  pitchGroupKey?: string;
  /** True when the message came from a group rather than being written alone. */
  pitchShared?: boolean;

  // Outreach / CRM
  outreachChannel: OutreachChannel;
  pipelineStage: PipelineStage;
  outreachStatus: OutreachStatus;
  approval: {
    status: "NONE" | "PENDING" | "APPROVED" | "REJECTED";
    reviewedAt?: Date;
    reviewedBy?: string;
    notes?: string;
  };
  gmailDraftId?: string;
  gmailThreadId?: string;
  gmailMessageId?: string;
  timesContacted: number;
  lastContactedAt?: Date;
  followUpAt?: Date;
  followUpSentAt?: Date;
  responseStatus: ResponseStatus;
  respondedAt?: Date;
  estimatedDealValue?: number;
  convertedAt?: Date;

  // Compliance
  optedOut: boolean;
  optOutAt?: Date;
  optOutReason?: string;

  tags: string[];
  notes?: string;

  createdAt: Date;
  updatedAt: Date;
}

const contactSourceSchema = new Schema<ContactSource>(
  {
    field: { type: String, enum: ["email", "phone", "whatsapp", "instagram", "website"], required: true },
    value: { type: String, required: true },
    source: { type: String, required: true },
    sourceUrl: String,
    collectedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const websiteCheckSchema = new Schema<WebsiteCheckSnapshot>(
  {
    inputUrl: String,
    finalUrl: String,
    domain: String,
    dnsResolved: Boolean,
    sslValid: Boolean,
    sslError: String,
    httpStatus: Number,
    responseTimeMs: Number,
    redirectChain: [String],
    redirectLoop: Boolean,
    reachable: Boolean,
    title: String,
    metaDescription: String,
    hasViewport: Boolean,
    isShopify: Boolean,
    shopifyIndicators: [String],
    platform: String,
    platformKind: String,
    redirectsToSocialOnly: Boolean,
    socialTarget: String,
    isParkingPage: Boolean,
    brokenInternalLinks: Number,
    internalLinksChecked: Number,
    issues: [String],
    error: String,
    checkedAt: Date,
  },
  { _id: false },
);

const leadSchema = new Schema<LeadDocument>(
  {
    businessName: { type: String, required: true, trim: true },
    businessNameNormalized: { type: String, required: true, index: true },
    category: { type: String, required: true, index: true },
    categoryRaw: { type: [String], default: [] },
    city: { type: String, required: true, index: true },
    address: String,
    location: { lat: Number, lng: Number },

    googlePlaceId: { type: String, unique: true, sparse: true },
    googleMapsUrl: String,
    businessStatus: String,
    openingSoon: { type: Boolean, default: false },
    rating: Number,
    userRatingCount: Number,
    searchQuery: String,
    discoverySource: { type: String, default: "google_places" },
    discoveredAt: { type: Date, default: Date.now },

    phone: String,
    phoneNormalized: { type: String, index: true, sparse: true },
    whatsappAvailable: { type: Boolean, default: false },
    email: { type: String, lowercase: true, trim: true },
    emailVerifiedFormat: { type: Boolean, default: false },
    instagramUsername: { type: String, lowercase: true, trim: true },
    instagramUrl: String,
    instagramBio: String,
    instagramActive: { type: Boolean, default: false },
    strongVisualBrand: { type: Boolean, default: false },
    recentPostSummary: String,
    facebookUrl: String,
    contactSources: { type: [contactSourceSchema], default: [] },

    websiteUrl: String,
    websiteType: { type: String, enum: WEBSITE_TYPES, default: "NO_WEBSITE", index: true },
    websiteStatus: { type: String, enum: WEBSITE_STATUSES, default: "NONE" },
    websiteProblemSummary: String,
    websiteCheck: websiteCheckSchema,

    leadScore: { type: Number, default: 0, index: true },
    needScore: { type: Number, default: 0, index: true },
    reachScore: { type: Number, default: 0 },
    priorityScore: { type: Number, default: 0, index: true },
    scoreBreakdown: { type: [{ rule: String, points: Number, _id: false }], default: [] },
    needBreakdown: { type: [{ rule: String, points: Number, _id: false }], default: [] },
    reachBreakdown: { type: [{ rule: String, points: Number, _id: false }], default: [] },
    scoredAt: Date,

    emailConfidence: Number,
    emailAssessment: String,
    rejectedEmails: {
      type: [{ value: String, reason: String, _id: false }],
      default: [],
    },
    bouncedEmails: { type: [String], default: [] },
    websiteFoundVia: String,
    processingAttempts: { type: Number, default: 0 },
    lastProcessingError: String,

    maturity: { type: String, default: "UNKNOWN", index: true },
    firstSeenAt: Date,
    newToGoogle: { type: Boolean, default: false, index: true },
    ratingObservations: {
      type: [{ at: Date, count: Number, rating: Number, _id: false }],
      default: [],
    },
    ratingVelocity: Number,

    personalisedObservation: String,
    pitchSubject: String,
    pitchMessage: String,
    pitchGeneratedAt: Date,
    pitchModel: String,
    pitchFallbackReason: String,
    pitchGroupKey: String,
    pitchShared: { type: Boolean, default: false },

    outreachChannel: { type: String, enum: OUTREACH_CHANNELS, default: "NONE" },
    pipelineStage: { type: String, enum: PIPELINE_STAGES, default: "DISCOVERED", index: true },
    outreachStatus: { type: String, enum: OUTREACH_STATUSES, default: "NOT_CONTACTED", index: true },
    approval: {
      status: { type: String, enum: ["NONE", "PENDING", "APPROVED", "REJECTED"], default: "NONE" },
      reviewedAt: Date,
      reviewedBy: String,
      notes: String,
    },
    gmailDraftId: String,
    gmailThreadId: String,
    gmailMessageId: String,
    timesContacted: { type: Number, default: 0 },
    lastContactedAt: Date,
    followUpAt: { type: Date, index: true, sparse: true },
    followUpSentAt: Date,
    responseStatus: { type: String, enum: RESPONSE_STATUSES, default: "NONE" },
    respondedAt: Date,
    estimatedDealValue: Number,
    convertedAt: Date,

    optedOut: { type: Boolean, default: false },
    optOutAt: Date,
    optOutReason: String,

    tags: { type: [String], default: [] },
    notes: String,
  },
  { timestamps: true },
);

// Fallback duplicate guard for leads without a place id.
leadSchema.index({ businessNameNormalized: 1, city: 1 });
leadSchema.index({ "approval.status": 1, pipelineStage: 1 });
leadSchema.index({ createdAt: -1 });
leadSchema.index({ businessName: "text", address: "text" });

/*
 * The two reads that happen constantly.
 *
 * The approval queue is fetched by every view on a poll and its tallies are
 * counted on every stats call, and both walked the whole collection: the
 * existing approval/stage index does not cover the opt-out and channel tests
 * the queue actually makes. The second covers the recovery counts, which ask
 * for discovered-or-qualified leads under the attempt limit on every status
 * poll while a scan is running.
 */
leadSchema.index({ optedOut: 1, pipelineStage: 1, "approval.status": 1, outreachStatus: 1, outreachChannel: 1 });
leadSchema.index({ pipelineStage: 1, optedOut: 1, processingAttempts: 1 });
leadSchema.index({ optedOut: 1, needScore: -1 });

export const Lead: Model<LeadDocument> =
  (mongoose.models.Lead as Model<LeadDocument>) ?? mongoose.model<LeadDocument>("Lead", leadSchema);
