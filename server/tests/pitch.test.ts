import { describe, expect, it } from "vitest";
import {
  applyPitchResult,
  buildPrompt,
  correctStudioName,
  parsePitchJson,
  sanitizeProse,
  suggestedSolutionFor,
  templatePitch,
  type PitchContext,
} from "../src/services/pitch/generatePitch.js";
import { Lead } from "../src/models/Lead.js";

const ctx: PitchContext = {
  businessName: "Crystal Scents",
  category: "perfume stores",
  city: "Port Harcourt",
  websiteType: "BROKEN_WEBSITE",
  websiteProblem: "Their Shopify link isn't opening properly.",
  instagramUsername: "crystal.scents",
  instagramBio: "Luxury fragrances | PH | Nationwide delivery",
  recentPostSummary: "New oud collection launch",
  outreachChannel: "EMAIL",
  openingSoon: false,
};

describe("suggestedSolutionFor", () => {
  it("maps categories to tailored solutions", () => {
    expect(suggestedSolutionFor("restaurants")).toMatch(/menu|ordering/i);
    expect(suggestedSolutionFor("hotels")).toMatch(/booking/i);
    expect(suggestedSolutionFor("shortlet apartments")).toMatch(/booking/i);
    expect(suggestedSolutionFor("salons")).toMatch(/booking/i);
    expect(suggestedSolutionFor("perfume stores")).toMatch(/fragrance|perfume/i);
    expect(suggestedSolutionFor("fashion stores")).toMatch(/store|collection/i);
    expect(suggestedSolutionFor("unknown category")).toMatch(/professional custom website/i);
  });
});

describe("buildPrompt", () => {
  it("includes all personalisation inputs from the plan", () => {
    const prompt = buildPrompt(ctx);
    expect(prompt).toContain("Crystal Scents");
    expect(prompt).toContain("perfume stores");
    expect(prompt).toContain("Shopify link isn't opening");
    expect(prompt).toContain("@crystal.scents");
    expect(prompt).toContain("Luxury fragrances");
    expect(prompt).toContain("New oud collection");
    expect(prompt).toContain("email");
    expect(prompt).toMatch(/JSON/);
  });

  it("notes opening-soon businesses", () => {
    const prompt = buildPrompt({ ...ctx, openingSoon: true });
    expect(prompt).toMatch(/opening soon|recently opened/i);
  });
});

describe("parsePitchJson", () => {
  it("parses clean JSON", () => {
    const parsed = parsePitchJson('{"observation":"o","subject":"s","message":"m"}');
    expect(parsed).toEqual({ observation: "o", subject: "s", message: "m" });
  });

  it("strips markdown fences", () => {
    const parsed = parsePitchJson('```json\n{"observation":"o","subject":"s","message":"m"}\n```');
    expect(parsed.subject).toBe("s");
  });

  it("tolerates prose around the JSON", () => {
    const parsed = parsePitchJson('Here you go:\n{"observation":"o","subject":"s","message":"m"}\nHope it helps');
    expect(parsed.message).toBe("m");
  });

  it("throws when subject or message missing", () => {
    expect(() => parsePitchJson('{"observation":"o"}')).toThrow();
    expect(() => parsePitchJson("no json here")).toThrow();
  });
});

describe("templatePitch (AI fallback)", () => {
  it("produces a complete personalised pitch", () => {
    const pitch = templatePitch(ctx);
    expect(pitch.subject.length).toBeGreaterThan(5);
    expect(pitch.message).toContain("Crystal Scents");
    expect(pitch.message).toContain("YEAN Technologies");
    expect(pitch.message).toMatch(/website isn't loading/i);
    expect(pitch.provider).toBe("template");
  });

  it("adapts to NO_WEBSITE", () => {
    const pitch = templatePitch({ ...ctx, websiteType: "NO_WEBSITE" });
    expect(pitch.message).toMatch(/don't have a website/i);
  });

  it("congratulates opening-soon businesses", () => {
    const pitch = templatePitch({ ...ctx, openingSoon: true });
    expect(pitch.message).toMatch(/congratulations/i);
  });

  it("never contains unfilled placeholders", () => {
    const pitch = templatePitch(ctx);
    expect(pitch.message).not.toMatch(/\{|\}|undefined|null/);
  });
});

describe("applyPitchResult", () => {
  it("clears a stale fallback warning when AI generation succeeds", () => {
    const lead = new Lead({
      businessName: "Recovered Lead",
      businessNameNormalized: "recovered lead",
      category: "restaurants",
      city: "Accra",
      googlePlaceId: "recovered-pitch",
      pitchFallbackReason: "old provider failure",
    });

    applyPitchResult(lead, {
      observation: "A specific observation",
      subject: "Fresh subject",
      message: "Fresh AI-generated message",
      provider: "openai",
      model: "gpt-test",
    });

    expect(lead.pitchFallbackReason).toBeUndefined();
    expect(lead.toObject()).not.toHaveProperty("pitchFallbackReason");
    expect(lead.pitchModel).toBe("openai/gpt-test");
  });

  it("stores the fallback reason when a template is used", () => {
    const lead = new Lead({
      businessName: "Fallback Lead",
      businessNameNormalized: "fallback lead",
      category: "restaurants",
      city: "Accra",
      googlePlaceId: "fallback-pitch",
    });

    applyPitchResult(lead, {
      observation: "Fallback observation",
      subject: "Fallback subject",
      message: "Fallback message",
      provider: "template",
      model: "builtin",
      fallbackReason: "provider unavailable",
    });

    expect(lead.pitchFallbackReason).toBe("provider unavailable");
  });
});

describe("parsing what models actually return", () => {
  /*
   * The reported failure. Asked for JSON, models very often write the letter's
   * paragraph breaks as real newlines instead of \n, which is invalid JSON.
   * Strict parsing threw "Bad control character in string literal at position
   * 172", the position of the first blank line, and every pitch fell back to
   * the template while the provider was answering perfectly.
   */
  it("accepts raw newlines inside the message, which is what broke every pitch", () => {
    const raw =
      '{"observation": "We noticed you have no website.", "subject": "A website for Mayorall goods", ' +
      '"message": "Hello Mayorall goods,\n\nWe came across your shop while researching companies in Lagos.\n\nKind regards,\nThe YEAN Technologies team"}';

    expect(() => JSON.parse(raw)).toThrow(); // the payload really is invalid JSON

    const parsed = parsePitchJson(raw);
    expect(parsed.subject).toBe("A website for Mayorall goods");
    expect(parsed.message.startsWith("Hello Mayorall goods,")).toBe(true);
    // The paragraph breaks are the point of the message; they must survive.
    expect(parsed.message).toContain("\n\n");
    expect(parsed.message).toContain("The YEAN Technologies team");
  });

  it("still handles tabs and carriage returns", () => {
    const raw = '{"subject": "S", "message": "One\r\n\tTwo"}';
    expect(parsePitchJson(raw).message).toContain("Two");
  });

  it("leaves properly escaped responses exactly as they are", () => {
    const raw = '{"observation": "o", "subject": "S", "message": "Hello,\\n\\nBody."}';
    expect(parsePitchJson(raw).message).toBe("Hello,\n\nBody.");
  });

  it("survives markdown fences around the object", () => {
    const raw = '```json\n{"subject": "S", "message": "Hello,\n\nBody."}\n```';
    expect(parsePitchJson(raw).subject).toBe("S");
  });

  it("still refuses a response with nothing usable in it", () => {
    expect(() => parsePitchJson("I cannot help with that.")).toThrow();
    expect(() => parsePitchJson('{"subject": "S"}')).toThrow();
  });
});

/*
 * A WhatsApp message and an email are different objects. The prompt and the
 * template both used to produce one shape for all of them, so a chat thread got
 * a 120-word letter signed "Kind regards, The YEAN Technologies team".
 */
describe("the message is shaped for the channel it goes out on", () => {
  const chat = (channel: string): PitchContext => ({ ...ctx, outreachChannel: channel });

  it("asks for a letter on email and a chat message on WhatsApp", () => {
    const email = buildPrompt(chat("EMAIL"));
    const whatsapp = buildPrompt(chat("WHATSAPP"));

    expect(email).toContain("70 to 120 words");
    expect(email).toContain("Kind regards,");

    expect(whatsapp).toContain("45 to 80 words");
    expect(whatsapp).not.toContain("Kind regards,");
    expect(whatsapp).toContain("this is a chat, not a letter");
  });

  it("treats an Instagram DM the same way as WhatsApp, not the same way as email", () => {
    const dm = buildPrompt(chat("INSTAGRAM_MANUAL"));
    expect(dm).toContain("45 to 80 words");
    expect(dm).not.toContain("Kind regards,");
  });

  it("keeps the house style identical on every channel", () => {
    for (const channel of ["EMAIL", "WHATSAPP", "INSTAGRAM_MANUAL"]) {
      const prompt = buildPrompt(chat(channel));
      expect(prompt).toContain("No emoji anywhere");
      expect(prompt).toContain("Never use an em dash");
      expect(prompt).toContain("No hype words");
    }
  });

  it("only asks for a real subject line where a subject is actually sent", () => {
    expect(buildPrompt(chat("EMAIL"))).toContain("<email subject line");
    expect(buildPrompt(chat("WHATSAPP"))).toContain("it is not sent on this channel");
  });

  it("writes the fallback template as a chat message too", () => {
    const email = templatePitch(chat("EMAIL")).message;
    const whatsapp = templatePitch(chat("WHATSAPP")).message;

    expect(email).toContain("Kind regards,");
    expect(email).toContain("The YEAN Technologies team");

    expect(whatsapp).not.toContain("Kind regards,");
    expect(whatsapp.trimEnd().endsWith("YEAN Technologies")).toBe(true);
    // Both still open by naming the business, which is what makes it theirs.
    expect(whatsapp.startsWith(`Hello ${ctx.businessName},`)).toBe(true);
    // And the chat version is genuinely shorter, not merely re-signed.
    expect(whatsapp.split(/\s+/).length).toBeLessThan(email.split(/\s+/).length);
  });
})

describe("house style is enforced on the model's output, not requested of it", () => {
  it("turns the hyphen-shaped dashes into hyphens rather than cutting words in half", () => {
    // U+2011, the non-breaking hyphen, is the one models reach for constantly.
    expect(sanitizeProse("high‑quality images")).toBe("high-quality images");
    expect(sanitizeProse("a well‐known brand")).toBe("a well-known brand");
  });

  it("still turns em and en dashes into punctuation", () => {
    expect(sanitizeProse("your site — which is down — costs you")).toBe(
      "your site, which is down, costs you",
    );
  });

  it("removes the invisible characters that survive a paste into a chat", () => {
    expect(sanitizeProse("one two")).toBe("one two");
    expect(sanitizeProse("in​visible")).toBe("invisible");
  });

  it("spells the studio's own name correctly however the model spelled it", () => {
    expect(correctStudioName("Kind regards,\nThe YEEN Technologies team")).toBe(
      "Kind regards,\nThe YEAN Technologies team",
    );
    expect(correctStudioName("The YEAN Technologies team")).toBe("The YEAN Technologies team");
    // Only where it is our name, never a word that merely looks similar.
    expect(correctStudioName("Yean Street")).toBe("Yean Street");
  });
})
