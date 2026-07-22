# Deploy to Railway

Two services (API + dashboard) plus a MongoDB, all in one Railway project. About 10 minutes.

## Read this first: how the Dockerfiles are laid out

This is a monorepo (`server/` and `dashboard/` in one repo). Railway builds each service from the repository root and, by default, looks for a file named `Dockerfile` at that root. To make the common case just work:

- There is a **root `Dockerfile` that builds the API (server)**. So the API service needs no build configuration at all: point it at the repo, add env vars, deploy.
- The **dashboard** builds from **`Dockerfile.dashboard`** at the repo root. Set that one field (Dockerfile Path) on the dashboard service.

If you previously saw this build error, it was because Railway looked for a `Dockerfile` at the repo root and there wasn't one. There is now.

You do not need to set a Root Directory. (If you prefer to, you can: set it to `server` / `dashboard` and Railway will use the per-folder `server/Dockerfile` / `dashboard/Dockerfile` instead. Either way works.)

---

## 1. MongoDB

Railway project → **+ New → Database → Add MongoDB** (or use MongoDB Atlas and skip to step 2 with your Atlas URI).

Railway exposes the connection string as `${{MongoDB.MONGO_URL}}` for other services in the project.

## 2. API service (server)

1. **+ New → GitHub Repo →** select this repo. Railway detects the root `Dockerfile` and builds the API. No Root Directory or Dockerfile Path needed.
2. Optional: under **Settings → Deploy**, set the health check path to `/health`.
3. **Variables:**
   ```
   MONGODB_URI=${{MongoDB.MONGO_URL}}
   PORT=4000
   API_KEY=<long-random-string>
   DASHBOARD_ORIGIN=https://<your-dashboard-domain>.up.railway.app
   GOOGLE_PLACES_API_KEY=<key>
   OPENAI_API_KEY=<key>            # or ANTHROPIC_API_KEY
   GMAIL_CLIENT_ID=<...>
   GMAIL_CLIENT_SECRET=<...>
   GMAIL_REFRESH_TOKEN=<...>
   GMAIL_SENDER=hello@yourdomain.com
   ENABLE_SCHEDULER=true
   TIMEZONE=Africa/Lagos
   ```
4. **Settings → Networking → Generate Domain.** Note the public URL (e.g. `https://yean-api.up.railway.app`).

> `MONGO_URL` from the Railway plugin usually targets the default `test` DB. Append a db name if you like: `${{MongoDB.MONGO_URL}}` → the app defaults the DB from the URI path; set `.../yean_leads` if your URI has no path.

## 3. Dashboard service (`dashboard/`)

`NEXT_PUBLIC_*` values are baked in at **build time**, so they're passed as Docker **build args**.

1. **+ New → GitHub Repo →** same repo.
2. **Settings → Build → Dockerfile Path:** set it to `Dockerfile.dashboard`. (The root `Dockerfile` builds the API, so the dashboard service needs this one field so it builds the dashboard instead.)
3. **Settings → Build → Build args** (or Variables, Railway forwards them to the Docker build):
   ```
   NEXT_PUBLIC_API_URL=https://yean-api.up.railway.app
   NEXT_PUBLIC_API_KEY=<same API_KEY as the server>
   ```
4. **Generate Domain.** Open it, you should see the overview page.
5. Go back to the API service and set `DASHBOARD_ORIGIN` to this dashboard URL (CORS), then redeploy the API.

## 4. First run

- Open the dashboard → **Overview → "Run discovery now"** (needs the Places key), or wait for the 07:00 Africa/Lagos cron.
- Or seed demo data by opening a one-off shell on the API service: `npm run seed`.
- Qualified leads land in **Approval Queue**. Edit → Approve → (Gmail) Send.

## 5. Scheduling notes

- The API has a **built-in scheduler** (`ENABLE_SCHEDULER=true`), no extra service needed.
- Prefer n8n? Set `ENABLE_SCHEDULER=false` and import `n8n/workflow.json` (see `n8n/README.md`) so runs aren't triggered twice.

## 6. Costs & scaling

- The website checker makes outbound HTTP requests concurrently (`CHECKER_CONCURRENCY`, default 3). The default Railway instance handles this fine; raise concurrency only if discovery volume grows.
- Keep `DAILY_EMAIL_CAP` conservative to protect Gmail sender reputation.
- MongoDB free/hobby tiers are plenty for tens of thousands of leads.

## Dockerfiles in this repo, for reference

| File | Builds | When it's used |
|---|---|---|
| `Dockerfile` (root) | API (server) | Default. Any service pointed at the repo root with no Dockerfile Path. |
| `Dockerfile.dashboard` (root) | Dashboard | Set as the dashboard service's Dockerfile Path. |
| `Dockerfile.server` (root) | API (server) | Same as the root `Dockerfile`; use it if you'd rather be explicit. |
| `server/Dockerfile` | API (server) | Only when the service Root Directory is `server`. |
| `dashboard/Dockerfile` | Dashboard | Only when the service Root Directory is `dashboard`. |

The root-level Dockerfiles copy in only their own folder, so the API build is never affected by the dashboard and vice versa.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `could not locate the Dockerfile at path Dockerfile in code archive` | Railway looked for a `Dockerfile` at the repo root. There is now a root `Dockerfile` (it builds the API), so pull the latest `main` and redeploy. For the dashboard service, set Dockerfile Path to `Dockerfile.dashboard`. |
| Dashboard deployed but shows the API JSON | The dashboard service is using the root `Dockerfile` (which builds the API). Set its Dockerfile Path to `Dockerfile.dashboard`. |
| Dashboard shows "Can't reach the API" | Check `NEXT_PUBLIC_API_URL` build arg + API `DASHBOARD_ORIGIN` (CORS) + `NEXT_PUBLIC_API_KEY` matches `API_KEY`. |
| `/api/*` returns 401 | Dashboard's `NEXT_PUBLIC_API_KEY` differs from the server `API_KEY`. |
| Discovery returns 503 | No discovery source configured. Add a Google Places key (and enable Places API New with billing), or enable manual import / the directory source. |
| Approve works but no draft | Email provider not configured or Gmail creds invalid; check the server logs. The approval is still recorded. |
| Health check failing on deploy | Railway injects `PORT` automatically and the app reads it. Set the health check path to `/health` on the API service under Settings → Deploy. |
