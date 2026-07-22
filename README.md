# YEAN Lead Automation

A **semi-automated lead-generation engine** for YEAN Technologies: it discovers Nigerian businesses, audits their online presence, scores how badly they need a website, drafts a personalised pitch with AI, and queues everything for **your approval** before a single message goes out.

```
Google Places API ──► Website Health Checker ──► Enrichment ──► Lead Scoring
                                                                    │
      Gmail draft ◄── Approval Dashboard ◄── AI Pitch  ◄── qualified (score ≥ 50)
          │
          ▼
   You click Send ──► CRM tracking ──► one polite follow-up ──► Interested? → won deal
```

Stack: Node.js, Express and TypeScript on the server, MongoDB via Mongoose, a Next.js dashboard, Google Places API (New) for discovery, your choice of OpenAI, Anthropic, NVIDIA or any OpenAI-compatible model for pitches, and Gmail, Zoho or Resend for email. Provider keys and most settings live in the database and are edited from the dashboard, so there is little to no `.env` to manage. Deploys to Railway.

---

## What it does

| Step | What happens | Where |
|---|---|---|
| 0. Set up | First-run wizard walks you through targets and lead sources; only targets are required, everything else is skippable and editable later | `dashboard/src/components/OnboardingGate.tsx` |
| 1. Discover | Multiple toggleable sources feed one pipeline: Google Places (listed businesses), manual/bulk import (catch new businesses early), and a directory/sitemap crawler. Deduped across sources | `server/src/services/discovery` |
| 2. Check website | DNS → SSL → HTTP status → redirect loops → response time → mobile viewport → SEO tags → broken pages → Shopify signatures → Linktree/menu platforms → parking pages | `server/src/services/websiteChecker` |
| 3. Classify | `NO_WEBSITE` `BROKEN_WEBSITE` `SHOPIFY` `LINK_IN_BIO_ONLY` `MENU_PLATFORM_ONLY` `SOCIAL_MEDIA_ONLY` `CUSTOM_WEBSITE` `POOR_WEBSITE` | `classify.ts` |
| 4. Enrich | Email, WhatsApp, Instagram scraped from the business's **own public pages**, with provenance recorded for every value | `server/src/services/enrichment` |
| 5. Score | Configurable weights (no website +40, broken +40, social-only +30, opening soon +25 …). Score ≥ threshold → approval queue | `server/src/services/scoring` |
| 6. Pitch | AI writes a specific, warm, 70-120-word pitch from the business's actual situation, in a plain house style (no em dashes, no hype). Falls back to templates if no AI key | `server/src/services/pitch` |
| 7. Approve | Dashboard queue: edit the pitch, Approve creates a draft (Gmail) or readies it to send (Zoho/Resend), Send dispatches it. Instagram leads get an open-profile plus copy-message manual flow | `dashboard/` |
| 8. Follow up | Exactly **one** follow-up after N days, only if no response. Daily email cap. Full audit log | `server/src/services/outreach` |
| 9. Win | Record replies, mark **Interested** → **Converted** with deal value. Revenue shows on the overview | CRM routes |

## Monorepo layout

```
├── server/          Express API + pipeline + scheduler (deploy → Railway service 1)
├── dashboard/       Next.js approval dashboard          (deploy → Railway service 2)
├── n8n/             Optional importable n8n workflow
├── docs/            Setup, Railway deploy, architecture, compliance
└── docker-compose.yml  Local stack (MongoDB + API + dashboard)
```

## Quick start (local)

```bash
# 1. Prereqs: Node 20+, MongoDB running locally (or Docker: docker compose up mongo)
npm install

# 2. Configure
cp .env.example server/.env       # fill in what you have; everything degrades gracefully

# 3. Run the API
npm run dev:server                # http://localhost:4000/health

# 4. Try it immediately with demo data (no API keys needed)
npm run seed --workspace server

# 5. Run the dashboard
echo "NEXT_PUBLIC_API_URL=http://localhost:4000" > dashboard/.env.local
npm run dev:dashboard             # http://localhost:3000 → check the Approval Queue
```

Or run everything with Docker: `docker compose up --build`.

## Deploy to Railway

Full walkthrough: **[docs/RAILWAY_DEPLOY.md](docs/RAILWAY_DEPLOY.md)**. Short version:

1. Create a Railway project → **Deploy MongoDB** from the template gallery.
2. **New service → GitHub repo** for the API. Set **Settings → Source → Root Directory = `server`**. Add env vars (`MONGODB_URI=${{MongoDB.MONGO_URL}}`, `API_KEY`, optionally `GOOGLE_PLACES_API_KEY` and AI/email keys, or set those later in the dashboard).
3. **New service → same repo** for the dashboard. Set **Root Directory = `dashboard`** and build args `NEXT_PUBLIC_API_URL` (the API's public URL) and `NEXT_PUBLIC_API_KEY`.
4. Done. First open of the dashboard runs the setup wizard; the server's built-in cron then discovers leads every morning (Africa/Lagos) and queues pitches for you.

Setting each service's Root Directory is the one thing that matters on a monorepo; the repo handles the rest whether Railway builds with Docker or its own builder. Full walkthrough: [docs/RAILWAY_DEPLOY.md](docs/RAILWAY_DEPLOY.md).

## Configuration

Most config lives in the database and is edited from the dashboard Settings page: the Google Places key, the AI provider and key, the email provider and credentials, scheduler crons, guardrails, and scoring weights. Secrets come back masked, and changes apply live with no redeploy. The `.env` file (see [`.env.example`](.env.example)) is a fallback and only `MONGODB_URI`, `PORT`, `API_KEY`, and `DASHBOARD_ORIGIN` really need to be there.

Provider options you can set from the dashboard:

| Setting | Options |
|---|---|
| AI pitch writer | OpenAI, Anthropic, NVIDIA NIM, or any OpenAI-compatible endpoint (Groq, Together, Ollama, vLLM). Template fallback when off. |
| Email sending | Gmail (real drafts), Zoho or any SMTP mailbox, Resend. |
| Lead sources | Google Places, manual/bulk import, and a directory/sitemap crawler. Each is an independent toggle, all additive. See [docs/DISCOVERY_SOURCES.md](docs/DISCOVERY_SOURCES.md). |
| Discovery | Target cities and categories, results per query. |
| Scheduler | Discovery and follow-up crons, timezone, on/off. Applies live. |
| Guardrails | Score threshold, daily email cap, follow-up delay, max contact attempts, scoring weights. |

Each provider section has a Test button that round-trips a real request so you know it works before the first run.

## API surface

All routes under `/api` require the `x-api-key` header when `API_KEY` is set.

```
GET  /health                          liveness (no auth)
POST /api/pipeline/run                discover (all enabled sources) + process
POST /api/pipeline/discover           Google Places discovery only
POST /api/pipeline/discover-sources   run the non-Places sources only
POST /api/pipeline/import             manual/bulk lead import {items, city?, category?}
POST /api/pipeline/process            process unchecked leads
POST /api/pipeline/follow-ups         send due follow-ups
POST /api/pipeline/check-website      ad-hoc website audit {url}
GET  /api/pipeline/runs               discovery run history

GET  /api/leads                       filters: stage, websiteType, city, minScore, search…
GET  /api/leads/:id                   lead + outreach history
PATCH /api/leads/:id                  edit contacts/pitch/notes (auto-rescores)
POST /api/leads/:id/approve           approve → Gmail draft
POST /api/leads/:id/send              send approved email (respects daily cap)
POST /api/leads/:id/mark-contacted    manual IG/WhatsApp outreach done
POST /api/leads/:id/response          POSITIVE | NEUTRAL | NEGATIVE | OPT_OUT | BOUNCED
POST /api/leads/:id/convert           won the deal (+ deal value)
POST /api/leads/:id/opt-out           NDPA right to object
POST /api/leads/:id/recheck           re-run website check + rescore
POST /api/leads/:id/regenerate-pitch  new AI pitch

GET/POST/DELETE /api/suppression      never-contact list
GET/PUT /api/settings                 cities, categories, providers, sources, weights, caps
POST /api/settings/onboarding         mark first-run setup complete or re-open it
POST /api/settings/test-ai|test-email|test-places   provider connection tests
GET  /api/stats                       funnel, revenue, integrations, leads by source
```

## Compliance (built in, not bolted on)

- **Provenance**: every email/phone/Instagram handle stores *where* it came from and *when*.
- **Suppression list**: opt-outs suppress email + phone + domain + Instagram + Place ID permanently; new discoveries matching the list are never even stored.
- **One follow-up max**, never after any reply; `MAX_CONTACT_ATTEMPTS` hard cap.
- **Opt-out line in every email** ("reply 'unsubscribe'"), honouring Nigeria's NDPA right to object.
- **Business contacts only**, from public business listings and the business's own website.
- Details: [docs/COMPLIANCE.md](docs/COMPLIANCE.md).

## Testing

```bash
npm test --workspace server        # ~200 tests: classifier, scoring, extraction, phone, email/AI
                                   # providers, runtime-config resolution and secret masking,
                                   # plus a full API integration suite (in-memory or real MongoDB)
```

## Docs

- [docs/SETUP.md](docs/SETUP.md), providers: Google Places, AI (OpenAI/Anthropic/NVIDIA/custom), email (Gmail/Zoho/Resend)
- [docs/DISCOVERY_SOURCES.md](docs/DISCOVERY_SOURCES.md), finding leads earlier than Google Places
- [docs/RAILWAY_DEPLOY.md](docs/RAILWAY_DEPLOY.md), step-by-step Railway deployment
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), how the pipeline fits together
- [docs/COMPLIANCE.md](docs/COMPLIANCE.md), NDPA controls and outreach policy
- [n8n/README.md](n8n/README.md), optional n8n orchestration
