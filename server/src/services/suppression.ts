import { Suppression } from "../models/Suppression.js";
import { Lead, type LeadDocument } from "../models/Lead.js";
import { OutreachLog } from "../models/OutreachLog.js";
import { extractDomain } from "../utils/url.js";
import type { SuppressionType } from "../types.js";

/**
 * Suppression list logic, the compliance backbone.
 * A lead is suppressed if ANY of its identifiers (place id, email,
 * phone, domain, instagram) matches an entry.
 */

export function normalizeSuppressionValue(type: SuppressionType, value: string): string {
  const v = value.trim();
  switch (type) {
    case "EMAIL":
      return v.toLowerCase();
    case "INSTAGRAM":
      return v.replace(/^@/, "").toLowerCase();
    case "DOMAIN":
      return extractDomain(v) ?? v.toLowerCase();
    case "PHONE":
      return v.replace(/[^\d+]/g, "");
    default:
      return v;
  }
}

export interface LeadIdentifiers {
  googlePlaceId?: string | null;
  email?: string | null;
  phoneNormalized?: string | null;
  websiteUrl?: string | null;
  instagramUsername?: string | null;
}

export async function isSuppressed(ids: LeadIdentifiers): Promise<{ suppressed: boolean; match?: string }> {
  const clauses: Array<{ type: SuppressionType; value: string }> = [];
  if (ids.googlePlaceId) clauses.push({ type: "PLACE_ID", value: ids.googlePlaceId });
  if (ids.email) clauses.push({ type: "EMAIL", value: ids.email.toLowerCase() });
  if (ids.phoneNormalized) clauses.push({ type: "PHONE", value: ids.phoneNormalized });
  if (ids.instagramUsername) clauses.push({ type: "INSTAGRAM", value: ids.instagramUsername.toLowerCase() });
  const domain = extractDomain(ids.websiteUrl);
  if (domain) clauses.push({ type: "DOMAIN", value: domain });

  if (clauses.length === 0) return { suppressed: false };

  const hit = await Suppression.findOne({ $or: clauses }).lean();
  if (!hit) return { suppressed: false };
  return { suppressed: true, match: `${hit.type}:${hit.value}` };
}

/**
 * Opt a lead out: mark the lead, add all its identifiers to the
 * suppression list, and log the event. Called when someone objects
 * (NDPA right to object) or replies "unsubscribe".
 */
export async function optOutLead(lead: LeadDocument, reason: string, source = "manual"): Promise<void> {
  lead.optedOut = true;
  lead.optOutAt = new Date();
  lead.optOutReason = reason;
  lead.outreachStatus = "DO_NOT_CONTACT";
  lead.pipelineStage = "ARCHIVED";
  lead.followUpAt = undefined;
  await lead.save();

  const entries: Array<{ type: SuppressionType; value: string }> = [];
  if (lead.googlePlaceId) entries.push({ type: "PLACE_ID", value: lead.googlePlaceId });
  if (lead.email) entries.push({ type: "EMAIL", value: lead.email.toLowerCase() });
  if (lead.phoneNormalized) entries.push({ type: "PHONE", value: lead.phoneNormalized });
  if (lead.instagramUsername) entries.push({ type: "INSTAGRAM", value: lead.instagramUsername.toLowerCase() });
  const domain = extractDomain(lead.websiteUrl);
  if (domain) entries.push({ type: "DOMAIN", value: domain });

  for (const entry of entries) {
    await Suppression.updateOne(
      { type: entry.type, value: normalizeSuppressionValue(entry.type, entry.value) },
      {
        $setOnInsert: {
          reason,
          source,
          leadId: lead._id,
        },
      },
      { upsert: true },
    );
  }

  await OutreachLog.create({
    leadId: lead._id,
    channel: "SYSTEM",
    direction: "INTERNAL",
    action: "OPT_OUT",
    message: reason,
    meta: { source },
  });
}

/** Applies a new suppression entry retroactively to matching leads. */
export async function applySuppressionToLeads(type: SuppressionType, value: string): Promise<number> {
  const normalized = normalizeSuppressionValue(type, value);
  const query: Record<string, unknown> = {};
  switch (type) {
    case "EMAIL":
      query.email = normalized;
      break;
    case "PHONE":
      query.phoneNormalized = normalized;
      break;
    case "INSTAGRAM":
      query.instagramUsername = normalized;
      break;
    case "PLACE_ID":
      query.googlePlaceId = normalized;
      break;
    case "DOMAIN":
      query.websiteUrl = { $regex: normalized.replace(/\./g, "\\."), $options: "i" };
      break;
  }
  const result = await Lead.updateMany(
    { ...query, optedOut: { $ne: true } },
    {
      $set: {
        optedOut: true,
        optOutAt: new Date(),
        optOutReason: `Suppression list entry (${type})`,
        outreachStatus: "DO_NOT_CONTACT",
        pipelineStage: "ARCHIVED",
      },
      $unset: { followUpAt: 1 },
    },
  );
  return result.modifiedCount;
}
