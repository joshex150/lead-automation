import { Router } from "express";
import { z } from "zod";
import { Suppression } from "../models/Suppression.js";
import { asyncHandler, validateBody } from "../middleware/index.js";
import { applySuppressionToLeads, normalizeSuppressionValue } from "../services/suppression.js";
import { SUPPRESSION_TYPES } from "../types.js";

export const suppressionRouter = Router();

/** GET /api/suppression, list entries. */
suppressionRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const page = Math.max(Number(req.query.page ?? 1), 1);
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const [items, total] = await Promise.all([
      Suppression.find()
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Suppression.countDocuments(),
    ]);
    res.json({ items, total, page, pages: Math.ceil(total / limit) });
  }),
);

/** POST /api/suppression, add an entry (and retroactively archive matching leads). */
suppressionRouter.post(
  "/",
  validateBody(
    z.object({
      type: z.enum(SUPPRESSION_TYPES),
      value: z.string().min(1),
      reason: z.string().optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const { type, value, reason } = req.body as {
      type: (typeof SUPPRESSION_TYPES)[number];
      value: string;
      reason?: string;
    };
    const normalized = normalizeSuppressionValue(type, value);
    const entry = await Suppression.findOneAndUpdate(
      { type, value: normalized },
      { $setOnInsert: { reason: reason ?? "Added manually", source: "manual" } },
      { upsert: true, new: true },
    );
    const affectedLeads = await applySuppressionToLeads(type, normalized);
    res.status(201).json({ entry, affectedLeads });
  }),
);

/** DELETE /api/suppression/:id */
suppressionRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const deleted = await Suppression.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Entry not found" });
    res.json({ deleted: true });
  }),
);
