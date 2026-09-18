import { getAiRuntime, type ResolvedAi } from "../../config/runtime.js";
import { logger } from "../../utils/logger.js";
import { sleep } from "../../utils/async.js";
import { AdaptiveRateLimiter, parseRetryAfterMs } from "../../utils/rateLimiter.js";
import { truncate, shortenName } from "../../utils/text.js";
import { CHANNEL_LABELS } from "../outreach/channel.js";
import type { LeadDocument } from "../../models/Lead.js";
import type { OutreachChannel, PitchResult } from "../../types.js";

/**
 * AI pitch generation. Provider is fully configurable from the dashboard:
 * OpenAI, Anthropic, NVIDIA (NIM), or any OpenAI-compatible endpoint
 * (Groq, Together, Ollama, vLLM, …) via a custom base URL. A solid
 * deterministic template is the fallback so the pipeline never stalls on
 * an AI outage or a missing key.
 */

const CATEGORY_SOLUTIONS: Array<{ match: RegExp; solution: string }> = [
  {
    match: /restaurant|food|cafe|kitchen|eatery|grill|bar/i,
    solution:
      "a fast, mobile-first restaurant website with your full menu, online ordering and WhatsApp order buttons, so customers order directly from you instead of through commission apps",
  },
  {
    match: /hotel|resort|shortlet|apartment|suites|lodging|guest/i,
    solution:
      "a booking-ready website with room galleries, live availability and direct reservations, so guests book with you directly instead of paying OTA commissions",
  },
  {
    match: /salon|spa|barber|beauty|nail|hair/i,
    solution:
      "a sleek booking website where clients see your work, pick a service and book an appointment slot in under a minute",
  },
  {
    match: /perfume|fragrance|scent/i,
    solution:
      "a custom perfume storefront that showcases your fragrances professionally, tells your brand story and makes ordering effortless",
  },
  {
    match: /fashion|boutique|clothing|apparel|shoe|bag|accessor/i,
    solution:
      "a custom online store that presents your collections beautifully, handles payments and keeps you in full control of your brand",
  },
];

export function suggestedSolutionFor(category: string): string {
  for (const { match, solution } of CATEGORY_SOLUTIONS) {
    if (match.test(category)) return solution;
  }
  return "a professional custom website that improves your brand visibility, gives you full control over your online presence and makes it easier for customers to find and buy from you";
}

export interface PitchContext {
  businessName: string;
  category: string;
  city: string;
  websiteType: string;
  websiteProblem: string;
  instagramUsername?: string;
  instagramBio?: string;
  recentPostSummary?: string;
  outreachChannel: string;
  openingSoon: boolean;
}

export function pitchContextFromLead(lead: LeadDocument): PitchContext {
  return {
    businessName: lead.businessName,
    category: lead.category,
    city: lead.city,
    websiteType: lead.websiteType,
    websiteProblem: lead.websiteProblemSummary ?? "No meaningful web presence.",
    instagramUsername: lead.instagramUsername,
    instagramBio: lead.instagramBio,
    recentPostSummary: lead.recentPostSummary,
    outreachChannel: lead.outreachChannel === "NONE" ? "EMAIL" : lead.outreachChannel,
    openingSoon: lead.openingSoon,
  };
}

/**
 * How a message is shaped, which is not the same on every channel.
 *
 * A WhatsApp message and an email are different objects. One arrives in a chat
 * thread on a phone, where a 120-word block closing "Kind regards, The YEAN
 * Technologies team" reads as a letter somebody pasted into the wrong app, and
 * nobody replies to it. The other arrives in an inbox, where the same brevity
 * reads as curt and the sign-off is simply what business email looks like.
 *
 * Only the shape changes. The register, the house style and the ban on hype and
 * emoji are the same everywhere, because they are about who is writing, not
 * about where it lands.
 */
interface ChannelFormat {
  words: string;
  closing: string;
  extra: string[];
}

const CHANNEL_FORMATS: Record<"EMAIL" | "INSTAGRAM_MANUAL" | "WHATSAPP", ChannelFormat> = {
  EMAIL: {
    words: "70 to 120 words for the message body",
    closing: `Close formally: "Kind regards," on its own line, then "The YEAN Technologies team".`,
    extra: ["Two or three short paragraphs, separated by a blank line."],
  },
  WHATSAPP: {
    words: "45 to 80 words for the message body, because this is a chat message and a long one goes unread",
    closing: `Close with "YEAN Technologies" on its own line after a blank line. No "Kind regards" and no sign-off block: this is a chat, not a letter.`,
    extra: [
      "Two short paragraphs at most, separated by a blank line. No bullet points and no headings.",
      "Write it as one business messaging another on WhatsApp: plain, direct sentences, nothing that reads as a pasted letter.",
    ],
  },
  INSTAGRAM_MANUAL: {
    words: "45 to 80 words for the message body, because this is a direct message and a long one goes unread",
    closing: `Close with "YEAN Technologies" on its own line after a blank line. No "Kind regards" and no sign-off block: this is a DM, not a letter.`,
    extra: [
      "Two short paragraphs at most, separated by a blank line. No bullet points and no headings.",
      "Write it as one business messaging another on Instagram: plain, direct sentences, nothing that reads as a pasted letter.",
    ],
  },
};

export function formatFor(channel: string): ChannelFormat {
  return CHANNEL_FORMATS[channel as keyof typeof CHANNEL_FORMATS] ?? CHANNEL_FORMATS.EMAIL;
}

export function buildPrompt(ctx: PitchContext): string {
  const solution = suggestedSolutionFor(ctx.category);
  const format = formatFor(ctx.outreachChannel);
  return `You write short, warm, personalised B2B outreach messages for YEAN Technologies, a Nigerian web-design studio that builds custom websites for local businesses.

Write an outreach message for this business:

Business name: ${ctx.businessName}
Category: ${ctx.category}
City: ${ctx.city}
Website situation (${ctx.websiteType}): ${ctx.websiteProblem}
${ctx.instagramUsername ? `Instagram: @${ctx.instagramUsername}` : "Instagram: unknown"}
${ctx.instagramBio ? `Instagram bio: ${truncate(ctx.instagramBio, 200)}` : ""}
${ctx.recentPostSummary ? `Recent post/product: ${truncate(ctx.recentPostSummary, 200)}` : ""}
${ctx.openingSoon ? "Note: this business recently opened or is opening soon. Congratulate them briefly." : ""}
Suggested YEAN solution: ${solution}
Channel: ${CHANNEL_LABELS[ctx.outreachChannel as OutreachChannel] ?? "message"}

Rules:
- Begin with a greeting that names the business: "Hello ${ctx.businessName}," or "Hi ${ctx.businessName},", on its own line, then a blank line. Every message opens this way.
- After the greeting, lead with a specific, genuine observation about THEIR business (use the website situation${ctx.recentPostSummary ? " or their recent post" : ""}). Never open with "I hope this finds you well".
- ${format.words}. Professional, the way one business writes to another it has not met. Courteous, direct, never chatty, never salesy. Contractions are fine in moderation. Vary sentence length; put a short sentence next to a longer one.
${format.extra.map((rule) => `- ${rule}`).join("\n")}
- Never use an em dash or en dash anywhere. Use a comma, a period, a colon, or parentheses instead. Straight quotes only. No emoji anywhere, on any channel: the register is the same whether this is an email, a DM or a WhatsApp message.
- No hype words: revolutionary, game-changing, seamless, robust, cutting-edge, elevate, unlock, supercharge, world-class. Make concrete claims instead.
- Avoid "not just X, but Y" and "it's not A, it's B" constructions. Say the thing directly. Don't force lists of three.
- Present the problem as an opportunity, never as an insult.
- One clear, low-pressure call to action (a short reply or a brief call).
- Do NOT invent facts, prices, or statistics. Do NOT claim you visited the business.
- ${format.closing}

Respond with ONLY valid JSON, no markdown fences. Write every line break inside the message as \\n, never as an actual newline, or the JSON will be invalid:
{"observation": "<the one-sentence personalised observation you opened with>", "subject": "${
    ctx.outreachChannel === "EMAIL"
      ? "<email subject line, max 9 words, specific not clickbait>"
      : "<a short label for this message, max 9 words; it is not sent on this channel>"
  }", "message": "<the full message body, with \\n\\n between paragraphs>"}`;
}

interface AiCallResult {
  text: string;
  provider: string;
  model: string;
}

const AI_RETRY_DELAYS_MS = [5_000, 10_000, 20_000];
const MIN_AI_RATE_LIMIT_COOLDOWN_MS = 60_000;
const AI_RATE_LIMIT_CIRCUIT_MS = 5 * 60_000;
const AI_AUTH_CIRCUIT_MS = 10 * 60_000;
const AI_TRANSIENT_CIRCUIT_MS = 2 * 60_000;
const aiLimiters = new Map<string, AdaptiveRateLimiter>();
const aiCircuits = new Map<string, { until: number; reason: string }>();

/**
 * The provider answered, and the answer is no use.
 *
 * Told apart from a transport failure because the two deserve opposite
 * treatment. A dropped connection is worth trying again; a model that reasoned
 * its whole budget away and returned nothing will do exactly the same thing
 * five seconds later. Retrying it anyway is what turned one scan of 356 leads
 * into eight hours: every lead paid the full 5, 10 and 20 second ladder to be
 * told the same thing three times.
 */
export class AiOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiOutputError";
  }
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterMs: number | null,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

export interface AiRequestLimiter {
  waitTurn(requestsPerMinute: number): Promise<void>;
  blockFor(ms: number): void;
  recordSuccess?: () => void;
}

function runtimeKey(ai: ResolvedAi): string {
  // Include the credential in the in-memory identity so correcting/rotating a
  // bad key immediately gets a fresh limiter and circuit. The key is never
  // logged or persisted.
  return `${ai.provider}\u0000${ai.baseUrl}\u0000${ai.model}\u0000${ai.apiKey}`;
}

function limiterFor(ai: ResolvedAi): AdaptiveRateLimiter {
  const key = runtimeKey(ai);
  let limiter = aiLimiters.get(key);
  if (!limiter) {
    limiter = new AdaptiveRateLimiter();
    aiLimiters.set(key, limiter);
  }
  return limiter;
}

function activeCircuitFor(ai: ResolvedAi): { until: number; reason: string } | null {
  const key = runtimeKey(ai);
  const circuit = aiCircuits.get(key);
  if (!circuit) return null;
  if (circuit.until > Date.now()) return circuit;
  aiCircuits.delete(key);
  return null;
}

export function recordAiProviderFailure(ai: ResolvedAi, err: unknown): void {
  const providerError = err instanceof AiProviderError ? err : null;
  const duration =
    providerError?.status === 429
      ? Math.max(AI_RATE_LIMIT_CIRCUIT_MS, providerError.retryAfterMs ?? 0)
      : providerError && providerError.status >= 400 && providerError.status < 500
        ? AI_AUTH_CIRCUIT_MS
        : AI_TRANSIENT_CIRCUIT_MS;
  const reason = err instanceof Error ? err.message : String(err);
  aiCircuits.set(runtimeKey(ai), { until: Date.now() + duration, reason });
}

export function clearAiCircuit(ai: ResolvedAi): void {
  aiCircuits.delete(runtimeKey(ai));
}

/**
 * A successful explicit connection test is stronger evidence than elapsed
 * time: close the circuit and release its request cooldown while retaining
 * the reduced adaptive pace.
 */
export function recordAiProviderProbeSuccess(ai: ResolvedAi): void {
  clearAiCircuit(ai);
  aiLimiters.get(runtimeKey(ai))?.clearCooldown();
}

/**
 * Chat-completions call for any OpenAI-compatible endpoint. Covers OpenAI
 * itself, NVIDIA NIM, and custom providers (Groq/Together/Ollama/vLLM).
 * `response_format: json_object` is only sent to api.openai.com, many
 * compatible servers reject it; parsePitchJson handles loose output anyway.
 */
/**
 * What a given endpoint and model will actually accept.
 *
 * Newer OpenAI models reject the two parameters that have been standard for
 * years: `max_tokens` is refused in favour of `max_completion_tokens`, and any
 * `temperature` other than the default is refused outright. Both come back as a
 * 400, which is not retryable, so choosing one of those models made every
 * single pitch fail and fall back to the template, for ever, with nothing on
 * screen saying why. Rather than keep a list of model names that will be out of
 * date within the month, the provider is allowed to tell us: a 400 that names
 * the parameter is taken as instruction, the request is sent again the way it
 * asked, and what we learned is remembered so it is paid once rather than on
 * every call.
 */
interface EndpointQuirks {
  tokenField: "max_tokens" | "max_completion_tokens";
  sendTemperature: boolean;
  /** Ask a reasoning model to think briefly. Only sent once one is detected. */
  sendReasoningEffort: boolean;
  tokenBudget: number;
}

/*
 * How much room the answer gets.
 *
 * A pitch is about 200 tokens of JSON, and the old budget of 600 was generous
 * for a model that simply writes one. It is nothing at all for a reasoning
 * model: those spend the budget thinking first, and the thinking is billed
 * against the same cap. gpt-oss-120b used 598 of 600 tokens reasoning and
 * returned an empty message, so every pitch failed and fell back to the
 * template, permanently, and the only symptom was "returned an empty response".
 *
 * The cap is a limit rather than a target, so raising it costs nothing on a
 * model that stops when it is done.
 */
const DEFAULT_TOKEN_BUDGET = 1200;
const MAX_TOKEN_BUDGET = 4000;

const DEFAULT_QUIRKS: EndpointQuirks = {
  tokenField: "max_tokens",
  sendTemperature: true,
  sendReasoningEffort: false,
  tokenBudget: DEFAULT_TOKEN_BUDGET,
};

const endpointQuirks = new Map<string, EndpointQuirks>();

function quirksFor(baseUrl: string, model: string): EndpointQuirks {
  return endpointQuirks.get(`${baseUrl}\u0000${model}`) ?? DEFAULT_QUIRKS;
}

function rememberQuirks(baseUrl: string, model: string, quirks: EndpointQuirks): void {
  endpointQuirks.set(`${baseUrl}\u0000${model}`, quirks);
}

/** Test seam: forget what was learned about every endpoint. */
export function _resetEndpointQuirks(): void {
  endpointQuirks.clear();
}

/**
 * Reads a 400 body as an instruction about one parameter, if it is one.
 * Returns the adjusted settings, or null when the rejection is about
 * something we cannot fix by asking differently.
 */
export function quirksFromRejection(body: string, current: EndpointQuirks): EndpointQuirks | null {
  const text = body.toLowerCase();
  if (current.tokenField === "max_tokens" && text.includes("max_completion_tokens")) {
    return { ...current, tokenField: "max_completion_tokens" };
  }
  if (current.sendReasoningEffort && text.includes("reasoning_effort")) {
    // This provider will not be asked to think less, so the only lever left is
    // room. Go straight to the ceiling rather than creeping up to it.
    return { ...current, sendReasoningEffort: false, tokenBudget: MAX_TOKEN_BUDGET };
  }
  if (current.sendTemperature && text.includes("temperature")) {
    return { ...current, sendTemperature: false };
  }
  return null;
}

/**
 * What to change when the model filled the whole budget and said nothing.
 *
 * That only happens one way: it reasoned until it ran out of room. Asking for
 * less reasoning is the cheap fix and by far the better one, it took this from
 * 901 reasoning tokens and 2.2 seconds to 90 and half a second, so it is tried
 * first. More room is the fallback for a model that will not take the hint.
 * Returns null once neither lever has anything left, and the caller reports it.
 */
export function quirksFromTruncation(current: EndpointQuirks): EndpointQuirks | null {
  if (!current.sendReasoningEffort) return { ...current, sendReasoningEffort: true };
  if (current.tokenBudget < MAX_TOKEN_BUDGET) {
    return { ...current, tokenBudget: Math.min(MAX_TOKEN_BUDGET, current.tokenBudget * 2) };
  }
  return null;
}

export async function callOpenAICompatible(
  prompt: string,
  ai: Pick<ResolvedAi, "provider" | "apiKey" | "model" | "baseUrl">,
  fetchImpl: typeof fetch = fetch,
): Promise<AiCallResult> {
  const isOpenAI = ai.baseUrl.startsWith("https://api.openai.com");
  let quirks = quirksFor(ai.baseUrl, ai.model);

  /*
   * Each pass either returns an answer or learns one thing and tries again, and
   * every lever is finite: two parameter corrections and two escalations. A
   * genuinely broken request still fails in a few seconds rather than looping.
   */
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetchImpl(`${ai.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(ai.apiKey ? { Authorization: `Bearer ${ai.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: ai.model,
        messages: [{ role: "user", content: prompt }],
        ...(quirks.sendTemperature ? { temperature: 0.7 } : {}),
        ...(quirks.sendReasoningEffort ? { reasoning_effort: "low" } : {}),
        [quirks.tokenField]: quirks.tokenBudget,
        ...(isOpenAI ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(45000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const adjusted = res.status === 400 ? quirksFromRejection(body, quirks) : null;
      if (adjusted) {
        logger.info(
          { provider: ai.provider, model: ai.model, ...adjusted },
          "provider rejected a request parameter, retrying the way it asked",
        );
        quirks = adjusted;
        rememberQuirks(ai.baseUrl, ai.model, adjusted);
        continue;
      }
      throw new AiProviderError(
        `${ai.provider} error ${res.status}: ${body.slice(0, 300)}`,
        res.status,
        parseRetryAfterMs(res.headers),
      );
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    };
    const choice = data.choices?.[0];
    const text = choice?.message?.content;

    /*
     * Running out of room is a failure whether it cut the answer off at the
     * start or in the middle.
     *
     * Checking only for an empty message missed the more common half of it: a
     * reasoning model that thinks for most of its budget still emits the
     * opening of the JSON before the cap bites, so what arrives is a valid
     * first line and no closing brace. That parses to nothing and was reported
     * as "No JSON object in AI response", which sounds like the model wrote
     * prose when in fact it wrote exactly what was asked and was cut off.
     */
    const truncated = choice?.finish_reason === "length";
    if (text && !truncated) {
      rememberQuirks(ai.baseUrl, ai.model, quirks);
      return { text, provider: ai.provider, model: ai.model };
    }

    const escalated = truncated ? quirksFromTruncation(quirks) : null;
    if (escalated) {
      logger.info(
        { provider: ai.provider, model: ai.model, ...escalated },
        "model ran out of room, retrying with less reasoning or more of it",
      );
      quirks = escalated;
      rememberQuirks(ai.baseUrl, ai.model, escalated);
      continue;
    }

    // Nothing left to adjust. A partial answer is still worth handing on: the
    // parser salvages a truncated object field by field and often gets a usable
    // message out of it, which beats a template.
    if (text) {
      rememberQuirks(ai.baseUrl, ai.model, quirks);
      return { text, provider: ai.provider, model: ai.model };
    }

    throw new AiOutputError(
      truncated
        ? `${ai.provider} model ${ai.model} used its entire ${quirks.tokenBudget}-token budget reasoning and produced no message. Choose a model that reasons less, or one without a reasoning step.`
        : `${ai.provider} returned an empty response`,
    );
  }

  throw new AiOutputError(`${ai.provider} did not return a usable message in any form the request was tried`);
}

export async function callAnthropic(
  prompt: string,
  ai: Pick<ResolvedAi, "apiKey" | "model" | "baseUrl">,
  fetchImpl: typeof fetch = fetch,
): Promise<AiCallResult> {
  const base = ai.baseUrl || "https://api.anthropic.com";
  const res = await fetchImpl(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ai.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ai.model,
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AiProviderError(
      `anthropic error ${res.status}: ${body.slice(0, 300)}`,
      res.status,
      parseRetryAfterMs(res.headers),
    );
  }
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = data.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new AiOutputError("anthropic returned an empty response");
  return { text, provider: "anthropic", model: ai.model };
}

/**
 * House style enforcement for anything a model wrote: no em/en dashes,
 * straight quotes only. Models drift back to these no matter the prompt,
 * so we normalise the output instead of trusting it.
 */
export function sanitizeProse(text: string): string {
  return (
    text
      // Em and en dashes stand in for punctuation, so they become punctuation.
      .replace(/\s*[\u2014\u2013]\s*/g, ", ")
      /*
       * The hyphen-shaped ones are different: they sit inside a word, as in
       * "high-quality", so replacing them with a comma would cut the word in
       * half. They only need to become the plain ASCII hyphen. The models reach
       * for the non-breaking hyphen (U+2011) constantly and it was going out in
       * messages untouched, where some mail clients and every WhatsApp client
       * render it as a box.
       */
      .replace(/[\u2010\u2011\u2012\u2015]/g, "-")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      // Other invisible punctuation that survives a copy and paste into a DM.
      .replace(/[\u00A0\u2007\u202F]/g, " ")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/, ,/g, ",")
      .replace(/ {2,}/g, " ")
  );
}

/**
 * Our own name, spelled our way.
 *
 * Models mangle it, and "YEEN Technologies" in the sign-off of an email going
 * to a stranger is the one typo in the message nobody forgives. Applied to the
 * finished text rather than asked for in the prompt, because a rule the model
 * has to remember is a rule it will eventually forget.
 */
export function correctStudioName(text: string): string {
  return text.replace(/\b(?:YEEN|YEAAN|YAEN|YEANN|Yean|yean|YEN)(?=\s+Technologies)/g, "YEAN");
}

/**
 * Escapes the control characters models leave loose inside JSON strings.
 *
 * A letter has paragraphs in it, and a model asked for JSON very often writes
 * those as real newlines rather than as \n. That is invalid JSON, and strict
 * parsing rejected the whole response: "Bad control character in string literal
 * at position 172" is the first blank line of the message. Every pitch then
 * silently fell back to the template while the provider was answering perfectly.
 *
 * Only characters inside string literals are touched, so the structure of the
 * object is left exactly as the model wrote it.
 */
export function escapeLooseControlCharacters(json: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (const char of json) {
    if (escaped) {
      out += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      out += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      out += char;
      continue;
    }
    // Anything below U+0020 is illegal unescaped inside a JSON string. The
    // three that carry meaning are escaped; the rest are noise and dropped.
    if (inString && char.charCodeAt(0) < 0x20) {
      out += char === "\n" ? "\\n" : char === "\r" ? "\\r" : char === "\t" ? "\\t" : "";
      continue;
    }
    out += char;
  }
  return out;
}

/** Last resort: lift the fields out directly when the object will not parse. */
function fieldsByHand(json: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const key of ["observation", "subject", "message"]) {
    // Everything up to the quote that closes the value, which is the one
    // followed by a comma or the end of the object.
    const match = new RegExp(`"${key}"\\s*:\\s*"([\\s\\S]*?)"\\s*(?:,\\s*"|\\}\\s*$)`).exec(json);
    if (match) found[key] = match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
  return found;
}

export function parsePitchJson(text: string): { observation: string; subject: string; message: string } {
  // Strip accidental markdown fences, then find the JSON object.
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON object in AI response");
  const body = cleaned.slice(start, end + 1);

  /*
   * Three attempts, cheapest first. Throwing away a written pitch over
   * punctuation is worse than any of the tolerance below: the model did the
   * work and the operator gets a template instead.
   */
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    try {
      parsed = JSON.parse(escapeLooseControlCharacters(body)) as Record<string, unknown>;
    } catch {
      parsed = fieldsByHand(body);
      if (!parsed.subject || !parsed.message) throw new Error("AI response was not usable JSON");
    }
  }

  const clean = (value: unknown) => correctStudioName(sanitizeProse(String(value ?? "").trim()));
  const observation = clean(parsed.observation);
  const subject = clean(parsed.subject);
  const message = clean(parsed.message);
  if (!subject || !message) throw new Error("AI response missing subject or message");
  return { observation, subject, message };
}

/**
 * Deterministic fallback, used when no AI key is set or the AI call fails.
 *
 * Shaped for the channel it will go out on, for the same reason the prompt is:
 * the template was written as a letter, so every WhatsApp and Instagram lead
 * that fell back got a 120-word block signed "Kind regards, The YEAN
 * Technologies team" dropped into a chat thread.
 */
export function templatePitch(ctx: PitchContext): PitchResult {
  const solution = suggestedSolutionFor(ctx.category);
  const problemLine = problemLineFor(ctx);
  const chat = ctx.outreachChannel === "WHATSAPP" || ctx.outreachChannel === "INSTAGRAM_MANUAL";

  const message = chat
    ? `Hello ${ctx.businessName},

${ctx.openingSoon ? `Congratulations on the new opening in ${ctx.city}. ` : `We came across you while researching ${ctx.category} in ${ctx.city}. `}${problemLine}

We are YEAN Technologies, a web studio. We build ${shortSolutionFor(ctx.category)}. Would you be open to a short chat about it?

YEAN Technologies`
    : `Hello ${ctx.businessName},

${
        ctx.openingSoon
          ? `Congratulations on ${ctx.businessName}. New businesses in ${ctx.city} rarely look this promising.`
          : `We came across ${ctx.businessName} while researching standout ${ctx.category} in ${ctx.city}.`
      } ${problemLine}

We are YEAN Technologies, a web studio that builds websites for businesses like yours. We would be glad to build you ${solution}.

Would you be open to a brief conversation about it? A short reply is all we need.

Kind regards,
The YEAN Technologies team`;

  return {
    subject: subjectFor(ctx),
    message,
    observation: problemLine,
    provider: "template",
    model: "builtin",
  };
}

/**
 * The same offer in a clause rather than a sentence.
 *
 * The full solution lines run to thirty words, which is most of a chat message
 * spent on us rather than on them.
 */
function shortSolutionFor(category: string): string {
  if (/restaurant|food|cafe|kitchen|eatery|grill|bar/i.test(category)) {
    return "menu and ordering websites that take orders directly instead of through commission apps";
  }
  if (/hotel|resort|shortlet|apartment|suites|lodging|guest/i.test(category)) {
    return "booking websites that take reservations directly instead of through the OTAs";
  }
  if (/salon|spa|barber|beauty|nail|hair/i.test(category)) {
    return "booking websites where clients pick a service and book a slot in under a minute";
  }
  if (/fashion|boutique|clothing|apparel|shoe|bag|accessor|perfume|fragrance|scent/i.test(category)) {
    return "online stores that present your collections properly and handle payments";
  }
  return "custom websites that make a business easier to find and to buy from";
}

function problemLineFor(ctx: PitchContext): string {
  switch (ctx.websiteType) {
    case "NO_WEBSITE":
      return "We noticed you don't have a website yet, which means customers searching on Google can't find you.";
    case "BROKEN_WEBSITE":
      return "We noticed your website isn't loading at the moment, which likely costs you customers every day.";
    case "SOCIAL_MEDIA_ONLY":
      return "We noticed your online presence currently runs entirely through social media, so you miss everyone searching on Google.";
    case "LINK_IN_BIO_ONLY":
      return "We noticed you're using a link-in-bio page instead of a full website, which limits how professionally your brand comes across.";
    case "MENU_PLATFORM_ONLY":
      return "We noticed your only web presence is on a third-party platform, which takes commission and controls your customer relationships.";
    case "SHOPIFY":
      return "We noticed your store runs on a Shopify template. A custom site would give you more control at a lower running cost.";
    case "POOR_WEBSITE":
      return "We noticed your current website has some issues that may be turning visitors away.";
    default:
      return "We noticed an opportunity to strengthen your online presence.";
  }
}

function subjectFor(ctx: PitchContext): string {
  switch (ctx.websiteType) {
    case "NO_WEBSITE":
      return `A website for ${shortenName(ctx.businessName)}`;
    case "BROKEN_WEBSITE":
      return `${shortenName(ctx.businessName)}: your website appears down`;
    case "SHOPIFY":
      return `Beyond Shopify for ${shortenName(ctx.businessName)}`;
    default:
      return `Your online presence, ${shortenName(ctx.businessName)}`;
  }
}

/** Runs one prompt through the configured provider (no fallback). */
export async function runAiPrompt(prompt: string, ai: ResolvedAi, fetchImpl: typeof fetch = fetch): Promise<AiCallResult> {
  if (ai.protocol === "anthropic") return callAnthropic(prompt, ai, fetchImpl);
  if (ai.protocol === "openai") return callOpenAICompatible(prompt, ai, fetchImpl);
  throw new Error("No AI provider is configured");
}

export async function runAiPromptWithRetry(
  prompt: string,
  ai: ResolvedAi,
  opts: {
    fetchImpl?: typeof fetch;
    limiter?: AiRequestLimiter;
    sleepImpl?: (ms: number) => Promise<void>;
    random?: () => number;
  } = {},
): Promise<AiCallResult> {
  const limiter = opts.limiter ?? limiterFor(ai);
  const sleepImpl = opts.sleepImpl ?? sleep;
  const random = opts.random ?? Math.random;

  for (let attempt = 0; attempt <= AI_RETRY_DELAYS_MS.length; attempt++) {
    await limiter.waitTurn(ai.requestsPerMinute);
    try {
      const result = await runAiPrompt(prompt, ai, opts.fetchImpl);
      limiter.recordSuccess?.();
      return result;
    } catch (err) {
      const providerError = err instanceof AiProviderError ? err : null;
      /*
       * Only a fault that might not happen again is worth waiting for. An
       * answer we cannot use is not one of those: the same request produces the
       * same answer, so the ladder buys nothing and costs 35 seconds a lead.
       */
      const retryable =
        !(err instanceof AiOutputError) &&
        (!providerError || providerError.status === 429 || providerError.status >= 500);
      if (providerError?.status === 429) {
        limiter.blockFor(
          Math.max(MIN_AI_RATE_LIMIT_COOLDOWN_MS, providerError.retryAfterMs ?? 0),
        );
      }
      if (!retryable || attempt === AI_RETRY_DELAYS_MS.length) throw err;
      const base = AI_RETRY_DELAYS_MS[attempt];
      await sleepImpl(base + Math.floor(base * 0.25 * random()));
    }
  }

  throw new Error("AI retry loop exhausted.");
}

/** Main entry: generate a personalised pitch for a lead. Never throws. */
export interface GeneratePitchOptions {
  /** Explicit human retry: probe the provider even while the bulk-work circuit is open. */
  forceProviderAttempt?: boolean;
}

export function applyPitchResult(lead: LeadDocument, pitch: PitchResult): void {
  lead.personalisedObservation = pitch.observation;
  lead.pitchSubject = pitch.subject;
  lead.pitchMessage = pitch.message;
  lead.pitchGeneratedAt = new Date();
  lead.pitchModel = `${pitch.provider}/${pitch.model}`;
  if (pitch.fallbackReason) {
    lead.pitchFallbackReason = pitch.fallbackReason;
  } else {
    // Explicitly mark the old fallback path for $unset on save. This prevents
    // a recovered AI pitch from retaining a stale warning in API responses.
    lead.set("pitchFallbackReason", undefined);
  }
}

export async function generatePitch(
  ctx: PitchContext,
  options: GeneratePitchOptions = {},
): Promise<PitchResult> {
  const ai = await getAiRuntime();
  if (!ai.configured) {
    logger.info({ business: ctx.businessName }, "No AI provider configured, using template pitch");
    return templatePitch(ctx);
  }

  const activeCircuit = options.forceProviderAttempt ? null : activeCircuitFor(ai);
  if (activeCircuit) {
    const retryInSeconds = Math.max(1, Math.ceil((activeCircuit.until - Date.now()) / 1_000));
    const fallbackReason = `AI provider cooling down for ${retryInSeconds}s after: ${activeCircuit.reason}`;
    logger.warn(
      { business: ctx.businessName, provider: ai.provider, retryInSeconds },
      "AI circuit open, using template pitch without another provider request",
    );
    return { ...templatePitch(ctx), fallbackReason };
  }

  const prompt = buildPrompt(ctx);
  try {
    const result = await runAiPromptWithRetry(prompt, ai);
    clearAiCircuit(ai);
    const parsed = parsePitchJson(result.text);
    return {
      subject: parsed.subject,
      message: parsed.message,
      observation: parsed.observation,
      provider: result.provider,
      model: result.model,
    };
  } catch (err) {
    const fallbackReason = err instanceof Error ? err.message : String(err);
    recordAiProviderFailure(ai, err);
    logger.warn(
      { err: fallbackReason, business: ctx.businessName, provider: ai.provider },
      "AI pitch failed, falling back to template",
    );
    return { ...templatePitch(ctx), fallbackReason };
  }
}
