"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  RiSearchLine,
  RiRocketLine,
  RiRadarLine,
  RiInboxArchiveLine,
  RiContactsBook2Line,
  RiBarChartBoxLine,
  RiForbidLine,
  RiPaletteLine,
  RiSettings4Line,
  RiQuestionLine,
  RiShieldCheckLine,
  RiToolsLine,
  RiKeyboardLine,
} from "react-icons/ri";
import { useTheme } from "@/lib/theme/provider";

/**
 * The manual.
 *
 * Written to be read by somebody who has the dashboard open in another tab and
 * a question they want answered now. Every section says what a thing is, what
 * to do with it, and what to do when it goes wrong, in that order. The search
 * box filters whole sections rather than highlighting words, because the useful
 * unit here is "the bit about the approval queue", not a single sentence.
 */

interface Article {
  id: string;
  title: string;
  summary: string;
  icon: React.ComponentType<{ className?: string }>;
  body: React.ReactNode;
  /** Extra words that should match the search without appearing in the text. */
  keywords?: string;
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex min-w-0 gap-3 py-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center border border-brand-600 text-[11px] font-extrabold text-brand-600">
        {n}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-bold">{title}</p>
        <div className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{children}</div>
      </div>
    </li>
  );
}

function Rows({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="mt-3 border border-slate-200 text-sm dark:border-slate-800">
      {rows.map(([term, description]) => (
        <div key={term} className="grid gap-1 border-b border-slate-200 p-3 last:border-b-0 sm:grid-cols-[minmax(0,13rem)_1fr] sm:gap-4 dark:border-slate-800">
          <dt className="min-w-0 break-words font-bold">{term}</dt>
          <dd className="min-w-0 break-words leading-relaxed text-slate-600 dark:text-slate-300">{description}</dd>
        </div>
      ))}
    </dl>
  );
}

function Note({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warn" }) {
  const cls =
    tone === "warn"
      ? "border-cta-500/40 bg-cta-500/5 text-cta-700 dark:text-cta-400"
      : "border-brand-500/40 bg-brand-500/5 text-brand-700 dark:text-brand-400";
  return <p className={`mt-3 border-l-4 p-3 text-sm leading-relaxed ${cls}`}>{children}</p>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm leading-relaxed text-slate-600 first:mt-0 dark:text-slate-300">{children}</p>;
}

function H({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-6 font-heading text-sm font-extrabold first:mt-0">{children}</h3>;
}

const ARTICLES: Article[] = [
  {
    id: "what-it-is",
    title: "What this system does",
    summary: "The whole loop in one page, and the one rule that governs it.",
    icon: RiRocketLine,
    keywords: "overview intro start beginning pipeline how it works",
    body: (
      <>
        <P>
          This is a lead engine for a web studio. It finds Nigerian businesses, works out how badly each one needs a
          website, writes them a message about it, and puts that message in front of you. It never sends anything you
          have not approved.
        </P>
        <P>That last sentence is the rule the whole system is built around. Everything automatic stops at your queue.</P>
        <H>The loop</H>
        <ol className="mt-2 divide-y divide-slate-200 dark:divide-slate-800">
          <Step n={1} title="Discover">
            Google Places is searched for every combination of your cities and categories. Businesses you already have
            are recognised and skipped, so running a scan twice does not create duplicates.
          </Step>
          <Step n={2} title="Check the website">
            Each business&apos;s website is audited: does the domain resolve, is the certificate valid, what does it
            return, how fast, is it mobile ready, is it actually a Linktree or a menu platform rather than a site of
            their own. Businesses with no website at all skip straight past this.
          </Step>
          <Step n={3} title="Enrich">
            Contact details are collected from the business&apos;s own public pages, and each one is recorded with where
            it came from. Addresses that look like the agency who built the site, or a template&apos;s placeholder, are
            rejected rather than saved.
          </Step>
          <Step n={4} title="Score">
            Two numbers. <b>Need</b> is how badly they need the work, and it alone decides whether a lead qualifies.
            <b> Reach</b> is how easily you can contact them, and it only affects the order you work them in.
          </Step>
          <Step n={5} title="Write the pitch">
            A message is drafted from that business&apos;s actual situation, in the house voice. If the AI provider is
            down or unset, a solid template is used instead and the lead is marked so you know.
          </Step>
          <Step n={6} title="You decide">
            The lead lands in the approval queue with everything that was found about it. You edit, approve, or reject.
          </Step>
          <Step n={7} title="Outreach and follow-up">
            Email leads can be sent from here. Instagram and WhatsApp leads give you the message and a link, and you
            send it yourself. Exactly one follow-up goes out afterwards, and only if nobody replied.
          </Step>
        </ol>
      </>
    ),
  },
  {
    id: "first-run",
    title: "Setting it up the first time",
    summary: "What you must configure, what can wait, and what happens if you skip it.",
    icon: RiToolsLine,
    keywords: "onboarding setup wizard api key google places configure install",
    body: (
      <>
        <P>
          On a fresh install a short wizard asks for the things it cannot guess. Only the first is compulsory; the rest
          can be filled in later from <Link href="/settings" className="link-underline font-bold text-brand-600">Settings</Link>.
        </P>
        <Rows
          rows={[
            ["Cities and categories", "Where to hunt and what kind of business to look for. Every pairing becomes one search, so six cities and ten categories is sixty searches."],
            ["Google Places key", "The discovery source. Without it you can still import leads by hand, but nothing will be found automatically."],
            ["AI provider", "Optional. Without one, every pitch uses the built-in template, which is perfectly sendable, just less specific."],
            ["Email provider", "Optional. Without one, you can still approve email leads, you just cannot dispatch them from here."],
          ]}
        />
        <Note tone="warn">
          If your Google Places key is restricted by HTTP referrer, discovery will fail with a 403. Calls come from the
          server, not a browser, so the key needs an IP restriction or none at all, not a website restriction.
        </Note>
      </>
    ),
  },
  {
    id: "scanning",
    title: "Running a scan",
    summary: "Full scan, discovery only, processing, and how to recover an interrupted run.",
    icon: RiRadarLine,
    keywords: "run full scan discovery process pipeline job resume stuck progress",
    body: (
      <>
        <P>
          Everything starts from the buttons on the <Link href="/overview" className="link-underline font-bold text-brand-600">Overview</Link>. A
          scan runs in the background on the server, so you can close the tab and it carries on. Progress is saved
          continuously; nothing is lost if the browser, or the server, goes away mid-run.
        </P>
        <Rows
          rows={[
            ["Run full scan", "Discovery, then checking, scoring and writing, in one job. The normal thing to press."],
            ["Process N discovered", "Appears when businesses were found but not yet checked. Runs the second half without spending Places quota again."],
            ["Write N pending messages", "Appears when leads qualified but have no message yet, usually after an AI outage. Finishes them and moves them into the queue."],
            ["Resume N searches", "Appears when some searches failed, usually a rate limit. Retries only the ones that failed, not the whole scan."],
          ]}
        />
        <H>Only one job at a time</H>
        <P>
          The pipeline takes a lock, so a second scan cannot start while one is running. If a job dies unexpectedly the
          lock is released automatically on the next start, and unfinished work is offered back to you rather than
          being silently dropped.
        </P>
        <H>When Places rate limits you</H>
        <P>
          The system slows itself down, honours the wait the provider asks for, and after a bounded number of retries
          stops cleanly and marks the remaining searches resumable. It does not hammer the API and it does not pretend
          the scan finished.
        </P>
      </>
    ),
  },
  {
    id: "scoring",
    title: "How leads are scored",
    summary: "Need, reach and priority, and why a lead with no phone number can still qualify.",
    icon: RiBarChartBoxLine,
    keywords: "score need reach priority threshold qualified disqualified weights ranking",
    body: (
      <>
        <P>Every lead carries three numbers, and confusing them is the easiest way to misread the queue.</P>
        <Rows
          rows={[
            ["Need", <>How badly this business needs a website. No website at all scores highest; a link-in-bio page or a menu platform scores nearly as high; a good custom site scores negative. <b>Need alone decides whether a lead qualifies.</b></>],
            ["Reach", "How easily you can contact them: an email is worth most, then WhatsApp, then a phone number, plus a bonus for an active Instagram. Reach never disqualifies anybody."],
            ["Priority", "Three parts need, one part reach. This is the order the approval queue is sorted in."],
          ]}
        />
        <Note>
          Keeping these apart is deliberate. A business with a terrible web presence and no contact details is still a
          real opportunity, it is just harder to start. Folding contactability into qualification used to disqualify
          exactly the businesses most worth having.
        </Note>
        <H>The threshold</H>
        <P>
          A lead qualifies when its need score reaches the threshold in Settings, which ships at 50. Raise it to see
          fewer, more desperate leads; lower it to widen the net. Changing the threshold does not re-score anything on
          its own; run a scan, or use the rescore script, to apply it to leads you already have.
        </P>
        <H>Changing the weights</H>
        <P>
          Every signal&apos;s weight is editable in Settings, and there is a Recommended defaults button to put them
          back. The queue shows you the exact breakdown per lead, so if a score surprises you, open the lead and read
          which rules fired.
        </P>
      </>
    ),
  },
  {
    id: "queue",
    title: "Working the approval queue",
    summary: "Reading a card, the channel filter, and what approve actually does on each channel.",
    icon: RiInboxArchiveLine,
    keywords: "approval queue approve reject regenerate send collapse expand filter channel email instagram whatsapp",
    body: (
      <>
        <P>
          The <Link href="/queue" className="link-underline font-bold text-brand-600">approval queue</Link> is where you
          spend your time. Highest priority first. Each lead is a card you can collapse, so a queue of several hundred
          stays scannable; the first one opens automatically, and Expand all opens the rest.
        </P>
        <H>Contact routes</H>
        <P>
          Under every business name is a row of chips showing every way into that business, with a tick on the one
          outreach will use. A lead showing <b>No contact route</b> has no email, no Instagram handle and no mobile
          number: the message is written but there is nowhere to send it. Open it on Google Maps, or add a contact on the
          lead page.
        </P>
        <H>The channel filter</H>
        <P>
          All, Email, Instagram, WhatsApp and No route, each with a count. If a filter shows zero, that is the honest
          answer: no lead in the queue is reachable that way. Zero on Email usually means enrichment found no addresses,
          which happens when the businesses have no websites to scrape.
        </P>
        <H>What each button does</H>
        <Rows
          rows={[
            ["Approve, email lead", "Records the approval and creates a draft with your email provider. Nothing is sent yet. Send email dispatches it, subject to the daily cap."],
            ["Approve, Instagram or WhatsApp lead", "Records the approval and leaves the queue. Open profile or Open WhatsApp takes you there with the message ready; Mark contacted records that you sent it."],
            ["Regenerate", "Writes this business a fresh message of its own, even if it was sharing one. Also the way to retry after an AI outage."],
            ["Reject", "Removes the lead from the queue and records why. It is not deleted, and it is not contacted."],
          ]}
        />
        <Note tone="warn">
          Edits to the subject or message are saved when you approve, not as you type. The card tells you when there
          are unsaved edits.
        </Note>
      </>
    ),
  },
  {
    id: "pitches",
    title: "How the messages are written",
    summary: "The house voice, shared messages, and the template fallback.",
    icon: RiQuestionLine,
    keywords: "pitch ai message shared reuse template fallback tone voice writing groq openai anthropic",
    body: (
      <>
        <P>
          Each message opens with something specific about that business, presents the problem as an opportunity rather
          than an insult, makes one low-pressure ask, and signs off. It avoids the tells that make outreach read as
          machine written: no em dashes, no hype words, no invented facts, no claim to have visited.
        </P>
        <H>Shared messages</H>
        <P>
          A scan of several hundred businesses usually contains only a dozen or so genuinely distinct situations: a
          fashion store with no website, a restaurant whose site is down. Rather than buy an AI call per lead, one
          message is written per situation and the business name and city are filled in per lead. A card written that
          way is marked <b>Shared message</b>.
        </P>
        <P>
          Two things are never shared: a lead with its own Instagram bio or recent post worth mentioning, because that
          detail is the whole value of the message, and any lead you press Regenerate on. The behaviour can be switched
          off entirely under AI pitch writer in Settings.
        </P>
        <H>When the AI is unavailable</H>
        <P>
          The engine falls back to a built-in template written for each website situation, marks the lead{" "}
          <b>Template fallback</b>, and carries on. It also stops calling the provider for a cooling-off period rather
          than retrying hundreds of times. Once the provider is back, Regenerate replaces any template pitch.
        </P>
      </>
    ),
  },
  {
    id: "leads",
    title: "Finding leads in the database",
    summary: "Filters, sorting, search, and importing leads by hand.",
    icon: RiContactsBook2Line,
    keywords: "leads table filter sort search import bulk csv paste maturity source contactable",
    body: (
      <>
        <P>
          <Link href="/leads" className="link-underline font-bold text-brand-600">All leads</Link> is everything the
          system has ever seen, qualified or not. Filters combine, and the URL carries them, so a filtered view can be
          bookmarked or shared.
        </P>
        <Rows
          rows={[
            ["Stage", "Where the lead is in the pipeline, from discovered through to archived."],
            ["Website type", "The classification: no website, broken, link-in-bio only, menu platform only, social only, Shopify, poor, or a good custom site."],
            ["Maturity", "New, emerging or established, inferred from how many Google reviews the business has."],
            ["Contactable", "Filter by which routes exist: email, phone, WhatsApp, Instagram, any, or none."],
            ["Score range", "Filter on need. Combine with maturity to find, say, brand new businesses with nothing online."],
            ["Search", "Matches business name, category, city, address, email, phone and Instagram handle."],
          ]}
        />
        <H>Importing your own</H>
        <P>
          Leads you found yourself, a referral, an Instagram discovery, a name from a directory, can be pasted in from
          the Leads page. They go through exactly the same checks, scoring and pitch writing as anything Places found,
          and are deduplicated against what you already have.
        </P>
      </>
    ),
  },
  {
    id: "analytics",
    title: "Reading the analytics",
    summary: "What each figure is measuring, and the window it is measured over.",
    icon: RiBarChartBoxLine,
    keywords: "analytics stats reports metrics conversion funnel revenue",
    body: (
      <>
        <P>
          <Link href="/analytics" className="link-underline font-bold text-brand-600">Analytics</Link> is scoped to a
          time window, shown at the top. Everything on the page respects it, so comparing two figures from the page is
          always comparing like with like.
        </P>
        <Rows
          rows={[
            ["Qualified opportunities", "Leads whose need score cleared the threshold in this window."],
            ["Average priority", "The average working order of the cohort. Need and reach are shown separately underneath."],
            ["New or emerging", "Businesses with few reviews. These are the ones most likely to still be choosing a web presence."],
            ["Contactable now", "How many have at least one route in. If this is low, enrichment is the thing to improve, not discovery."],
            ["Score distribution", "Where the cohort sits against the threshold. A wall of leads just under it means the threshold is worth revisiting."],
          ]}
        />
      </>
    ),
  },
  {
    id: "compliance",
    title: "Suppression, opt-outs and conduct",
    summary: "Never-contact lists, the right to object, and the guardrails you cannot turn off.",
    icon: RiForbidLine,
    keywords: "suppression opt out ndpa gdpr compliance unsubscribe blocklist cap limit spam",
    body: (
      <>
        <P>
          <Link href="/suppression" className="link-underline font-bold text-brand-600">Suppression</Link> is the
          never-contact list. Add an email, phone, domain, Instagram handle or place id, and any lead matching it is
          archived immediately and can never be contacted again.
        </P>
        <H>Opt-outs</H>
        <P>
          Recording an opt-out on a lead is permanent. Opted-out leads are excluded from every list, every scan and
          every follow-up by default, and no rescore or reprocess will bring them back.
        </P>
        <H>Guardrails that are always on</H>
        <Rows
          rows={[
            ["Nothing sends itself", "Every outbound message passes through your approval first."],
            ["One follow-up, ever", "A single follow-up after the configured number of days, and only if there was no reply."],
            ["Daily send cap", "A hard ceiling on emails per day, checked before every send, not just at the start of a batch."],
            ["Provenance on every contact", "Each address and number records where it came from, so you can always answer how you got it."],
          ]}
        />
      </>
    ),
  },
  {
    id: "theme",
    title: "Changing how the dashboard looks",
    summary: "Presets, colour, corners, motion and ordering, and how to undo it all.",
    icon: RiPaletteLine,
    keywords: "theme control site control colour color corners radius border motion animation preset dark mode brand logo layout order",
    body: (
      <>
        <P>
          <Link href="/site-control" className="link-underline font-bold text-brand-600">Theme control</Link> edits the
          whole interface. Changes apply to the page as you make them, so what you are looking at is the result; Save
          publishes it to everyone.
        </P>
        <Rows
          rows={[
            ["Presets", "A complete look in one click. Your navigation order and product naming survive; everything visual is replaced."],
            ["Colour", "Two palettes, one per mode, plus the neutral ramp behind every surface. A legibility check warns you when a pairing is too close to read."],
            ["Corners", "One master radius, or unlink and set cards, buttons, inputs and badges separately. Pills keep their own value so avatars and spinners stay round."],
            ["Sizing", "Density, gutters, control height, row height, sidebar and content width. This is how you make the interface denser or roomier."],
            ["Motion", "A master switch, intensity and speed, then each effect on its own. Anyone whose system asks for reduced motion gets none of it regardless."],
            ["Layout", "Reorder or hide navigation entries, overview sections and headline metrics. Drag a row or use the arrows."],
          ]}
        />
        <Note>
          Theme control cannot be hidden from the navigation. It is the only way back from a hidden one.
        </Note>
        <P>Reset to default returns everything to the shipped appearance. Revert throws away unsaved edits only.</P>
      </>
    ),
  },
  {
    id: "settings",
    title: "Settings, reference",
    summary: "Every setting, what it changes, and what a sensible value looks like.",
    icon: RiSettings4Line,
    keywords: "settings configuration cron schedule threshold cap providers keys timeout concurrency",
    body: (
      <>
        <Rows
          rows={[
            ["Cities and categories", "The search grid. Every pairing is one Places search per scan, so this is the main driver of cost and run time."],
            ["Score threshold", "The need score a lead must reach to qualify. Ships at 50."],
            ["Scoring weights", "Every signal's contribution to need and reach. Recommended defaults restores them."],
            ["Follow-up days", "How long to wait before the single follow-up."],
            ["Daily email cap", "The hard ceiling on sends per day."],
            ["Max results per query", "How deep to page each Places search. Each page is twenty results, three pages maximum."],
            ["Places requests per minute", "Project-wide pacing. The conservative default protects your quota."],
            ["AI provider, key, model", "OpenAI, Anthropic, Groq, NVIDIA, or any OpenAI-compatible endpoint via a base URL. Blank key with a base URL works for a local server."],
            ["Share one message per situation", "Whether pitches are grouped. On by default."],
            ["Email provider", "Gmail for drafts you send from Gmail, or Zoho or Resend to dispatch from here."],
            ["Scheduler", "Cron expressions for the automatic discovery and follow-up runs, and the timezone they are read in."],
            ["Website checker", "Timeout, redirect limit and concurrency. Raise concurrency for speed, lower it if you are being rate limited."],
            ["Lead sources", "Toggles for manual import and the directory crawler, alongside Places."],
          ]}
        />
        <Note tone="warn">
          Keys entered here are stored in the database and shown masked afterwards. Saving a masked value leaves the
          stored key alone, so you can edit other fields without retyping it.
        </Note>
      </>
    ),
  },
  {
    id: "troubleshooting",
    title: "When something looks wrong",
    summary: "The symptoms that come up most, and what each one actually means.",
    icon: RiShieldCheckLine,
    keywords: "troubleshoot problem error empty queue no leads 403 429 not working broken help fix",
    body: (
      <>
        <Rows
          rows={[
            ["The queue is empty but I have hundreds of leads", <>They qualified without getting a message. The Overview shows <b>Write N pending messages</b>; press it. This happens after an AI outage or a rescore.</>],
            ["Every lead says No contact route", "Enrichment found nothing. Usually the businesses have no website to scrape, or their sites returned 403 to the checker. Leads with a Nigerian mobile number are reachable on WhatsApp; if none of yours are, check the numbers Places returned."],
            ["The Email filter shows zero", "No lead in the queue has an email address. Not a broken button; the count next to each filter tells you the same thing."],
            ["Discovery fails with 403", "The Places key is restricted by HTTP referrer. Calls come from the server, so use an IP restriction or none."],
            ["Discovery stops partway", "A rate limit. The run is marked resumable and the Overview offers to retry only the searches that failed."],
            ["Every pitch says Template fallback", "No AI provider is configured, or the one configured is failing. Test AI in Settings reports the real error."],
            ["Approving does not create a draft", "No email provider is configured, or the lead is not an email lead. The approval is still recorded."],
            ["Numbers look stale", "Every view refreshes on its own after any change and on a slow poll. If a figure is stuck, the API is probably unreachable, which the Overview says outright."],
          ]}
        />
      </>
    ),
  },
  {
    id: "shortcuts",
    title: "Small things worth knowing",
    summary: "Habits that make the daily loop quicker.",
    icon: RiKeyboardLine,
    keywords: "tips tricks shortcuts productivity workflow",
    body: (
      <>
        <Rows
          rows={[
            ["Collapse the navigation", "The control at the foot of the sidebar. It remembers your choice."],
            ["Filtered views are links", "The leads page keeps its filters in the URL, so any view can be bookmarked."],
            ["The funnel is clickable", "Every stage on the Overview funnel opens the leads page filtered to that stage."],
            ["Read the breakdown", "If a score surprises you, the queue card lists every rule that fired and what it was worth."],
            ["Regenerate is free of charge to you", "It always writes that one business its own message, and always tries the provider even during a cooling-off period."],
            ["Nothing is deleted", "Rejecting and archiving keep the record. Only suppression is final, and even that keeps the lead."],
          ]}
        />
      </>
    ),
  },
];

export default function HelpPage() {
  const { theme } = useTheme();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string>(ARTICLES[0].id);

  // Deep links from elsewhere in the app, and from the browser's back button.
  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.replace("#", "");
      if (id && ARTICLES.some((a) => a.id === id)) setOpen(id);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ARTICLES;
    return ARTICLES.filter((a) =>
      `${a.title} ${a.summary} ${a.keywords ?? ""}`.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <div className="page-shell">
      <header className="page-header">
        <div className="min-w-0">
          <p className="page-kicker">Guide</p>
          <h1 className="page-title">Help</h1>
          <p className="page-subtitle">
            How {theme.brand.productName} works, screen by screen, with what to do when something does not look right.
          </p>
        </div>
      </header>

      <div className="toolbar">
        <label className="sr-only" htmlFor="help-search">
          Search the guide
        </label>
        <div className="relative min-w-0 flex-1">
          <RiSearchLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            id="help-search"
            className="input pl-9"
            placeholder="Search: queue, scoring, 403, shared message, corners…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
          {matches.length} of {ARTICLES.length} topics
        </span>
      </div>

      {matches.length === 0 && (
        <div className="empty-state mt-6">
          <div className="empty-state-icon">
            <RiQuestionLine />
          </div>
          <h2 className="mt-4 font-heading text-xl font-extrabold">Nothing matches that</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            Try a word from the interface itself, such as approve, threshold, suppression, or the number in an error
            message.
          </p>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {matches.map((article) => {
          const Icon = article.icon;
          const expanded = open === article.id;
          return (
            <article key={article.id} id={article.id} className="panel !p-0">
              <h2>
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? "" : article.id)}
                  aria-expanded={expanded}
                  aria-controls={`help-${article.id}`}
                  className="flex w-full min-w-0 items-start gap-3 p-4 text-left sm:p-5"
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border border-brand-600 text-brand-600">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-heading text-base font-extrabold">{article.title}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                      {article.summary}
                    </span>
                  </span>
                  <span className="mt-1 shrink-0 text-xs font-bold text-slate-400">{expanded ? "Hide" : "Read"}</span>
                </button>
              </h2>
              {expanded && (
                <div id={`help-${article.id}`} className="min-w-0 border-t border-slate-200 p-4 sm:p-5 dark:border-slate-800">
                  {article.body}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
