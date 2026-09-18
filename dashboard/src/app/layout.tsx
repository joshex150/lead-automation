import type { Metadata, Viewport } from "next";
import { Archivo, Azeret_Mono, DM_Sans, Space_Grotesk } from "next/font/google";
import { Toaster } from "react-hot-toast";
import { RiLoader4Line } from "react-icons/ri";
import { AppShell } from "@/components/AppShell";
import { ThemeProvider, THEME_STYLE_ID } from "@/lib/theme/provider";
import { MotionRuntime } from "@/lib/theme/motion";
import { loadTheme } from "@/lib/theme/server";
import { themeToAttributes, themeToCss } from "@/lib/theme/tokens";
import "./globals.css";
import "./enhancements.css";

/*
 * Every family the theme can select is loaded here rather than fetched when it
 * is chosen. Swapping a font at runtime would otherwise mean a request, a
 * repaint and a reflow in the middle of the interface, which is the visible
 * flicker this design exists to avoid.
 */
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], display: "swap", variable: "--font-space-grotesk" });
const dmSans = DM_Sans({ subsets: ["latin"], display: "swap", variable: "--font-dm-sans" });
const archivo = Archivo({ subsets: ["latin"], display: "swap", variable: "--font-archivo" });
const azeretMono = Azeret_Mono({ subsets: ["latin"], display: "swap", variable: "--font-azeret-mono" });

/*
 * The public address of this deployment.
 *
 * Open Graph and canonical links have to be absolute, and a relative one is
 * silently dropped by every crawler that reads them, so a card shared into
 * WhatsApp or Slack comes out as a bare grey box. Set SITE_URL on the dashboard
 * service to the real domain; the fallback only keeps local builds working.
 */
const SITE_URL = (process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(
  /\/+$/,
  "",
);

const TAGLINE = "Find the businesses with no website, and write to them first";
const SUMMARY =
  "YEAN Leads finds local businesses whose online presence is broken or missing, checks each one, scores how badly they need a site, and drafts the message. You approve every message before it is sent.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `YEAN Leads, ${TAGLINE.toLowerCase()}`,
    // Every workspace page keeps its own name and picks up the product's.
    template: "%s · YEAN Leads",
  },
  description: SUMMARY,
  applicationName: "YEAN Leads",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "YEAN Leads",
    title: `YEAN Leads, ${TAGLINE.toLowerCase()}`,
    description: SUMMARY,
    locale: "en_NG",
  },
  twitter: {
    card: "summary_large_image",
    title: `YEAN Leads, ${TAGLINE.toLowerCase()}`,
    description: SUMMARY,
  },
  /*
   * The workspace is private and must stay out of every index. The landing
   * page overrides this for itself, which is the only page meant to be found.
   */
  robots: { index: false, follow: false },
  /*
   * The icons are not listed here on purpose. Next picks up app/favicon.ico,
   * app/icon.svg and app/apple-icon.png by name and emits the links itself with
   * cache-busting hashes, and declaring `icons` in metadata replaces that
   * whole mechanism with whatever is written here. Three files beat one list
   * that has to be kept in step with them.
   */
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Matches the landing page's header, so the browser chrome on a phone is the
  // same colour as the page rather than a white band above it.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

/** The theme is read per request, so an edit is live on the next navigation. */
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = await loadTheme();
  const fonts = [spaceGrotesk, dmSans, archivo, azeretMono].map((f) => f.variable).join(" ");

  /*
   * The theme is resolved on the server and written into the markup, so the
   * first frame the browser paints is already the right one. There is no boot
   * script reading storage, no effect correcting colours after hydration, and
   * so no flash of the wrong interface.
   *
   * Dark mode is decided here too when the mode is explicit. Only "system"
   * needs the inline script below, because the server cannot know what the
   * viewer's operating system prefers; that script runs before the first paint,
   * so it is still flash free.
   */
  const attributes = themeToAttributes(theme);
  const explicitDark = theme.mode === "dark";

  return (
    <html
      lang="en"
      className={`${fonts}${explicitDark ? " dark" : ""}`}
      style={{ colorScheme: explicitDark ? "dark" : "light" }}
      suppressHydrationWarning
      {...attributes}
    >
      <head>
        <style id={THEME_STYLE_ID} dangerouslySetInnerHTML={{ __html: themeToCss(theme) }} />
        {theme.mode === "system" && (
          <script
            dangerouslySetInnerHTML={{
              __html:
                "try{if(matchMedia('(prefers-color-scheme: dark)').matches){document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark'}}catch(e){}",
            }}
          />
        )}
      </head>
      <body>
        <ThemeProvider initial={theme}>
          <AppShell>{children}</AppShell>
          <MotionRuntime />
          <Toaster
            position="top-right"
            toastOptions={{
              className: "!border !border-line !bg-surface !text-ink",
              loading: {
                icon: <RiLoader4Line className="h-5 w-5 shrink-0 animate-spin" aria-hidden="true" />,
              },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
