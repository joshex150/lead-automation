import { describe, expect, it } from "vitest";
import { classifyWebsite, collectQualityIssues } from "../src/services/websiteChecker/classify.js";
import type { WebsiteCheckResult } from "../src/types.js";

function baseCheck(overrides: Partial<WebsiteCheckResult> = {}): WebsiteCheckResult {
  return {
    inputUrl: "https://example.com",
    finalUrl: "https://example.com/",
    domain: "example.com",
    dnsResolved: true,
    sslValid: true,
    sslError: null,
    httpStatus: 200,
    responseTimeMs: 800,
    redirectChain: [],
    redirectLoop: false,
    reachable: true,
    title: "Example Business",
    metaDescription: "A great business",
    hasViewport: true,
    isShopify: false,
    shopifyIndicators: [],
    platform: null,
    platformKind: null,
    redirectsToSocialOnly: false,
    socialTarget: null,
    isParkingPage: false,
    brokenInternalLinks: 0,
    internalLinksChecked: 0,
    issues: [],
    error: null,
    checkedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("classifyWebsite, the eight categories", () => {
  it("NO_WEBSITE when there is no URL", () => {
    const result = classifyWebsite(null);
    expect(result.websiteType).toBe("NO_WEBSITE");
    expect(result.websiteStatus).toBe("NONE");
  });

  it("NO_WEBSITE when check has no inputUrl", () => {
    const result = classifyWebsite(baseCheck({ inputUrl: null }));
    expect(result.websiteType).toBe("NO_WEBSITE");
  });

  it("SOCIAL_MEDIA_ONLY when the site redirects to Instagram", () => {
    const result = classifyWebsite(
      baseCheck({ redirectsToSocialOnly: true, socialTarget: "instagram", platform: "instagram" }),
    );
    expect(result.websiteType).toBe("SOCIAL_MEDIA_ONLY");
    expect(result.problemSummary).toContain("instagram");
  });

  it("SOCIAL_MEDIA_ONLY when the site redirects to WhatsApp", () => {
    const result = classifyWebsite(baseCheck({ redirectsToSocialOnly: true, socialTarget: "whatsapp" }));
    expect(result.websiteType).toBe("SOCIAL_MEDIA_ONLY");
  });

  it("LINK_IN_BIO_ONLY for Linktree", () => {
    const result = classifyWebsite(baseCheck({ platform: "linktree", platformKind: "link_in_bio" }));
    expect(result.websiteType).toBe("LINK_IN_BIO_ONLY");
  });

  it("MENU_PLATFORM_ONLY for LuluMenu", () => {
    const result = classifyWebsite(baseCheck({ platform: "lulumenu", platformKind: "menu" }));
    expect(result.websiteType).toBe("MENU_PLATFORM_ONLY");
  });

  describe("BROKEN_WEBSITE dead conditions", () => {
    it("DNS failure", () => {
      const r = classifyWebsite(baseCheck({ dnsResolved: false, reachable: false, error: "DNS_FAILURE" }));
      expect(r.websiteType).toBe("BROKEN_WEBSITE");
      expect(r.websiteStatus).toBe("DEAD");
    });

    it("connection timeout", () => {
      const r = classifyWebsite(baseCheck({ reachable: false, error: "CONNECTION_TIMEOUT", httpStatus: null }));
      expect(r.websiteType).toBe("BROKEN_WEBSITE");
    });

    it("SSL failure", () => {
      const r = classifyWebsite(
        baseCheck({ reachable: false, error: "SSL_FAILURE", sslValid: false, sslError: "CERT_HAS_EXPIRED" }),
      );
      expect(r.websiteType).toBe("BROKEN_WEBSITE");
      expect(r.problemSummary).toMatch(/SSL/i);
    });

    it("404", () => {
      const r = classifyWebsite(baseCheck({ httpStatus: 404 }));
      expect(r.websiteType).toBe("BROKEN_WEBSITE");
      expect(r.problemSummary).toContain("404");
    });

    it("410", () => {
      const r = classifyWebsite(baseCheck({ httpStatus: 410 }));
      expect(r.websiteType).toBe("BROKEN_WEBSITE");
    });

    it("500-range errors", () => {
      const r = classifyWebsite(baseCheck({ httpStatus: 503 }));
      expect(r.websiteType).toBe("BROKEN_WEBSITE");
    });

    it("redirect loop", () => {
      const r = classifyWebsite(baseCheck({ redirectLoop: true, reachable: false, error: "REDIRECT_LOOP" }));
      expect(r.websiteType).toBe("BROKEN_WEBSITE");
      expect(r.problemSummary).toMatch(/redirect loop/i);
    });

    it("parking page", () => {
      const r = classifyWebsite(baseCheck({ isParkingPage: true }));
      expect(r.websiteType).toBe("BROKEN_WEBSITE");
      expect(r.problemSummary).toMatch(/parking/i);
    });

    it("400 bad request is treated as broken", () => {
      const r = classifyWebsite(baseCheck({ httpStatus: 400 }));
      expect(r.websiteType).toBe("BROKEN_WEBSITE");
    });
  });

  describe("access-controlled statuses are NOT broken (site is up, blocking our bot)", () => {
    for (const status of [401, 403, 405, 407, 408, 429, 451]) {
      it(`HTTP ${status} → not BROKEN_WEBSITE`, () => {
        // Reachable site (e.g. CDN-fronted) that returns an access-control code.
        const r = classifyWebsite(baseCheck({ httpStatus: status, title: null, metaDescription: null }));
        expect(r.websiteType).not.toBe("BROKEN_WEBSITE");
        expect(r.websiteType).toBe("CUSTOM_WEBSITE");
      });
    }
  });

  it("SHOPIFY for live Shopify sites", () => {
    const r = classifyWebsite(baseCheck({ isShopify: true, shopifyIndicators: ["cdn.shopify.com"] }));
    expect(r.websiteType).toBe("SHOPIFY");
    expect(r.websiteStatus).toBe("LIVE");
  });

  it("broken Shopify site is BROKEN_WEBSITE (dead wins)", () => {
    const r = classifyWebsite(baseCheck({ isShopify: true, httpStatus: 404 }));
    expect(r.websiteType).toBe("BROKEN_WEBSITE");
  });

  describe("POOR_WEBSITE", () => {
    it("no SSL", () => {
      const r = classifyWebsite(
        baseCheck({ sslValid: false, finalUrl: "http://example.com/", issues: ["NO_SSL"] }),
      );
      expect(r.websiteType).toBe("POOR_WEBSITE");
      expect(r.websiteStatus).toBe("DEGRADED");
    });

    it("not mobile friendly", () => {
      const r = classifyWebsite(baseCheck({ hasViewport: false, issues: ["NOT_MOBILE_FRIENDLY"] }));
      expect(r.websiteType).toBe("POOR_WEBSITE");
    });

    it("missing title AND description", () => {
      const r = classifyWebsite(
        baseCheck({ title: null, metaDescription: null, issues: ["MISSING_TITLE", "MISSING_DESCRIPTION"] }),
      );
      expect(r.websiteType).toBe("POOR_WEBSITE");
    });

    it("multiple broken internal links", () => {
      const r = classifyWebsite(baseCheck({ brokenInternalLinks: 3, internalLinksChecked: 3, issues: ["BROKEN_PAGES"] }));
      expect(r.websiteType).toBe("POOR_WEBSITE");
    });
  });

  it("CUSTOM_WEBSITE for a healthy custom site", () => {
    const r = classifyWebsite(baseCheck());
    expect(r.websiteType).toBe("CUSTOM_WEBSITE");
    expect(r.websiteStatus).toBe("LIVE");
  });

  it("slow-but-otherwise-fine site stays CUSTOM_WEBSITE", () => {
    const r = classifyWebsite(baseCheck({ responseTimeMs: 9000, issues: ["SLOW_RESPONSE"] }));
    expect(r.websiteType).toBe("CUSTOM_WEBSITE");
  });
});

describe("collectQualityIssues", () => {
  it("flags everything on a terrible site", () => {
    const issues = collectQualityIssues({
      sslValid: false,
      finalUrl: "http://bad.example/",
      responseTimeMs: 12000,
      title: null,
      metaDescription: null,
      hasViewport: false,
      brokenInternalLinks: 4,
    });
    expect(issues).toEqual(
      expect.arrayContaining([
        "NO_SSL",
        "SLOW_RESPONSE",
        "MISSING_TITLE",
        "MISSING_DESCRIPTION",
        "NOT_MOBILE_FRIENDLY",
        "BROKEN_PAGES",
      ]),
    );
  });

  it("returns nothing for a healthy site", () => {
    const issues = collectQualityIssues({
      sslValid: true,
      finalUrl: "https://good.example/",
      responseTimeMs: 300,
      title: "Good",
      metaDescription: "Site",
      hasViewport: true,
      brokenInternalLinks: 0,
    });
    expect(issues).toEqual([]);
  });
});
