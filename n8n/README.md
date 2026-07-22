# n8n workflow (optional)

The server has a **built-in scheduler** (`ENABLE_SCHEDULER=true`), so n8n is optional.
Use this workflow if you prefer orchestrating runs from n8n, want notifications,
or want to chain other tools (Telegram, Slack, Sheets) onto the pipeline.

## Import

1. In n8n: **Workflows → Import from file** → pick `workflow.json`.
2. Set two environment variables on your n8n instance:
   - `YEAN_API_URL`, e.g. `https://your-server.up.railway.app`
   - `YEAN_API_KEY`, the same value as the server's `API_KEY`
3. If n8n drives the schedule, set `ENABLE_SCHEDULER=false` on the server so
   runs aren't triggered twice.
4. Replace the final "Build notification" node with a real channel
   (Gmail / Telegram / Slack node) to get pinged when pitches await approval.

## What it does

```
Schedule (07:00) → POST /api/pipeline/run     (discover + check + score + pitch)
                 → POST /api/pipeline/follow-ups (one polite follow-up per lead, capped)
                 → GET  /api/stats
                 → IF pendingApproval > 0 → notification
```

All heavy lifting (dedupe, website checks, scoring, AI pitch, compliance
filtering) happens inside the API, n8n only orchestrates.
