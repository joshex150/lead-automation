import type { MetadataRoute } from "next";

/** Named and coloured so an installed shortcut matches the workspace. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "YEAN Leads",
    short_name: "YEAN Leads",
    description: "Find local businesses with no website, audit what they have, and approve every message before it is sent.",
    start_url: "/overview",
    display: "standalone",
    background_color: "#08080a",
    theme_color: "#08080a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
