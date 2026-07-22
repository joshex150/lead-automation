import { describe, expect, it } from "vitest";
import { scoreLead } from "../src/services/scoring/leadScore.js";
import { DEFAULT_SCORING_WEIGHTS } from "../src/types.js";

const base = {
  websiteType: "NO_WEBSITE",
  hasEmail: false,
  whatsappAvailable: false,
  openingSoon: false,
  instagramActive: false,
  strongVisualBrand: false,
};

describe("scoreLead, plan scoring table", () => {
  it("no website = +40", () => {
    const r = scoreLead({ ...base, websiteType: "NO_WEBSITE" });
    expect(r.score).toBe(40);
  });

  it("broken website = +40", () => {
    const r = scoreLead({ ...base, websiteType: "BROKEN_WEBSITE" });
    expect(r.score).toBe(40);
  });

  it("social media only = +30", () => {
    const r = scoreLead({ ...base, websiteType: "SOCIAL_MEDIA_ONLY" });
    expect(r.score).toBe(30);
  });

  it("link-in-bio only = +30", () => {
    const r = scoreLead({ ...base, websiteType: "LINK_IN_BIO_ONLY" });
    expect(r.score).toBe(30);
  });

  it("shopify = +15", () => {
    const r = scoreLead({ ...base, websiteType: "SHOPIFY" });
    expect(r.score).toBe(15);
  });

  it("custom website = -30 (clamped to 0)", () => {
    const r = scoreLead({ ...base, websiteType: "CUSTOM_WEBSITE" });
    expect(r.score).toBe(0);
    expect(r.breakdown).toEqual([{ rule: "Existing custom website", points: -30 }]);
  });

  it("email adds +15, whatsapp +10, opening soon +25, active IG +15, visual brand +10", () => {
    const r = scoreLead({
      websiteType: "NO_WEBSITE",
      hasEmail: true,
      whatsappAvailable: true,
      openingSoon: true,
      instagramActive: true,
      strongVisualBrand: true,
    });
    expect(r.score).toBe(40 + 15 + 10 + 25 + 15 + 10);
    expect(r.qualified).toBe(true);
  });

  it("threshold gates qualification", () => {
    const below = scoreLead({ ...base, websiteType: "SHOPIFY" }, DEFAULT_SCORING_WEIGHTS, 50);
    expect(below.qualified).toBe(false);

    const above = scoreLead(
      { ...base, websiteType: "SHOPIFY", hasEmail: true, openingSoon: true },
      DEFAULT_SCORING_WEIGHTS,
      50,
    );
    expect(above.score).toBe(55);
    expect(above.qualified).toBe(true);
  });

  it("custom website with strong signals still struggles to qualify (by design)", () => {
    const r = scoreLead({
      websiteType: "CUSTOM_WEBSITE",
      hasEmail: true,
      whatsappAvailable: true,
      openingSoon: false,
      instagramActive: true,
      strongVisualBrand: false,
    });
    // -30 + 15 + 10 + 15 = 10 → not qualified
    expect(r.score).toBe(10);
    expect(r.qualified).toBe(false);
  });

  it("respects custom weights", () => {
    const r = scoreLead(
      { ...base, websiteType: "NO_WEBSITE" },
      { ...DEFAULT_SCORING_WEIGHTS, noWebsite: 60 },
      50,
    );
    expect(r.score).toBe(60);
    expect(r.qualified).toBe(true);
  });

  it("breakdown sums to the (unclamped) score", () => {
    const r = scoreLead({
      websiteType: "BROKEN_WEBSITE",
      hasEmail: true,
      whatsappAvailable: true,
      openingSoon: true,
      instagramActive: true,
      strongVisualBrand: true,
    });
    const sum = r.breakdown.reduce((s, b) => s + b.points, 0);
    expect(sum).toBe(r.score);
  });
});
