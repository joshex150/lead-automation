import * as cheerio from "cheerio";

/**
 * Pure HTML/header analysis, no network. Everything here is unit-testable.
 */

export interface PageAnalysis {
  title: string | null;
  metaDescription: string | null;
  hasViewport: boolean;
  isShopify: boolean;
  shopifyIndicators: string[];
  isParkingPage: boolean;
  internalLinks: string[];
  outboundSocialLinks: string[];
  generator: string | null;
}

const PARKING_SIGNALS = [
  "this domain is for sale",
  "buy this domain",
  "domain is parked",
  "parked free",
  "sedoparking",
  "hugedomains",
  "godaddy.com/domainsearch",
  "domain broker",
  "renew this domain",
  "this web page is parked",
  "expired domain",
  "courtesy of godaddy",
];

export function analyzeHtml(html: string, finalUrl: string, headers: Record<string, string> = {}): PageAnalysis {
  const $ = cheerio.load(html);

  const title = $("head > title").first().text().trim() || null;
  const metaDescription =
    $('meta[name="description"]').attr("content")?.trim() ||
    $('meta[property="og:description"]').attr("content")?.trim() ||
    null;
  const hasViewport = $('meta[name="viewport"]').length > 0;
  const generator = $('meta[name="generator"]').attr("content")?.trim() ?? null;

  // ---- Shopify detection ----
  const shopifyIndicators: string[] = [];
  const htmlLower = html.toLowerCase();
  if (headers["x-shopid"] || headers["x-shopify-stage"]) shopifyIndicators.push("x-shopid header");
  if (/\bcdn\.shopify\.com\b/.test(htmlLower)) shopifyIndicators.push("cdn.shopify.com");
  if (/\bmyshopify\.com\b/.test(htmlLower) || /myshopify\.com/i.test(finalUrl)) shopifyIndicators.push("myshopify.com");
  if (/shopify\.theme\b/i.test(html)) shopifyIndicators.push("Shopify.theme");
  if (/shopify\.routes\b/i.test(html)) shopifyIndicators.push("Shopify.routes");
  if (/window\.shopify/i.test(html)) shopifyIndicators.push("window.Shopify");
  if (generator?.toLowerCase().includes("shopify")) shopifyIndicators.push("meta generator");
  const isShopify = shopifyIndicators.length > 0;

  // ---- Parking-page detection ----
  const textSample = $("body").text().slice(0, 5000).toLowerCase();
  const isParkingPage = PARKING_SIGNALS.some((s) => textSample.includes(s) || htmlLower.includes(s));

  // ---- Link inventory ----
  const internalLinks: string[] = [];
  const outboundSocialLinks: string[] = [];
  let baseHost: string | null = null;
  try {
    baseHost = new URL(finalUrl).hostname.replace(/^www\./, "");
  } catch {
    baseHost = null;
  }

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    let abs: URL;
    try {
      abs = new URL(href, finalUrl);
    } catch {
      return;
    }
    const host = abs.hostname.replace(/^www\./, "");
    if (
      /instagram\.com|facebook\.com|wa\.me|api\.whatsapp\.com|tiktok\.com|twitter\.com|x\.com|t\.me/.test(host)
    ) {
      outboundSocialLinks.push(abs.toString());
    } else if (baseHost && host === baseHost && (abs.protocol === "https:" || abs.protocol === "http:")) {
      internalLinks.push(abs.toString());
    }
  });

  return {
    title,
    metaDescription,
    hasViewport,
    isShopify,
    shopifyIndicators: [...new Set(shopifyIndicators)],
    isParkingPage,
    internalLinks: [...new Set(internalLinks)].slice(0, 50),
    outboundSocialLinks: [...new Set(outboundSocialLinks)].slice(0, 20),
    generator,
  };
}
