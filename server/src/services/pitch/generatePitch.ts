import { getAiRuntime, type ResolvedAi } from "../../config/runtime.js";
import { logger } from "../../utils/logger.js";
import { truncate } from "../../utils/text.js";
import type { LeadDocument } from "../../models/Lead.js";
import type { PitchResult } from "../../types.js";

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

export function buildPrompt(ctx: PitchContext): string {
  const solution = suggestedSolutionFor(ctx.category);
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
Channel: ${ctx.outreachChannel === "EMAIL" ? "email" : "Instagram DM"}

Rules:
- Open with a specific, genuine observation about THEIR business (use the website situation${ctx.recentPostSummary ? " or their recent post" : ""}). Never open with "I hope this finds you well".
- 70 to 120 words for the message body. Friendly Nigerian business tone, professional but human. Use contractions ("we'd", "it's", "you'll"). Vary sentence length; put a short sentence next to a longer one.
- Never use an em dash or en dash anywhere. Use a comma, a period, a colon, or parentheses instead. Straight quotes only. No emoji in email; at most one in a DM.
- No hype words: revolutionary, game-changing, seamless, robust, cutting-edge, elevate, unlock, supercharge, world-class. Make concrete claims instead.
- Avoid "not just X, but Y" and "it's not A, it's B" constructions. Say the thing directly. Don't force lists of three.
- Present the problem as an opportunity, never as an insult.
- One clear, low-pressure call to action (a short reply or a quick chat).
- Do NOT invent facts, prices, or statistics. Do NOT claim you visited the business.
- Sign off as "The YEAN Technologies team".

Respond with ONLY valid JSON, no markdown fences:
{"observation": "<the one-sentence personalised observation you opened with>", "subject": "<email subject line, max 9 words, specific not clickbait>", "message": "<the full message body>"}`;
}

interface AiCallResult {
  text: string;
  provider: string;
  model: string;
}

/**
 * Chat-completions call for any OpenAI-compatible endpoint. Covers OpenAI
 * itself, NVIDIA NIM, and custom providers (Groq/Together/Ollama/vLLM).
 * `response_format: json_object` is only sent to api.openai.com, many
 * compatible servers reject it; parsePitchJson handles loose output anyway.
 */
export async function callOpenAICompatible(
  prompt: string,
  ai: Pick<ResolvedAi, "provider" | "apiKey" | "model" | "baseUrl">,
  fetchImpl: typeof fetch = fetch,
): Promise<AiCallResult> {
  const isOpenAI = ai.baseUrl.startsWith("https://api.openai.com");
  const res = await fetchImpl(`${ai.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(ai.apiKey ? { Authorization: `Bearer ${ai.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: ai.model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 600,
      ...(isOpenAI ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${ai.provider} error ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error(`${ai.provider} returned an empty response`);
  return { text, provider: ai.provider, model: ai.model };
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
    throw new Error(`anthropic error ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = data.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("anthropic returned an empty response");
  return { text, provider: "anthropic", model: ai.model };
}

/**
 * House style enforcement for anything a model wrote: no em/en dashes,
 * straight quotes only. Models drift back to these no matter the prompt,
 * so we normalise the output instead of trusting it.
 */
export function sanitizeProse(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/, ,/g, ",")
    .replace(/ {2,}/g, " ");
}

export function parsePitchJson(text: string): { observation: string; subject: string; message: string } {
  // Strip accidental markdown fences, then find the JSON object.
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON object in AI response");
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  const observation = sanitizeProse(String(parsed.observation ?? "").trim());
  const subject = sanitizeProse(String(parsed.subject ?? "").trim());
  const message = sanitizeProse(String(parsed.message ?? "").trim());
  if (!subject || !message) throw new Error("AI response missing subject or message");
  return { observation, subject, message };
}

/** Deterministic fallback, used when no AI key is set or the AI call fails. */
export function templatePitch(ctx: PitchContext): PitchResult {
  const solution = suggestedSolutionFor(ctx.category);
  const opening = ctx.openingSoon
    ? `Congratulations on ${ctx.businessName}. New businesses in ${ctx.city} rarely look this promising.`
    : `We came across ${ctx.businessName} while researching standout ${ctx.category} in ${ctx.city}.`;

  const problemLine = problemLineFor(ctx);

  const message = `Hello ${ctx.businessName},

${opening} ${problemLine}

We're YEAN Technologies, a web studio that builds sites for businesses like yours. We'd love to build you ${solution}.

Would you be open to a quick chat about it? A short reply is all it takes.

Warm regards,
The YEAN Technologies team`;

  return {
    subject: subjectFor(ctx),
    message,
    observation: problemLine,
    provider: "template",
    model: "builtin",
  };
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
      return `A website for ${truncate(ctx.businessName, 30)}`;
    case "BROKEN_WEBSITE":
      return `${truncate(ctx.businessName, 30)}: your website appears down`;
    case "SHOPIFY":
      return `Beyond Shopify for ${truncate(ctx.businessName, 30)}`;
    default:
      return `Your online presence, ${truncate(ctx.businessName, 30)}`;
  }
}

/** Runs one prompt through the configured provider (no fallback). */
export async function runAiPrompt(prompt: string, ai: ResolvedAi, fetchImpl: typeof fetch = fetch): Promise<AiCallResult> {
  if (ai.protocol === "anthropic") return callAnthropic(prompt, ai, fetchImpl);
  if (ai.protocol === "openai") return callOpenAICompatible(prompt, ai, fetchImpl);
  throw new Error("No AI provider is configured");
}

/** Main entry: generate a personalised pitch for a lead. Never throws. */
export async function generatePitch(ctx: PitchContext): Promise<PitchResult> {
  const ai = await getAiRuntime();
  if (!ai.configured) {
    logger.info({ business: ctx.businessName }, "No AI provider configured, using template pitch");
    return templatePitch(ctx);
  }

  const prompt = buildPrompt(ctx);
  try {
    const result = await runAiPrompt(prompt, ai);
    const parsed = parsePitchJson(result.text);
    return {
      subject: parsed.subject,
      message: parsed.message,
      observation: parsed.observation,
      provider: result.provider,
      model: result.model,
    };
  } catch (err) {
    logger.warn(
      { err: String(err), business: ctx.businessName, provider: ai.provider },
      "AI pitch failed, falling back to template",
    );
    return templatePitch(ctx);
  }
}
