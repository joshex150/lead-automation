import {
  isParkingHost,
  isSocialUrl,
  linkInBioPlatformOf,
  menuPlatformOf,
  normalizeUrl,
  socialPlatformOf,
  extractDomain,
} from "../../utils/url.js";
import { logger } from "../../utils/logger.js";
import { getCheckerRuntime } from "../../config/runtime.js";
import { probeUrl, quickStatus } from "./probe.js";
import { analyzeHtml } from "./analyze.js";
import { classifyWebsite, collectQualityIssues } from "./classify.js";
import type { ClassificationResult, WebsiteCheckResult } from "../../types.js";

export { classifyWebsite } from "./classify.js";

export interface FullCheckOutcome {
  check: WebsiteCheckResult | null;
  classification: ClassificationResult;
}

/**
 * Runs the complete website health check for a lead's website URL.
 *
 * Order of operations:
 *  1. Normalize the URL. No URL → NO_WEBSITE.
 *  2. If the URL itself is a social / link-in-bio / menu-platform link,
 *     classify immediately (still probe it lightly for liveness).
 *  3. Otherwise probe: DNS → TLS → HTTP (manual redirects) → HTML.
 *  4. If the final destination after redirects is social-only, flag it.
 *  5. Analyze HTML: title/description/viewport, Shopify, parking, links.
 *  6. Sample up to 3 internal links for broken pages.
 *  7. Classify.
 */
export async function checkWebsite(
  rawUrl: string | null | undefined,
  opts: { deepLinkCheck?: boolean } = {},
): Promise<FullCheckOutcome> {
  const url = normalizeUrl(rawUrl);
  const checkedAt = new Date().toISOString();

  if (!url) {
    return { check: emptyCheck(null, checkedAt), classification: classifyWebsite(null) };
  }

  const base = emptyCheck(url, checkedAt);
  base.domain = extractDomain(url);

  // --- Direct platform URLs: classify from the URL itself ---
  const directSocial = isSocialUrl(url) ? socialPlatformOf(url) : null;
  const directLinkInBio = linkInBioPlatformOf(url);
  const directMenu = menuPlatformOf(url);

  if (directSocial || directLinkInBio || directMenu) {
    // Light liveness probe (a dead Linktree is still a broken presence).
    const status = await quickStatus(url);
    const check: WebsiteCheckResult = {
      ...base,
      dnsResolved: status !== null,
      reachable: status !== null && status < 400,
      httpStatus: status,
      sslValid: status !== null,
      finalUrl: url,
      redirectsToSocialOnly: Boolean(directSocial),
      socialTarget: directSocial,
      platform: directLinkInBio ?? directMenu ?? directSocial,
      platformKind: directLinkInBio ? "link_in_bio" : directMenu ? "menu" : null,
    };
    return { check, classification: classifyWebsite(check) };
  }

  // --- Full probe (timeout/redirect budget tunable from Settings) ---
  let probe;
  try {
    const checker = await getCheckerRuntime();
    probe = await probeUrl(url, { timeoutMs: checker.timeoutMs, maxRedirects: checker.maxRedirects });
  } catch (err) {
    logger.warn({ url, err: String(err) }, "probe crashed");
    base.error = `PROBE_ERROR: ${err instanceof Error ? err.message : String(err)}`;
    return { check: base, classification: classifyWebsite(base) };
  }

  const check: WebsiteCheckResult = {
    ...base,
    finalUrl: probe.finalUrl,
    domain: probe.domain ?? base.domain,
    dnsResolved: probe.dnsResolved,
    sslValid: probe.sslValid,
    sslError: probe.sslError,
    httpStatus: probe.httpStatus,
    responseTimeMs: probe.responseTimeMs,
    redirectChain: probe.redirectChain,
    redirectLoop: probe.redirectLoop,
    reachable: probe.reachable,
    error: probe.error,
  };

  // Did redirects land on a social platform / link-in-bio / menu platform / parking host?
  const finalUrl = probe.finalUrl ?? probe.redirectChain[probe.redirectChain.length - 1] ?? null;
  if (finalUrl) {
    const social = socialPlatformOf(finalUrl);
    if (social) {
      check.redirectsToSocialOnly = true;
      check.socialTarget = social;
      check.platform = social;
    }
    const lib = linkInBioPlatformOf(finalUrl);
    if (lib) {
      check.platform = lib;
      check.platformKind = "link_in_bio";
    }
    const menu = menuPlatformOf(finalUrl);
    if (menu) {
      check.platform = menu;
      check.platformKind = "menu";
    }
    if (isParkingHost(finalUrl)) check.isParkingPage = true;
  }

  // HTML analysis for live pages.
  if (probe.html && probe.finalUrl) {
    const page = analyzeHtml(probe.html, probe.finalUrl, probe.headers);
    check.title = page.title;
    check.metaDescription = page.metaDescription;
    check.hasViewport = page.hasViewport;
    check.isShopify = page.isShopify;
    check.shopifyIndicators = page.shopifyIndicators;
    if (page.isParkingPage) check.isParkingPage = true;

    // Broken internal pages: sample up to 3 links.
    if (opts.deepLinkCheck !== false && page.internalLinks.length > 0 && check.reachable) {
      const sample = page.internalLinks.filter((l) => l !== probe.finalUrl).slice(0, 3);
      check.internalLinksChecked = sample.length;
      let broken = 0;
      for (const link of sample) {
        const status = await quickStatus(link, 6000);
        if (status === null || status === 404 || status === 410 || status >= 500) broken++;
      }
      check.brokenInternalLinks = broken;
    }

    check.issues = collectQualityIssues({
      sslValid: check.sslValid,
      finalUrl: check.finalUrl,
      responseTimeMs: check.responseTimeMs,
      title: check.title,
      metaDescription: check.metaDescription,
      hasViewport: check.hasViewport,
      brokenInternalLinks: check.brokenInternalLinks,
    });
  } else if (check.reachable) {
    // Live but not HTML (or body unreadable), count basic issues only.
    check.issues = collectQualityIssues({
      sslValid: check.sslValid,
      finalUrl: check.finalUrl,
      responseTimeMs: check.responseTimeMs,
      title: null,
      metaDescription: null,
      hasViewport: true, // unknown, don't penalize
      brokenInternalLinks: 0,
    }).filter((i) => i !== "MISSING_TITLE" && i !== "MISSING_DESCRIPTION");
  }

  return { check, classification: classifyWebsite(check) };
}

function emptyCheck(url: string | null, checkedAt: string): WebsiteCheckResult {
  return {
    inputUrl: url,
    finalUrl: null,
    domain: null,
    dnsResolved: false,
    sslValid: false,
    sslError: null,
    httpStatus: null,
    responseTimeMs: null,
    redirectChain: [],
    redirectLoop: false,
    reachable: false,
    title: null,
    metaDescription: null,
    hasViewport: false,
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
    checkedAt,
  };
}
