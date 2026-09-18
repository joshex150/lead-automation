import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Counter, HeroShot, Reveal, StickyHeader } from "@/components/landing/motion";
import "./landing.css";

/*
 * The public front of the site, and the only page meant to be indexed.
 *
 * The root layout marks everything noindex because the workspace is private.
 * This page opts itself back in, and carries the canonical link and the social
 * card, because it is the one page a stranger is supposed to arrive at.
 */
export const metadata: Metadata = {
  title: "YEAN Leads, find the businesses with no website",
  description:
    "Scan a city, check what each business actually has online, and score how badly they need a site. YEAN Leads drafts the message too, and nothing is sent until you approve it.",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: "/",
    title: "YEAN Leads, find the businesses with no website",
    description:
      "One scan of Lagos and Abuja returned 735 businesses in five and a half minutes. YEAN Leads checks every one, scores it, and drafts the message for you to approve.",
  },
  // Set here too, or the card falls back to the layout's wording and the two
  // say different things about the same page.
  twitter: {
    card: "summary_large_image",
    title: "YEAN Leads, find the businesses with no website",
    description:
      "One scan of Lagos and Abuja returned 735 businesses in five and a half minutes. Nothing is sent until you approve it.",
  },
};

/** The screenshots, in the order the page walks through the product. */
const SHOTS = {
  overview: { src: "/screens/01-overview.png", label: "yean-leads.app/overview" },
  queue: { src: "/screens/02-queue.png", label: "yean-leads.app/queue" },
  leads: { src: "/screens/03-leads.png", label: "yean-leads.app/leads" },
  detail: { src: "/screens/05-lead-detail.png", label: "yean-leads.app/leads/crystal-scents" },
  onboarding: { src: "/screens/08-onboarding.png", label: "first run" },
} as const;

function Shot({
  shot,
  alt,
  priority = false,
  crop = false,
}: {
  shot: { src: string; label: string };
  alt: string;
  priority?: boolean;
  crop?: boolean;
}) {
  return (
    <div className="l-shot">
      <div className="l-shot-bar">
        <span className="l-dot" />
        <span className="l-dot" />
        <span className="l-dot" />
        <span className="l-shot-label">{shot.label}</span>
      </div>
      <div className={crop ? "l-shot-crop" : undefined}>
        <Image src={shot.src} alt={alt} width={3200} height={2000} priority={priority} sizes="(max-width: 950px) 100vw, 1100px" />
      </div>
    </div>
  );
}

const STEPS = [
  {
    title: "Discover",
    body: "Google Places, by city and category. You can also paste a list of businesses you found yourself, or point it at a directory to crawl. A business that turns up twice is deduplicated into one lead.",
  },
  {
    title: "Check the website",
    body: "DNS, certificate, HTTP status, redirect loops, response time, mobile viewport, broken internal links, Shopify signatures, parking pages. A Linktree in the Google listing doesn't mean there's no website, so the checker follows it and looks.",
  },
  {
    title: "Find the contacts",
    body: "Email address, mobile number and Instagram handle, read off the business's own pages. Every value is stored with the page it came from and the date it was collected, which is what the NDPA asks you to keep.",
  },
  {
    title: "Score",
    body: "Weights you control. No website adds 40. A site that's down adds 40. Social media only adds 30, and a business that opened recently adds 25. Anything over your threshold goes to the queue.",
  },
  {
    title: "Write",
    body: "Your own AI key writes each message from what the check actually found. An email reads like an email. A WhatsApp message is shorter, and it doesn't sign off like a letter.",
  },
  {
    title: "Approve",
    body: "You read it, change what you want, and decide. Approving an email lead creates a Gmail draft you can still open before it goes out. Rejecting one takes it out of the queue for good.",
  },
];

const LIMITS = [
  {
    title: "It doesn't read your inbox",
    body: "Replies arrive in your own mailbox and you record the outcome on the lead by hand. There's no inbox integration, so a bounce stays invisible until you mark it as one. When you do, the address is retired and the lead is re-routed to whatever other contact it has.",
  },
  {
    title: "It doesn't send on a schedule",
    body: "Discovery can run on a cron every morning. Sending never does. Every message that leaves is one a person pressed a button for, which is slower on purpose.",
  },
  {
    title: "It isn't a mail server",
    body: "Gmail and Resend both send over HTTPS and work on any host. Plain SMTP needs outbound mail ports open, and Railway allows those on the Pro plan only, so on Hobby you'll want one of the other two.",
  },
  {
    title: "The AI is optional",
    body: "Without a key you get the built-in templates. They're accurate and a little generic, and any lead using one says so on its card so you can rewrite it later.",
  },
];

export default function LandingPage() {
  return (
    <div className="l">
      <StickyHeader>
        <Link href="/" className="l-brand">
          YEAN <span>Leads</span>
        </Link>
        <nav className="l-nav">
          <a href="#why">Why</a>
          <a href="#how">How it works</a>
          <a href="#queue">The approval gate</a>
          <a href="#limits">What it doesn't do</a>
        </nav>
        <Link href="/overview" className="l-btn l-btn-primary" style={{ height: 38, fontSize: 14 }}>
          Open the workspace
        </Link>
      </StickyHeader>

      <main>
        <section className="l-hero">
          <div className="l-wrap">
            <Reveal>
              <p className="l-kicker">Lead generation for a web studio</p>
              <h1 className="l-h1">
                Find the businesses with <em>no website</em>, and write to them first
              </h1>
            </Reveal>
            <Reveal delay={90}>
              <p className="l-lede" style={{ marginTop: 22 }}>
                YEAN Leads scans a city, opens what each business actually has online, and scores how badly they need a
                site. It drafts the message too. Nothing goes out until you've read it and pressed approve.
              </p>
              <div className="l-hero-cta">
                <Link href="/overview" className="l-btn l-btn-primary">
                  Open the workspace
                </Link>
                <a href="#how" className="l-btn l-btn-ghost">
                  See what a scan does
                </a>
              </div>
              <p className="l-hero-note">
                Google Places for discovery. Your own AI key for the writing. Gmail, Zoho or Resend for sending.
              </p>
            </Reveal>

            <HeroShot>
              <Shot shot={SHOTS.overview} alt="The overview, showing the pipeline funnel and what needs attention" priority crop />
            </HeroShot>
          </div>
        </section>

        <section className="l-section" id="why">
          <div className="l-wrap">
            <div className="l-section-head">
              <Reveal>
                <p className="l-kicker">Why this exists</p>
                <h2 className="l-h2" style={{ marginTop: 16 }}>
                  Cold outreach fails on volume or on quality
                </h2>
              </Reveal>
              <Reveal delay={80}>
                <p className="l-lede">
                  Send two hundred identical emails and nobody answers. Write two hundred good ones by hand and you've
                  lost a fortnight. Neither one is a business.
                </p>
              </Reveal>
            </div>

            <div className="l-split">
              <Reveal>
                <p className="l-lede">
                  The writing is the cheap part. Knowing who is worth writing to is what costs you. A restaurant with a
                  fast, working site has no use for you, and from a page of search results it looks exactly like the one
                  whose site has been down since March.
                </p>
                <p className="l-lede" style={{ marginTop: 20 }}>
                  So the scan does the looking. It opens every site it finds and checks whether the domain resolves,
                  whether the certificate is valid, how long the page takes to answer, whether it works on a phone, and
                  whether its own internal links are broken. What comes back is a list of businesses with a problem you
                  can fix, and the evidence for saying so.
                </p>
                <div className="l-quote" style={{ marginTop: 26 }}>
                  One scan of Lagos and Abuja, 18 searches, five and a half minutes. It came back with 735 businesses,
                  356 of which weren't on file yet.
                </div>
              </Reveal>
              <Reveal delay={120}>
                <Shot shot={SHOTS.detail} alt="A lead page showing the website audit, the score breakdown and where each contact came from" />
              </Reveal>
            </div>
          </div>
        </section>

        <section className="l-stats" aria-label="Figures from one real scan">
          <div className="l-stat">
            <p className="l-num">
              <Counter to={735} />
            </p>
            <p>businesses found in a single scan of two cities</p>
          </div>
          <div className="l-stat">
            <p className="l-num">
              <Counter to={356} />
            </p>
            <p>of them new, the rest already on file and skipped</p>
          </div>
          <div className="l-stat">
            <p className="l-num">
              <Counter to={18} />
            </p>
            <p>searches, finished in five and a half minutes</p>
          </div>
          <div className="l-stat">
            <p className="l-num">
              <Counter to={0} />
            </p>
            <p>messages sent without a person approving them</p>
          </div>
        </section>

        <section className="l-section" id="how">
          <div className="l-wrap">
            <div className="l-section-head">
              <Reveal>
                <p className="l-kicker">How it works</p>
                <h2 className="l-h2" style={{ marginTop: 16 }}>
                  Six steps, and you only do the last one
                </h2>
              </Reveal>
              <Reveal delay={80}>
                <p className="l-lede">
                  A run goes from an empty database to a queue of messages waiting for you. If it stops halfway, nothing
                  it found is lost: you can resume the searches that failed, or process the leads it already has.
                </p>
              </Reveal>
            </div>

            <ol className="l-steps">
              {STEPS.map((step, index) => (
                <Reveal as="li" key={step.title} className="l-step" delay={index * 60}>
                  <p className="l-step-n">{String(index + 1).padStart(2, "0")}</p>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        <section className="l-section" id="queue">
          <div className="l-wrap">
            <div className="l-section-head">
              <Reveal>
                <p className="l-kicker">The approval gate</p>
                <h2 className="l-h2" style={{ marginTop: 16 }}>
                  Nothing is sent without you
                </h2>
              </Reveal>
              <Reveal delay={80}>
                <p className="l-lede">
                  Every message waits here with its evidence beside it: why the business scored what it did, what's
                  wrong with its site, and which routes you have into it. Change a word or rewrite the whole thing.
                </p>
              </Reveal>
            </div>

            <Reveal>
              <Shot shot={SHOTS.queue} alt="The approval queue, showing a lead's score breakdown next to the drafted message and the approve, regenerate and reject buttons" />
            </Reveal>

            <div className="l-split" style={{ marginTop: 56 }}>
              <Reveal>
                <p className="l-lede">
                  Approving an email lead creates a real Gmail draft, so you can still open it in your mailbox before it
                  goes. Instagram and WhatsApp leads hand you the message and the profile, and you send it yourself,
                  because neither platform lets software do that for you and pretending otherwise would get the account
                  banned.
                </p>
                <p className="l-lede" style={{ marginTop: 20 }}>
                  A lead leaves the queue when it's been sent, marked as contacted, or rejected. Not when you approved
                  it. An approved message that hasn't gone anywhere is unfinished work, and it stays in front of you
                  until it isn't.
                </p>
              </Reveal>
              <Reveal delay={120}>
                <div className="l-list">
                  <div className="l-item">
                    <h3>One follow-up, then silence</h3>
                    <p>
                      A single follow-up goes out after the number of days you set, and only if there was no reply.
                      There is no second one, and no way to configure a second one.
                    </p>
                  </div>
                  <div className="l-item">
                    <h3>A daily cap you choose</h3>
                    <p>
                      Sending stops at your limit for the day. The queue tells you how much is left before you spend it,
                      rather than refusing the send you had already decided to make.
                    </p>
                  </div>
                  <div className="l-item">
                    <h3>A suppression list that holds</h3>
                    <p>
                      An address, domain, phone number or handle on the list is never stored again, not merely skipped
                      at send time. Anyone who asks to be left alone is opted out across the whole database at once.
                    </p>
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        <section className="l-section">
          <div className="l-wrap">
            <div className="l-split l-split-flip">
              <Reveal>
                <p className="l-kicker">Every lead keeps its evidence</p>
                <h2 className="l-h2" style={{ marginTop: 16, fontSize: "clamp(26px, 3.4vw, 36px)" }}>
                  Filter it the way you actually work
                </h2>
                <p className="l-lede" style={{ marginTop: 18 }}>
                  By city, category, what kind of website they have, how they can be reached, how high they scored, how
                  recently they appeared on Google, how fast their reviews are growing. A business that opened last
                  month and has no site is a different sales conversation from one that has traded for ten years behind
                  a broken one.
                </p>
                <p className="l-lede" style={{ marginTop: 20 }}>
                  Open any lead and you get the audit behind its score, the reason each contact was accepted or
                  rejected, and the page every email address and phone number came from.
                </p>
              </Reveal>
              <Reveal delay={120}>
                <Shot shot={SHOTS.leads} alt="The leads table with filters for city, category, website type and score" />
              </Reveal>
            </div>
          </div>
        </section>

        <section className="l-section" id="limits">
          <div className="l-wrap">
            <div className="l-section-head">
              <Reveal>
                <p className="l-kicker">Worth knowing before you start</p>
                <h2 className="l-h2" style={{ marginTop: 16 }}>
                  What it doesn't do
                </h2>
              </Reveal>
              <Reveal delay={80}>
                <p className="l-lede">
                  Four things it won't do for you, so you can decide whether that matters before you've built a workflow
                  on top of it.
                </p>
              </Reveal>
            </div>
            <div className="l-list">
              {LIMITS.map((limit, index) => (
                <Reveal key={limit.title} className="l-item" delay={index * 70}>
                  <h3>{limit.title}</h3>
                  <p>{limit.body}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="l-section">
          <div className="l-wrap">
            <div className="l-split">
              <Reveal>
                <p className="l-kicker">Setting it up</p>
                <h2 className="l-h2" style={{ marginTop: 16, fontSize: "clamp(26px, 3.4vw, 36px)" }}>
                  Targets first, keys whenever you like
                </h2>
                <p className="l-lede" style={{ marginTop: 18 }}>
                  The first time you open it, a short wizard asks which cities and categories you want. That's the only
                  part you have to answer. Everything else can be skipped and filled in from Settings later, and the
                  tool runs without any of it, just with fewer sources and template messages.
                </p>
                <p className="l-lede" style={{ marginTop: 20 }}>
                  Each provider has a Test button that makes a real request and reports what came back, so you find out
                  a key is wrong while you're looking at the form rather than three hundred leads into a scan.
                </p>
              </Reveal>
              <Reveal delay={120}>
                <Shot shot={SHOTS.onboarding} alt="The first-run setup wizard asking for target cities and categories" />
              </Reveal>
            </div>
          </div>
        </section>

        <section className="l-section" style={{ paddingBottom: 0, borderBottom: "none" }}>
          <div className="l-wrap">
            <Reveal>
              <div className="l-cta">
                <h2 className="l-h2" style={{ marginInline: "auto" }}>
                  Open the workspace
                </h2>
                <p className="l-lede" style={{ marginInline: "auto", marginTop: 18 }}>
                  The queue is where the work is. Everything else on this page exists to fill it.
                </p>
                <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginTop: 28 }}>
                  <Link href="/overview" className="l-btn l-btn-primary">
                    Open the workspace
                  </Link>
                  {/*
                    An anchor, not a link to the handbook. The handbook lives
                    inside the workspace and sends a signed-out visitor to a
                    login form, which is a poor answer to "tell me more".
                  */}
                  <a href="#queue" className="l-btn l-btn-ghost">
                    Look at the queue again
                  </a>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <div className="l-wrap">
          <footer className="l-foot">
            <p>YEAN Technologies, lead operations workspace.</p>
            <p>
              <Link href="/overview">Workspace</Link>
              <Link href="/help" style={{ marginLeft: 20 }}>
                Handbook
              </Link>
            </p>
          </footer>
        </div>
      </main>
    </div>
  );
}
