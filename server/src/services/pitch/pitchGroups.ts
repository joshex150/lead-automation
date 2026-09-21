import {
  buildPrompt,
  generatePitch,
  parsePitchJson,
  runAiPromptWithRetry,
  recordAiProviderFailure,
  suggestedSolutionFor,
  templatePitch,
  type PitchContext,
} from "./generatePitch.js";
import { getAiRuntime } from "../../config/runtime.js";
import { CHANNEL_LABELS } from "../outreach/channel.js";
import { logger } from "../../utils/logger.js";
import type { OutreachChannel, PitchResult } from "../../types.js";

/**
 * One message per situation, personalised per business.
 *
 * A scan of a Nigerian city turns up hundreds of businesses, and most of them
 * are in the same handful of situations: a fashion store in Lagos with no
 * website, a restaurant in Abuja whose site is down. Writing each of those from
 * scratch costs an AI call per lead and produces messages that differ only in
 * the name. Grouping them costs one call per situation.
 *
 * What it does NOT do is send the same text to everyone. The model is asked for
 * a message with `{{business}}` and `{{city}}` in it, and those are filled per
 * lead, so every recipient still sees their own name and town. Anything the
 * model wrote that does not contain those markers is rejected and that lead
 * falls back to an individual pitch, because a message that greets the wrong
 * business is worse than an expensive one.
 *
 * Leads carrying real specifics, an Instagram bio or a recent post worth
 * mentioning, are never grouped: that detail is the whole value of the message.
 */

const BUSINESS_TOKEN = "{{business}}";
const CITY_TOKEN = "{{city}}";

/** Everything the message actually talks about, and nothing else. */
export function pitchGroupKey(ctx: PitchContext): string {
  return [
    ctx.category.trim().toLowerCase(),
    ctx.websiteType,
    ctx.outreachChannel,
    ctx.openingSoon ? "opening" : "trading",
  ].join("|");
}

/** A lead with its own specifics deserves its own message. */
export function hasOwnSpecifics(ctx: PitchContext): boolean {
  return Boolean(ctx.recentPostSummary?.trim() || ctx.instagramBio?.trim());
}

function groupPrompt(ctx: PitchContext): string {
  const solution = suggestedSolutionFor(ctx.category);
  const channel = CHANNEL_LABELS[ctx.outreachChannel as OutreachChannel] ?? "message";

  // The individual prompt carries all the house style rules. Reusing it keeps
  // the two paths writing in the same voice instead of drifting apart.
  const base = buildPrompt(ctx);
  const styleRules = base.slice(base.indexOf("Rules:"), base.indexOf("Respond with ONLY"));

  return `You write short, warm B2B outreach for YEAN Technologies, a Nigerian web-design studio that builds custom websites for local businesses.

Write ONE reusable ${channel} that will be sent to several different businesses that are all in the same situation:

Category: ${ctx.category}
Website situation (${ctx.websiteType}): ${ctx.websiteProblem}
${ctx.openingSoon ? "All of these businesses recently opened or are opening soon. Congratulate them briefly." : ""}
Suggested YEAN solution: ${solution}

Because the message is reused, write it with two placeholders:
- ${BUSINESS_TOKEN} wherever the business name belongs
- ${CITY_TOKEN} wherever the city belongs

The message must open with a greeting naming the business, "Hello ${BUSINESS_TOKEN}," on its own line, followed by a blank line. Use ${CITY_TOKEN} at least once. Invent no other placeholders and no other business-specific facts: everything else in the message must be true of every business in this situation.

${styleRules}
- The observation must be about the SITUATION, since you have not seen any individual business.

Respond with ONLY valid JSON, no markdown fences:
{"observation": "<the one-sentence observation you opened with>", "subject": "<subject line, max 9 words, may contain ${BUSINESS_TOKEN}>", "message": "<the full message body>"}`;
}

/** Substitutes the per-lead facts back into a reusable message. */
export function fillPlaceholders(text: string, ctx: PitchContext): string {
  return text.split(BUSINESS_TOKEN).join(ctx.businessName).split(CITY_TOKEN).join(ctx.city);
}

/** A reusable message is only usable if it is addressed to somebody. */
export function isUsableTemplate(parsed: { subject: string; message: string }): boolean {
  if (!parsed.message.includes(BUSINESS_TOKEN)) return false;
  // Any other {{...}} is a placeholder we cannot fill, and would ship literally.
  const unknown = `${parsed.subject} ${parsed.message}`
    .match(/\{\{[^}]*\}\}/g)
    ?.filter((token) => token !== BUSINESS_TOKEN && token !== CITY_TOKEN);
  return !unknown || unknown.length === 0;
}

export interface GroupedPitch extends PitchResult {
  /** Set when this message came from a group rather than from a lone call. */
  groupKey?: string;
  shared?: boolean;
}

/**
 * Hands out pitches for a run, reusing one message per situation.
 *
 * Scoped to a single processing pass rather than persisted: a stored template
 * would keep serving text written against last month's copy long after the
 * house style, the solution wording or the model changed.
 */
export interface PitchGroupCacheOptions {
  /**
   * Probe the provider even while the bulk-work circuit is open.
   *
   * Set when an operator asked for these messages by hand. The circuit exists
   * to stop a scan hammering a provider that is already failing, and a run
   * started long after that outage would otherwise open on a stale cooldown
   * and quietly template every lead it was asked to rewrite.
   */
  forceProviderAttempt?: boolean;
}

export class PitchGroupCache {
  private readonly templates = new Map<string, { subject: string; message: string; observation: string; provider: string; model: string } | null>();
  private reused = 0;
  private generated = 0;

  constructor(
    private readonly enabled: boolean,
    private readonly options: PitchGroupCacheOptions = {},
  ) {}

  get stats(): { reused: number; generated: number } {
    return { reused: this.reused, generated: this.generated };
  }

  async pitchFor(ctx: PitchContext): Promise<GroupedPitch> {
    if (!this.enabled || hasOwnSpecifics(ctx)) {
      this.generated++;
      return generatePitch(ctx, this.options);
    }

    const ai = await getAiRuntime();
    if (!ai.configured) {
      // The template pitch is already one message per situation, so there is
      // nothing to save here and nothing to share.
      this.generated++;
      return generatePitch(ctx, this.options);
    }

    const key = pitchGroupKey(ctx);

    if (this.templates.has(key)) {
      const cached = this.templates.get(key);
      if (!cached) {
        // This group already failed once. Do not pay for it again per lead.
        this.generated++;
        return generatePitch(ctx, this.options);
      }
      this.reused++;
      return {
        subject: fillPlaceholders(cached.subject, ctx),
        message: fillPlaceholders(cached.message, ctx),
        observation: fillPlaceholders(cached.observation, ctx),
        provider: cached.provider,
        model: cached.model,
        groupKey: key,
        shared: true,
      };
    }

    try {
      const result = await runAiPromptWithRetry(groupPrompt(ctx), ai);
      const parsed = parsePitchJson(result.text);
      if (!isUsableTemplate(parsed)) {
        throw new Error("reusable message did not carry the business name placeholder");
      }
      this.templates.set(key, { ...parsed, provider: result.provider, model: result.model });
      this.generated++;
      return {
        subject: fillPlaceholders(parsed.subject, ctx),
        message: fillPlaceholders(parsed.message, ctx),
        observation: fillPlaceholders(parsed.observation, ctx),
        provider: result.provider,
        model: result.model,
        groupKey: key,
        shared: true,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // Only a provider fault should open the circuit. A template we rejected
      // is our own rule, and must not stop the rest of the run from using AI.
      if (!/placeholder/.test(reason)) recordAiProviderFailure(ai, err);
      this.templates.set(key, null);
      logger.warn({ err: reason, group: key }, "shared pitch failed, writing this lead its own");
      this.generated++;
      return { ...templatePitch(ctx), fallbackReason: reason };
    }
  }
}
