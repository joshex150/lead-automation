import mongoose, { Schema, type Document, type Model } from "mongoose";
import { OUTREACH_CHANNELS, type OutreachChannel } from "../types.js";

export type PipelineJobType = "FULL" | "DISCOVERY" | "PROCESS" | "RESUME_DISCOVERY" | "REWRITE_PITCHES";
export type PipelineJobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED";
export type PipelineJobPhase = "QUEUED" | "DISCOVERY" | "PROCESSING" | "PITCHING" | "COMPLETE";

export interface PipelineJobDocument extends Document {
  type: PipelineJobType;
  trigger: "CRON" | "MANUAL" | "API";
  status: PipelineJobStatus;
  phase: PipelineJobPhase;
  /** Present only while active. A sparse unique index prevents duplicate jobs. */
  activeKey?: "pipeline";
  searchRunId?: mongoose.Types.ObjectId;
  resumedFromRunId?: mongoose.Types.ObjectId;
  startedAt?: Date;
  finishedAt?: Date;
  heartbeatAt: Date;
  /**
   * When the work last actually moved.
   *
   * The heartbeat only proves the process is alive. It is written by a timer,
   * so a run wedged on a request that never returns keeps beating and never
   * looks stale: one sat on the overview for most of a day that way. This
   * advances only when a counter does, which is what "still working" means.
   */
  progressAt: Date;
  /** Set by the operator to stop a run that is going nowhere. */
  cancelRequested?: boolean;
  /**
   * Which channels a REWRITE_PITCHES job was pointed at.
   *
   * Kept on the job because the run is the only record of what was rewritten:
   * the leads themselves come out looking like any other AI-written lead.
   */
  pitchScope?: { channels?: OutreachChannel[] };
  progress: {
    /**
     * One monotonic 0-100 for the whole job, phases included.
     *
     * `current` and `total` still say what the phase is counting, which is
     * queries during discovery and leads during processing. This is what the
     * bar is drawn from, because those two are not comparable across a phase
     * change and the bar used to fall back to zero at one.
     */
    percent: number;
    current: number;
    total: number;
    message: string;
    found: number;
    created: number;
    /** Already known, so found but not created. Explains the gap in the report. */
    duplicates: number;
    suppressed: number;
    failedQueries: number;
    processed: number;
    qualified: number;
    processingErrors: number;
    aiFallbacks: number;
    /** REWRITE_PITCHES: leads that went from the built-in template to AI. */
    rewritten: number;
    /** Messages served from a group rather than bought again. Credits saved. */
    reusedMessages: number;
  };
  error?: string;
  /**
   * When the operator dismissed the report of this run.
   *
   * A run that ended badly keeps saying so on the overview, which is right
   * until it has been read. Without this there was no way to put it down: the
   * warning stayed until some later run happened to replace it.
   */
  acknowledgedAt?: Date;
}

const pipelineJobSchema = new Schema<PipelineJobDocument>(
  {
    type: {
      type: String,
      enum: ["FULL", "DISCOVERY", "PROCESS", "RESUME_DISCOVERY", "REWRITE_PITCHES"],
      required: true,
    },
    trigger: { type: String, enum: ["CRON", "MANUAL", "API"], default: "API" },
    status: {
      type: String,
      enum: ["QUEUED", "RUNNING", "COMPLETED", "PARTIAL", "FAILED", "CANCELLED"],
      default: "QUEUED",
      index: true,
    },
    phase: {
      type: String,
      enum: ["QUEUED", "DISCOVERY", "PROCESSING", "PITCHING", "COMPLETE"],
      default: "QUEUED",
    },
    activeKey: { type: String, enum: ["pipeline"] },
    searchRunId: { type: Schema.Types.ObjectId, ref: "SearchRun" },
    resumedFromRunId: { type: Schema.Types.ObjectId, ref: "SearchRun" },
    startedAt: Date,
    finishedAt: Date,
    heartbeatAt: { type: Date, default: Date.now },
    progressAt: { type: Date, default: Date.now },
    cancelRequested: { type: Boolean, default: false },
    pitchScope: {
      channels: { type: [String], enum: OUTREACH_CHANNELS, default: undefined },
    },
    progress: {
      percent: { type: Number, default: 0 },
      current: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
      message: { type: String, default: "Queued" },
      found: { type: Number, default: 0 },
      created: { type: Number, default: 0 },
      duplicates: { type: Number, default: 0 },
      suppressed: { type: Number, default: 0 },
      failedQueries: { type: Number, default: 0 },
      processed: { type: Number, default: 0 },
      qualified: { type: Number, default: 0 },
      processingErrors: { type: Number, default: 0 },
      aiFallbacks: { type: Number, default: 0 },
      rewritten: { type: Number, default: 0 },
      reusedMessages: { type: Number, default: 0 },
    },
    error: String,
    acknowledgedAt: Date,
  },
  { timestamps: true },
);

pipelineJobSchema.index({ activeKey: 1 }, { unique: true, sparse: true });
pipelineJobSchema.index({ createdAt: -1 });

export const PipelineJob: Model<PipelineJobDocument> =
  (mongoose.models.PipelineJob as Model<PipelineJobDocument>) ??
  mongoose.model<PipelineJobDocument>("PipelineJob", pipelineJobSchema);
