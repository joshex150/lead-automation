import type { OutreachChannel } from "../../types.js";

/**
 * One definition of "the approval queue", shared by the list and the counts.
 *
 * It used to be written out twice: once as query parameters from the dashboard
 * and once as an aggregation in the stats route, and the two never agreed. The
 * stats copy counted opted-out leads and the list did not, so the tally on the
 * Email button and the number of cards under it were different figures, and the
 * badge in the sidebar was a third.
 */

/** Channels that can actually carry a message today. */
export const REACHABLE_CHANNELS: OutreachChannel[] = ["EMAIL", "INSTAGRAM_MANUAL", "WHATSAPP"];

/**
 * Everything still waiting on the operator.
 *
 * Two kinds of work, not one. A lead awaiting a decision is obvious. A lead
 * already approved whose message has not gone out is the one that used to get
 * lost: approving it flipped `approval.status` to APPROVED, which dropped it
 * straight out of a queue filtered on PENDING, and the card carrying the only
 * Send button in the application disappeared with it. Nothing else looked for
 * those leads, so an approved pitch could never be sent.
 *
 * A lead leaves on its own terms: rejected, sent, or marked contacted by hand.
 */
export function queueWorkFilter(options: { reachableOnly?: boolean } = {}): Record<string, unknown> {
  return {
    optedOut: { $ne: true },
    pipelineStage: { $in: ["PENDING_APPROVAL", "APPROVED"] },
    "approval.status": { $in: ["PENDING", "APPROVED"] },
    outreachStatus: { $in: ["NOT_CONTACTED", "DRAFT_CREATED"] },
    // The card is a pitch review, so a lead with no message is not yet work.
    // draftPendingPitches finishes those; counting them here would advertise
    // a queue the operator opens to find empty.
    pitchMessage: { $nin: [null, ""] },
    ...(options.reachableOnly ? { outreachChannel: { $in: REACHABLE_CHANNELS } } : {}),
  };
}
