import mongoose, { Schema, type Document, type Model } from "mongoose";
import { SUPPRESSION_TYPES, type SuppressionType } from "../types.js";

/**
 * Suppression list, anyone here is never contacted again.
 * Entries can be an email, a phone (E.164), a domain, an Instagram
 * username, or a Google Place ID. Values are stored normalized
 * (lowercase / E.164) so lookups are exact-match.
 */
export interface SuppressionDocument extends Document {
  type: SuppressionType;
  value: string;
  reason?: string;
  source: string; // "manual", "opt_out_reply", "bounce", "import"
  leadId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const suppressionSchema = new Schema<SuppressionDocument>(
  {
    type: { type: String, enum: SUPPRESSION_TYPES, required: true },
    value: { type: String, required: true, trim: true },
    reason: String,
    source: { type: String, default: "manual" },
    leadId: { type: Schema.Types.ObjectId, ref: "Lead" },
  },
  { timestamps: true },
);

suppressionSchema.index({ type: 1, value: 1 }, { unique: true });

export const Suppression: Model<SuppressionDocument> =
  (mongoose.models.Suppression as Model<SuppressionDocument>) ??
  mongoose.model<SuppressionDocument>("Suppression", suppressionSchema);
