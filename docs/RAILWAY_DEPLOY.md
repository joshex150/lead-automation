# Deploy to Railway

Two services (API + dashboard) plus a MongoDB, all in one Railway project. About 10 minutes.

## Read this first: the Dockerfile path

This is a monorepo (`server/` and `dashboard/` in one repo), so each Railway service has to be told where its Dockerfile is. Get this wrong and the build fails with:

```
could not locate the Dockerfile at path Dockerfile in code archive
```

That error means Railway looked at the repository root and found no `Dockerfile` there (there isn't one at the root by design). Pick one of these two ways to point each service at the right Dockerfile. You only need one.

- Option A (recommended): set the service's Root Directory to `server` or `dashboard`. Railway then builds inside that folder and uses `server/Dockerfile` or `dashboard/Dockerfile`.
- Option B: leave Root Directory empty and set the Dockerfile Path to `Dockerfile.server` or `Dockerfile.dashboard` (both live at the repo root and build from there).

The steps below use Option A. If Option A gives you trouble, jump to "Option B" near the end; both are tested.

---

## 1. MongoDB

Railway project → **+ New → Database → Add MongoDB** (or use MongoDB Atlas and skip to step 2 with your Atlas URI).

Railway exposes the connection string as `${{MongoDB.MONGO_URL}}` for other services in the project.

## 2. API service (`server/`)

1. **+ New → GitHub Repo →** select this repo.
2. **Settings → Source → Root Directory:** set it to `server` (this is the step that fixes the "could not locate the Dockerfile" error). With this set, Railway builds inside `server/` and uses `server/Dockerfile` and `server/railway.json` (health check `/health`).
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
2. **Settings → Source → Root Directory:** set it to `dashboard` (same fix as the API service).
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

## Option B: deploy without a Root Directory

If setting the Root Directory doesn't work for you, leave it empty and point each service at a root-level Dockerfile instead. These build from the repository root and copy in only their own folder.

- API service: **Settings → Build → Builder = Dockerfile**, **Dockerfile Path = `Dockerfile.server`**. Same variables as section 2. Set the health check path to `/health` under Settings → Deploy.
- Dashboard service: **Builder = Dockerfile**, **Dockerfile Path = `Dockerfile.dashboard`**. Same build args as section 3.

Everything else (variables, domains, CORS) is identical. Use either Option A or Option B per service, not both.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `could not locate the Dockerfile at path Dockerfile in code archive` | The service has no Root Directory set, so Railway looked at the repo root where there's no Dockerfile. Set Root Directory to `server` or `dashboard` (Option A), or use Option B above and set Dockerfile Path to `Dockerfile.server` / `Dockerfile.dashboard`. |
| Dashboard shows "Can't reach the API" | Check `NEXT_PUBLIC_API_URL` build arg + API `DASHBOARD_ORIGIN` (CORS) + `NEXT_PUBLIC_API_KEY` matches `API_KEY`. |
| `/api/*` returns 401 | Dashboard's `NEXT_PUBLIC_API_KEY` differs from the server `API_KEY`. |
| Discovery returns 503 | No discovery source configured. Add a Google Places key (and enable Places API New with billing), or enable manual import / the directory source. |
| Approve works but no draft | Email provider not configured or Gmail creds invalid; check the server logs. The approval is still recorded. |
| Health check failing on deploy | Railway injects `PORT` automatically and the app reads it. With Option B, set the health check path to `/health` in the UI (Option A gets it from `server/railway.json`). |
