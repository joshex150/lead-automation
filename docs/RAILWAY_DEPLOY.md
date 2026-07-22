# Deploy to Railway

Two services (API + dashboard) plus a MongoDB, all in one Railway project. ~10 minutes.

---

## 1. MongoDB

Railway project → **+ New → Database → Add MongoDB** (or use MongoDB Atlas and skip to step 2 with your Atlas URI).

Railway exposes the connection string as `${{MongoDB.MONGO_URL}}` for other services in the project.

## 2. API service (`server/`)

1. **+ New → GitHub Repo →** select this repo.
2. **Settings → Root Directory:** `server`
   - Railway auto-detects `server/Dockerfile` and `server/railway.json` (health check `/health`).
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
2. **Settings → Root Directory:** `dashboard`
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

## Troubleshooting

| Symptom | Fix |
|---|---|
| Dashboard shows "Can't reach the API" | Check `NEXT_PUBLIC_API_URL` build arg + API `DASHBOARD_ORIGIN` (CORS) + `NEXT_PUBLIC_API_KEY` matches `API_KEY`. |
| `/api/*` returns 401 | Dashboard's `NEXT_PUBLIC_API_KEY` ≠ server `API_KEY`. |
| Discovery returns 503 | `GOOGLE_PLACES_API_KEY` missing or Places API (New) not enabled/billed. |
| Approve works but no draft | Gmail vars missing/invalid, check the server logs; approval still recorded. |
| Health check failing on deploy | Ensure `PORT` matches Railway's injected port (Railway sets `PORT` automatically; the app reads it). |
