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
  field: "email" | "phone" | "whatsapp" | "instagram";
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
  scoreBreakdown: ScoreBreakdownEntry[];
  scoredAt?: Date;

  // Pitch
  personalisedObservation?: string;
  pitchSubject?: string;
  pitchMessage?: string;
  pitchGeneratedAt?: Date;
  pitchModel?: string;

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
    field: { type: String, enum: ["email", "phone", "whatsapp", "instagram"], required: true },
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
    scoreBreakdown: { type: [{ rule: String, points: Number, _id: false }], default: [] },
    scoredAt: Date,

    personalisedObservation: String,
    pitchSubject: String,
    pitchMessage: String,
    pitchGeneratedAt: Date,
    pitchModel: String,

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

export const Lead: Model<LeadDocument> =
  (mongoose.models.Lead as Model<LeadDocument>) ?? mongoose.model<LeadDocument>("Lead", leadSchema);
