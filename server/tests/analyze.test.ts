import { describe, expect, it } from "vitest";
import { analyzeHtml } from "../src/services/websiteChecker/analyze.js";

describe("analyzeHtml", () => {
  it("extracts title, description and viewport", () => {
    const html = `<html><head>
      <title>Crystal Scents, Luxury Perfumes</title>
      <meta name="description" content="Luxury perfumes in Port Harcourt">
      <meta name="viewport" content="width=device-width, initial-scale=1">
    </head><body>Hello</body></html>`;
    const page = analyzeHtml(html, "https://crystalscents.ng/");
    expect(page.title).toBe("Crystal Scents, Luxury Perfumes");
    expect(page.metaDescription).toBe("Luxury perfumes in Port Harcourt");
    expect(page.hasViewport).toBe(true);
    expect(page.isShopify).toBe(false);
  });

  it("falls back to og:description", () => {
    const html = `<html><head><meta property="og:description" content="OG desc"></head><body></body></html>`;
    const page = analyzeHtml(html, "https://x.example/");
    expect(page.metaDescription).toBe("OG desc");
  });

  describe("Shopify signatures", () => {
    it("detects cdn.shopify.com", () => {
      const html = `<html><head><link href="https://cdn.shopify.com/s/files/1/theme.css"></head><body></body></html>`;
      const page = analyzeHtml(html, "https://shop.example/");
      expect(page.isShopify).toBe(true);
      expect(page.shopifyIndicators).toContain("cdn.shopify.com");
    });

    it("detects Shopify.theme JS", () => {
      const html = `<html><body><script>Shopify.theme = {"name":"Dawn"};</script></body></html>`;
      const page = analyzeHtml(html, "https://shop.example/");
      expect(page.isShopify).toBe(true);
      expect(page.shopifyIndicators).toContain("Shopify.theme");
    });

    it("detects Shopify.routes JS", () => {
      const html = `<html><body><script>Shopify.routes = Shopify.routes || {};</script></body></html>`;
      const page = analyzeHtml(html, "https://shop.example/");
      expect(page.shopifyIndicators).toContain("Shopify.routes");
    });

    it("detects myshopify.com in URL", () => {
      const page = analyzeHtml("<html><body></body></html>", "https://crystal-scents.myshopify.com/");
      expect(page.isShopify).toBe(true);
      expect(page.shopifyIndicators).toContain("myshopify.com");
    });

    it("detects x-shopid header", () => {
      const page = analyzeHtml("<html><body></body></html>", "https://shop.example/", { "x-shopid": "12345" });
      expect(page.isShopify).toBe(true);
      expect(page.shopifyIndicators).toContain("x-shopid header");
    });
  });

  it("detects parking pages", () => {
    const html = `<html><body><h1>example.com</h1><p>This domain is for sale! Contact our domain broker.</p></body></html>`;
    const page = analyzeHtml(html, "https://expired.example/");
    expect(page.isParkingPage).toBe(true);
  });

  it("separates internal links from social links", () => {
    const html = `<html><body>
      <a href="/about">About</a>
      <a href="https://example.com/menu">Menu</a>
      <a href="https://www.example.com/contact">Contact</a>
      <a href="https://instagram.com/mybiz">IG</a>
      <a href="https://wa.me/2348031234567">WhatsApp</a>
      <a href="https://other-site.example/">Other</a>
      <a href="#top">Top</a>
      <a href="javascript:void(0)">JS</a>
    </body></html>`;
    const page = analyzeHtml(html, "https://example.com/");
    expect(page.internalLinks).toEqual(
      expect.arrayContaining([
        "https://example.com/about",
        "https://example.com/menu",
        "https://www.example.com/contact",
      ]),
    );
    expect(page.internalLinks).not.toContain("https://other-site.example/");
    expect(page.outboundSocialLinks).toEqual(
      expect.arrayContaining(["https://instagram.com/mybiz", "https://wa.me/2348031234567"]),
    );
  });
});
