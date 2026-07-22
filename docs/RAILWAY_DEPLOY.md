# Deploy to Railway

Two services (API + dashboard) plus a MongoDB, all in one Railway project. About 10 minutes.

## Read this first: set the Root Directory

This is a monorepo (`server/` and `dashboard/` in one repo). The single most reliable setup is to give each service a **Root Directory**, so Railway scopes the whole build and run to that one folder:

- API service: **Settings → Source → Root Directory = `server`**
- Dashboard service: **Settings → Source → Root Directory = `dashboard`**

That is the only build setting you need. With it, the repo works whether Railway builds with a Dockerfile or with its own builder (Railpack/Nixpacks): each folder has a `Dockerfile`, a `railway.json` that pins the start command, and a normal `npm run build` / `npm run start`. The server starts with `node dist/index.js` and the dashboard with `next start`, both bound to `0.0.0.0`.

Why this matters: without a Root Directory, Railway treats the repo as one npm-workspaces project and tries to start it with `npm run start --workspace=@yean/dashboard`, which fails at runtime with "No workspaces found". Setting the Root Directory avoids that entirely.

(If you would rather not set a Root Directory, there are repo-root `Dockerfile` and `Dockerfile.dashboard` files and a "without a Root Directory" section near the end. Root Directory is the recommended path.)

---

## 1. MongoDB

Railway project → **+ New → Database → Add MongoDB** (or use MongoDB Atlas and skip to step 2 with your Atlas URI).

Railway exposes the connection string as `${{MongoDB.MONGO_URL}}` for other services in the project.

## 2. API service (server)

1. **+ New → GitHub Repo →** select this repo.
2. **Settings → Source → Root Directory = `server`.** (The health check path `/health` comes from `server/railway.json` automatically.)
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

## 3. Dashboard service (dashboard)

`NEXT_PUBLIC_*` values are baked in at **build time**, so they're passed as build args.

1. **+ New → GitHub Repo →** same repo.
2. **Settings → Source → Root Directory = `dashboard`.**
3. **Settings → Build → Build args** (or Variables, Railway forwards them to the build):
   ```
   NEXT_PUBLIC_API_URL=https://yean-api.up.railway.app
   NEXT_PUBLIC_API_KEY=<same API_KEY as the server>
   ```
4. **Generate Domain.** Open it, you should see the overview page (or the first-run setup wizard).
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

## Deploy without a Root Directory

If you would rather not set a Root Directory, point each service at a root-level Dockerfile with **Settings → Build → Dockerfile Path**:

- API service: `Dockerfile.server` (or leave it blank; the root `Dockerfile` also builds the API).
- Dashboard service: `Dockerfile.dashboard`.

These build from the repo root and copy in only their own folder. Add the same variables and build args as sections 2 and 3. This works, but Root Directory is simpler and is what the steps above use.

## Config files in this repo, for reference

| File | Applies to | When it's used |
|---|---|---|
| `Dockerfile` (root) | API (server) | Default when a service points at the repo root with no Dockerfile Path. |
| `Dockerfile.server` (root) | API (server) | Same as the root `Dockerfile`; use it to be explicit. |
| `Dockerfile.dashboard` (root) | Dashboard | Set as the dashboard's Dockerfile Path when not using a Root Directory. |
| `server/Dockerfile`, `dashboard/Dockerfile` | That service | Used when the service Root Directory is `server` / `dashboard`. |
| `server/railway.json`, `dashboard/railway.json` | That service | Pins the start command (`node dist/index.js` / `npm run start`) and health check, read when the Root Directory is set. |
| `railway.json` (root) | A service with no Root Directory | Pins the API start command and health check for the root-`Dockerfile` case. |

Every start command is explicit (`node dist/index.js` for the API, `next start` for the dashboard), so Railway never falls back to the npm-workspaces command that caused the "No workspaces found" crash. Both apps bind to `0.0.0.0` and answer `GET /health` (the API also answers `GET /`).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `npm error No workspaces found: --workspace=@yean/dashboard` (or `@yean/server`) | The service is building the whole repo as a workspace. Set its Root Directory to `dashboard` / `server` (or set the Dockerfile Path per the section above) and redeploy. The repo's `railway.json` files pin an explicit start command so this won't recur. |
| `could not locate the Dockerfile at path Dockerfile in code archive` | Set the service Root Directory to `server` / `dashboard`, or set the Dockerfile Path to `Dockerfile.server` / `Dockerfile.dashboard`. |
| Healthcheck fails / "service unavailable" on every retry | The container isn't starting or isn't binding to `PORT`. With Root Directory set this is fixed: both apps bind to `0.0.0.0` on the injected `PORT` and answer `/health`. Check the deploy logs for a crash before the "listening" line. |
| Dashboard shows "Can't reach the API" | Check `NEXT_PUBLIC_API_URL` build arg + API `DASHBOARD_ORIGIN` (CORS) + `NEXT_PUBLIC_API_KEY` matches `API_KEY`. |
| `/api/*` returns 401 | Dashboard's `NEXT_PUBLIC_API_KEY` differs from the server `API_KEY`. |
| Discovery returns 503 | No discovery source configured. Add a Google Places key (and enable Places API New with billing), or enable manual import / the directory source. |
| Approve works but no draft | Email provider not configured or Gmail creds invalid; check the server logs. The approval is still recorded. |
