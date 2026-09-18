import type { MetadataRoute } from "next";

const SITE_URL = (process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

/*
 * The landing page is the only thing a crawler is invited to read.
 *
 * This used to be a static file saying `Disallow: /`, which kept the workspace
 * out of search results and the landing page along with it. The workspace is
 * still closed, by name rather than by blanket rule, and it is behind a session
 * anyway: this only stops well behaved crawlers from asking.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/overview",
          "/queue",
          "/leads",
          "/analytics",
          "/settings",
          "/site-control",
          "/suppression",
          "/help",
          "/login",
          "/api/",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
