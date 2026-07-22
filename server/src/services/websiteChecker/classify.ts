import type { ClassificationResult, WebsiteCheckResult } from "../../types.js";

/**
 * Pure classifier: turns a WebsiteCheckResult into one of the eight
 * lead categories plus a human-readable problem summary (which seeds
 * the AI pitch). No network, fully unit-testable.
 *
 * Priority order matters:
 *   1. NO_WEBSITE         , nothing to check
 *   2. SOCIAL_MEDIA_ONLY  , the "website" is (or redirects straight to) IG/FB/WhatsApp
 *   3. LINK_IN_BIO_ONLY   , Linktree / Beacons / etc.
 *   4. MENU_PLATFORM_ONLY , LuluMenu / Chowdeck / Glovo store page
 *   5. BROKEN_WEBSITE     , dead by DNS/SSL/timeout/4xx/5xx/redirect loop/parking
 *   6. SHOPIFY            , live site with Shopify signatures
 *   7. POOR_WEBSITE       , live but with enough quality problems to pitch
 *   8. CUSTOM_WEBSITE     , live, healthy, custom (lowest priority target)
 */
export function classifyWebsite(check: WebsiteCheckResult | null): ClassificationResult {
  if (!check || !check.inputUrl) {
    return {
      websiteType: "NO_WEBSITE",
      websiteStatus: "NONE",
      problemSummary: "The business has no website at all, so customers can only find them through word of mouth or social media.",
    };
  }

  // The listed website is a social profile or redirects only to one.
  if (check.redirectsToSocialOnly && check.socialTarget) {
    const target = check.socialTarget;
    return {
      websiteType: "SOCIAL_MEDIA_ONLY",
      websiteStatus: check.reachable ? "LIVE" : "DEGRADED",
      problemSummary: `Their "website" is just a ${target} link. There is no real website, so they miss customers searching on Google and have no control over their online presence.`,
    };
  }

  if (check.platformKind === "link_in_bio") {
    return {
      websiteType: "LINK_IN_BIO_ONLY",
      websiteStatus: check.reachable ? "LIVE" : "DEGRADED",
      problemSummary: `They only have a ${check.platform ?? "link-in-bio"} page instead of a real website. It looks temporary, can't rank on Google, and limits how professionally they can present their business.`,
    };
  }

  if (check.platformKind === "menu") {
    return {
      websiteType: "MENU_PLATFORM_ONLY",
      websiteStatus: check.reachable ? "LIVE" : "DEGRADED",
      problemSummary: `Their only web presence is a ${check.platform ?? "third-party menu"} listing, so they depend on a platform they don't control and pay commission on.`,
    };
  }

  // Dead website conditions.
  const deadReason = deadWebsiteReason(check);
  if (deadReason) {
    return {
      websiteType: "BROKEN_WEBSITE",
      websiteStatus: "DEAD",
      problemSummary: deadReason,
    };
  }

  if (check.isShopify) {
    return {
      websiteType: "SHOPIFY",
      websiteStatus: "LIVE",
      problemSummary:
        "They run on a Shopify template. It works, but they pay monthly fees for a generic storefront with limited customisation and little local payment or delivery flexibility.",
    };
  }

  // Live site: count quality problems.
  const issues = check.issues ?? [];
  const seriousIssues = issues.filter((i) => i !== "SLOW_RESPONSE").length;
  const isPoor =
    seriousIssues >= 2 ||
    issues.includes("NO_SSL") ||
    (issues.includes("MISSING_TITLE") && issues.includes("MISSING_DESCRIPTION")) ||
    issues.includes("NOT_MOBILE_FRIENDLY") ||
    (check.brokenInternalLinks ?? 0) >= 2;

  if (isPoor) {
    const problems: string[] = [];
    if (issues.includes("NO_SSL")) problems.push("no SSL certificate (browsers flag it as 'Not secure')");
    if (issues.includes("NOT_MOBILE_FRIENDLY")) problems.push("not mobile-friendly");
    if (issues.includes("MISSING_TITLE") || issues.includes("MISSING_DESCRIPTION"))
      problems.push("missing basic SEO tags so it's nearly invisible on Google");
    if (issues.includes("SLOW_RESPONSE")) problems.push("very slow to load");
    if ((check.brokenInternalLinks ?? 0) >= 2) problems.push("broken pages/links");
    return {
      websiteType: "POOR_WEBSITE",
      websiteStatus: "DEGRADED",
      problemSummary: `Their website is live but underperforming: ${problems.join(", ") || "multiple quality problems"}.`,
    };
  }

  return {
    websiteType: "CUSTOM_WEBSITE",
    websiteStatus: "LIVE",
    problemSummary: "They already have a working custom website.",
  };
}

function deadWebsiteReason(check: WebsiteCheckResult): string | null {
  if (!check.dnsResolved) {
    return "Their website domain no longer resolves (DNS failure). The site customers expect to find is offline.";
  }
  if (check.error === "CONNECTION_TIMEOUT") {
    return "Their website times out and never loads, so visitors give up before seeing anything.";
  }
  if (check.error === "SSL_FAILURE") {
    return "Their website's SSL certificate is broken, so browsers block visitors with a security warning.";
  }
  if (check.redirectLoop) {
    return "Their website is stuck in a redirect loop and never actually loads.";
  }
  if (check.isParkingPage) {
    return "Their domain now shows a parking page. The website is gone and the domain may be expiring.";
  }
  if (check.httpStatus != null) {
    // Access-control / rate-limit statuses mean the site is UP but blocking our
    // bot (very common on CDN-fronted sites). Treat as reachable-but-unknown, not
    // dead, otherwise we'd manufacture false "broken website" leads.
    if (ACCESS_CONTROLLED_STATUSES.has(check.httpStatus)) return null;
    if (check.httpStatus === 404 || check.httpStatus === 410) {
      return `Their website returns a ${check.httpStatus} error. The page customers land on no longer exists.`;
    }
    if (check.httpStatus >= 500) {
      return `Their website is failing with a ${check.httpStatus} server error.`;
    }
    if (check.httpStatus >= 400) {
      return `Their website returns a ${check.httpStatus} error instead of loading.`;
    }
  }
  if (!check.reachable) {
    return "Their website cannot be reached. It appears to be offline.";
  }
  return null;
}

/** 401/403/405/407/408/429/451: site is up but access-restricted or blocking bots. */
const ACCESS_CONTROLLED_STATUSES = new Set([401, 403, 405, 407, 408, 429, 451]);

/** Builds the issues list for a live page. Pure, unit-testable. */
export function collectQualityIssues(input: {
  sslValid: boolean;
  finalUrl: string | null;
  responseTimeMs: number | null;
  title: string | null;
  metaDescription: string | null;
  hasViewport: boolean;
  brokenInternalLinks: number;
}): string[] {
  const issues: string[] = [];
  const httpsFinal = input.finalUrl?.startsWith("https://") ?? false;
  if (!httpsFinal || !input.sslValid) issues.push("NO_SSL");
  if ((input.responseTimeMs ?? 0) > 8000) issues.push("SLOW_RESPONSE");
  if (!input.title) issues.push("MISSING_TITLE");
  if (!input.metaDescription) issues.push("MISSING_DESCRIPTION");
  if (!input.hasViewport) issues.push("NOT_MOBILE_FRIENDLY");
  if (input.brokenInternalLinks >= 2) issues.push("BROKEN_PAGES");
  return issues;
}
