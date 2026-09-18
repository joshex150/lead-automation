#!/usr/bin/env node
/**
 * Mobile overflow audit.
 *
 * Loads every route at real phone widths against a live API and fails on
 * anything that pushes past the edge of the screen. The rule it enforces is the
 * one that matters on a phone: the page may scroll down, never sideways, and
 * nothing may be cut off at the right edge.
 *
 * `overflow-x: hidden` on the page shell hides the symptom without fixing it,
 * so the document's own scrollWidth is not enough on its own. Every element is
 * measured against the viewport too, and anything sticking out is reported even
 * when a parent is quietly clipping it.
 *
 *   npm run dev            # dashboard, and the API it talks to
 *   node audit-mobile.mjs  # add --shots to write screenshots
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const BASE = arg("base", "http://localhost:3000");
const SHOTS = argv.includes("--shots");
const SHOT_DIR = path.join(__dirname, ".audit-shots");

/** iPhone SE, common Android, iPhone Pro Max, small tablet, tablet. */
const WIDTHS = arg("widths", "320,360,390,430,768,1024").split(",").map(Number);

const ROUTES = [
  { path: "/", name: "landing" },
  { path: "/overview", name: "overview" },
  { path: "/analytics", name: "analytics" },
  { path: "/queue", name: "queue" },
  { path: "/leads", name: "leads" },
  { path: "/leads?stage=DISCOVERED", name: "leads filtered" },
  { path: "/suppression", name: "suppression" },
  { path: "/settings", name: "settings" },
  { path: "/site-control", name: "site control" },
  { path: "/help", name: "help" },
  {
    path: "/site-control",
    name: "site control, every tab",
    async open(page) {
      // Each tab renders different controls, so one visit only proves one of
      // them fits. Sliders and colour rows are the likeliest to push wide.
      for (const tab of ["Colour", "Corners", "Type", "Sizing", "Motion", "Layout", "Brand"]) {
        const button = page.getByRole("button", { name: tab, exact: true }).first();
        if (await button.count()) {
          await button.click().catch(() => {});
          await page.waitForTimeout(220);
          const found = await page.evaluate(PROBE);
          if (found.length) page.__extra = [...(page.__extra ?? []), ...found.map((f) => ({ ...f, tab }))];
        }
      }
      await page.waitForTimeout(200);
    },
  },
  {
    path: "/leads",
    name: "leads with filters open",
    async open(page) {
      const more = page.getByRole("button", { name: /more filters|filters/i }).first();
      if (await more.count()) await more.click().catch(() => {});
      await page.waitForTimeout(400);
    },
  },
];

/** Runs in the page. Returns everything that crosses the right edge. */
const PROBE = () => {
  const vw = window.innerWidth;
  const out = [];
  const doc = document.scrollingElement;

  if (doc.scrollWidth > vw + 1) {
    out.push({ kind: "page-scrolls-sideways", sel: "document", detail: `${doc.scrollWidth}px of content in ${vw}px` });
  }

  const describe = (el) => {
    const cls = (typeof el.className === "string" ? el.className : "").split(/\s+/).filter(Boolean).slice(0, 3).join(".");
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${cls ? `.${cls}` : ""}`;
  };

  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
    if (el.classList.contains("sr-only")) continue;
    // A deliberately scrollable box is allowed to hold something wider than
    // itself; that is what the scrollbar is for.
    if (/(auto|scroll)/.test(cs.overflowX)) continue;

    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;

    // Sticking out past the viewport is the failure, whether or not an
    // ancestor is hiding it.
    if (r.right > vw + 1 || r.left < -1) {
      // Inside a deliberate scroller the content is reachable, which is the
      // accepted way to show a wide table on a narrow screen. Inside an
      // overflow:hidden ancestor it is simply gone, and that is the fault.
      let reachable = false;
      let hiddenBy = null;
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        const ox = getComputedStyle(n).overflowX;
        if (/(auto|scroll)/.test(ox)) {
          reachable = true;
          break;
        }
        if (/(hidden|clip)/.test(ox) && !hiddenBy) hiddenBy = describe(n);
      }
      if (reachable) continue;

      out.push({
        kind: hiddenBy ? "clipped-and-unreachable" : "outside-viewport",
        sel: describe(el),
        text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50),
        detail:
          `left=${r.left.toFixed(0)} right=${r.right.toFixed(0)} width=${r.width.toFixed(0)} viewport=${vw}` +
          (hiddenBy ? `, hidden by ${hiddenBy}` : ""),
      });
    }
  }

  // Report the outermost offender per selector so one wide table does not
  // produce a hundred findings.
  const seen = new Set();
  return out.filter((f) => {
    const k = `${f.kind}|${f.sel}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/**
 * Sign in first when the deployment has auth turned on, otherwise every route
 * redirects to the login page and the audit measures that instead.
 */
async function signIn(context) {
  const user = process.env.DASHBOARD_USER;
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return;
  const page = await context.newPage();
  const res = await page.request.post(`${BASE}/api/auth/login`, {
    data: { username: user ?? "admin", password },
  });
  if (!res.ok()) throw new Error(`audit could not sign in: ${res.status()}`);
  await page.close();
}

/**
 * Waits for the real page, not for the network.
 *
 * Every data view fetches after hydration, so `networkidle` resolves while the
 * page is still a column of placeholders, and the audit was measuring those.
 * Analytics takes about ten seconds to fill in; the old wait was half a second,
 * so a clean result on that route meant a skeleton fits on a phone.
 *
 * Waiting for the skeletons to go rather than for any particular element keeps
 * this route-agnostic, and handles a filter that legitimately matches nothing:
 * the empty state replaces the skeleton just as a table would.
 */
async function settled(page, timeout = 30000) {
  await page
    .waitForFunction(() => document.querySelectorAll(".skeleton-block").length === 0, null, { timeout })
    .catch(() => {});
}

/**
 * Applies a theme preset through the interface before measuring.
 *
 * Layout is now a setting, so "nothing overflows" is only true of the theme in
 * force. A preset with looser spacing, larger display type or a wider sidebar
 * is a different layout and has to be measured as one.
 */
async function applyPreset(context, preset) {
  const page = await context.newPage();
  await page.goto(`${BASE}/site-control`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const button = page.getByRole("button", { name: new RegExp(`^${preset}`, "i") }).first();
  if ((await button.count()) === 0) throw new Error(`audit could not find the ${preset} preset`);
  await button.click();
  await page.waitForTimeout(500);
  const save = page.getByRole("button", { name: /Save appearance/ });
  if (await save.count()) await save.click();
  await page.waitForTimeout(1200);
  await page.close();
}

const PREINSTALLED = "/opt/pw-browsers/chromium";
const browser = await chromium.launch(fs.existsSync(PREINSTALLED) ? { executablePath: PREINSTALLED } : {});
const findings = [];
let checks = 0;
if (SHOTS) fs.rmSync(SHOT_DIR, { recursive: true, force: true });

const PRESET = arg("preset", "");
if (PRESET) {
  const setup = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await signIn(setup);
  await applyPreset(setup, PRESET);
  await setup.close();
  console.log(`theme in force: ${PRESET}`);
}

for (const width of WIDTHS) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    deviceScaleFactor: 2,
    isMobile: width < 768,
    hasTouch: width < 768,
  });
  await signIn(context);
  const page = await context.newPage();

  for (const route of ROUTES) {
    await page.goto(`${BASE}${route.path}`, { waitUntil: "networkidle" }).catch(() => {});
    await settled(page);

    /*
     * The first-run wizard covers the whole screen until onboarding is marked
     * complete, so against a fresh database every route measures the wizard and
     * the audit reports that nothing overflows. Stopping is the point: a clean
     * result has to mean the pages were clean, not that they were never seen.
     */
    if (await page.locator("[data-onboarding-gate]").count()) {
      console.error(
        `\nThe onboarding wizard is covering ${route.path}, so there is nothing to measure.\n` +
          "Mark onboarding complete first:\n" +
          `  curl -X POST "$API_URL/api/settings/onboarding" -H "x-api-key: $API_KEY" \\\n` +
          `       -H 'content-type: application/json' -d '{"complete":true}'\n`,
      );
      process.exit(2);
    }
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    await page.waitForTimeout(500);
    if (route.open) await route.open(page).catch(() => {});
    await page.waitForTimeout(200);

    const found = [...(await page.evaluate(PROBE)), ...(page.__extra ?? [])];
    page.__extra = [];
    checks++;
    for (const f of found) findings.push({ width, route: route.name + (f.tab ? `, ${f.tab}` : ""), ...f });

    if (SHOTS) {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(SHOT_DIR, `${route.name.replace(/\s+/g, "-")}-${width}.png`), fullPage: true });
    }
  }
  await context.close();
}

await browser.close();

const order = ["page-scrolls-sideways", "outside-viewport", "clipped-and-unreachable"];
findings.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.width - b.width);

console.log(`route/width combinations checked: ${checks}`);
if (findings.length === 0) {
  console.log("nothing overflows the screen");
  process.exit(0);
}
console.log(`\nissues (${findings.length}):`);
for (const f of findings) {
  console.log(`  ${f.kind}  ${f.route} @${f.width}  ${f.sel}`);
  if (f.text) console.log(`      text: ${f.text}`);
  console.log(`      ${f.detail}`);
}
process.exit(1);
