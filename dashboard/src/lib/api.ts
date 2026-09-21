import type {
  ImportResult,
  ImportRow,
  AnalyticsStats,
  IntegrationStatus,
  Lead,
  OutreachLogEntry,
  PipelineJob,
  PipelineOperationalStatus,
  Settings,
  Stats,
  SuppressionEntry,
  TemplatePitchSummary,
  TestResult,
} from "./types";

/**
 * Every call goes through the dashboard's own server, which attaches the API
 * key out of reach of the browser. Nothing here may read NEXT_PUBLIC_API_KEY:
 * Next inlines those into the client bundle, which is how the key used to leak.
 */
const API_BASE = "/api/proxy";

import { announceDataChange } from "./live";

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Paths are written as /api/... against the server; the proxy re-adds that
  // prefix on the far side, so strip it here rather than at every call site.
  const res = await fetch(`${API_BASE}${path.replace(/^\/api/, "")}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
    cache: "no-store",
  });

  // A session that expired while the tab was open should send the operator to
  // sign in again rather than showing a wall of failed requests.
  if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  }

  /*
   * An unreadable body is an error, not an empty object.
   *
   * This used to fall back to `{}` and hand it back cast as the expected type,
   * so a gateway answering 200 with an HTML error page produced a result whose
   * every field was undefined. Nothing failed at the call site; the crash
   * surfaced much later and somewhere else, as `undefined is not an object` on
   * a count the view was rendering, which takes the whole page down.
   *
   * Failures keep the lenient reading, because an error response is allowed to
   * carry no body and the status is the useful part anyway.
   */
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    if (res.ok) {
      throw new ApiError(res.status, `The server sent a response this page could not read (${res.status}).`);
    }
    body = {};
  }

  if (!res.ok) {
    throw new ApiError(res.status, (body as { error?: string }).error ?? `Request failed (${res.status})`);
  }

  // Any successful write changes what every other view is showing. Announcing
  // it here means no call site can forget to, which is how counters drift.
  // The stats cache is dropped first, so the refetch the announcement triggers
  // reads the new numbers rather than the ones from a moment ago.
  if (init.method && init.method !== "GET") {
    freshStats = null;
    announceDataChange();
  }

  return body as T;
}

/**
 * Stats is asked for twice on every page.
 *
 * The sidebar wants one integer for the approval badge and each view wants the
 * rest, and both fetch on mount, so two identical requests leave together. The
 * endpoint counts and groups the whole collection, and running it twice at once
 * meant the two runs contended: 3.3s of work took 7.5s, and the view's other
 * requests queued behind it. The queue page showed skeletons for eight seconds
 * because of it.
 *
 * The window only has to cover the mount burst. The view polls every 20s and
 * the sidebar every 30s, and those are meant to be separate reads, so a few
 * seconds collapses the duplicates without ever serving a stale number.
 */
const STATS_SHARE_MS = 3000;
let freshStats: { at: number; request: Promise<Stats> } | null = null;

function sharedStats(): Promise<Stats> {
  const now = Date.now();
  if (freshStats && now - freshStats.at < STATS_SHARE_MS) return freshStats.request;

  const request = req<Stats>("/api/stats");
  freshStats = { at: now, request };
  // A rejection must not be held, or every caller for the next few seconds
  // inherits one failure. Callers still see their own rejection.
  request.catch(() => {
    if (freshStats?.request === request) freshStats = null;
  });
  return request;
}

export const api = {
  stats: sharedStats,
  analytics: (days: number | "all") => req<AnalyticsStats>(`/api/stats/analytics?days=${days}`),

  leads: (params: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    }
    return req<{ items: Lead[]; total: number; page: number; pages: number }>(`/api/leads?${qs}`);
  },

  lead: (id: string) => req<{ lead: Lead; history: OutreachLogEntry[] }>(`/api/leads/${id}`),

  updateLead: (id: string, patch: Record<string, unknown>) =>
    req<{ lead: Lead }>(`/api/leads/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  approve: (id: string, notes?: string) =>
    req<{
      lead: Lead;
      draft: { draftId: string | null; provider: string; internal: boolean } | null;
      draftError: string | null;
    }>(`/api/leads/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ notes }),
    }),

  reject: (id: string, notes?: string) =>
    req<{ lead: Lead }>(`/api/leads/${id}/reject`, { method: "POST", body: JSON.stringify({ notes }) }),

  send: (id: string) => req<{ lead: Lead }>(`/api/leads/${id}/send`, { method: "POST", body: "{}" }),

  markContacted: (id: string, channel?: "INSTAGRAM_MANUAL" | "WHATSAPP") =>
    req<{ lead: Lead }>(`/api/leads/${id}/mark-contacted`, { method: "POST", body: JSON.stringify({ channel }) }),

  recordResponse: (id: string, status: string, note?: string, estimatedDealValue?: number) =>
    req<{ lead: Lead }>(`/api/leads/${id}/response`, {
      method: "POST",
      body: JSON.stringify({ status, note, estimatedDealValue }),
    }),

  convert: (id: string, dealValue?: number) =>
    req<{ lead: Lead }>(`/api/leads/${id}/convert`, { method: "POST", body: JSON.stringify({ dealValue }) }),

  optOut: (id: string, reason?: string) =>
    req<{ lead: Lead }>(`/api/leads/${id}/opt-out`, { method: "POST", body: JSON.stringify({ reason }) }),

  recheck: (id: string) => req<{ lead: Lead }>(`/api/leads/${id}/recheck`, { method: "POST", body: "{}" }),

  regeneratePitch: (id: string) =>
    req<{
      lead: Lead;
      pitch: { provider: string; model: string; fallbackReason?: string };
    }>(`/api/leads/${id}/regenerate-pitch`, { method: "POST", body: "{}" }),

  runDiscovery: (cities?: string[], categories?: string[]) =>
    req<{ runId: string; found: number; created: number }>(`/api/pipeline/discover`, {
      method: "POST",
      body: JSON.stringify({ cities, categories }),
    }),

  runProcess: () => req<{ processed: number; qualified: number }>(`/api/pipeline/process`, { method: "POST", body: "{}" }),

  runSources: () =>
    req<{ sources: Array<{ source: string; found: number; created: number }>; processing: { qualified: number } }>(
      `/api/pipeline/discover-sources`,
      { method: "POST", body: "{}" },
    ),

  importLeads: (items: ImportRow[], opts: { city?: string; category?: string } = {}) =>
    req<ImportResult>(`/api/pipeline/import`, {
      method: "POST",
      body: JSON.stringify({ items, city: opts.city, category: opts.category, process: true }),
    }),

  completeOnboarding: (complete: boolean) =>
    req<{ onboardedAt: string | null }>(`/api/settings/onboarding`, {
      method: "POST",
      body: JSON.stringify({ complete }),
    }),

  runFull: () =>
    req<{ found: number; created: number; processed: number; qualified: number }>(`/api/pipeline/run`, {
      method: "POST",
      body: "{}",
    }),

  startFullJob: () =>
    req<{ job: PipelineJob }>(`/api/pipeline/jobs/full`, {
      method: "POST",
      body: "{}",
    }),

  startProcessJob: () =>
    req<{ job: PipelineJob }>(`/api/pipeline/jobs/process`, {
      method: "POST",
      body: "{}",
    }),

  /** What is still carrying a built-in template message, and what fixing it costs. */
  templatePitches: () => req<TemplatePitchSummary>(`/api/pipeline/template-pitches`),

  startRewritePitchesJob: (channels?: Lead["outreachChannel"][]) =>
    req<{ job: PipelineJob }>(`/api/pipeline/jobs/rewrite-pitches`, {
      method: "POST",
      body: JSON.stringify({ channels }),
    }),

  resumeDiscoveryJob: (runId: string) =>
    req<{ job: PipelineJob }>(`/api/pipeline/runs/${runId}/resume`, {
      method: "POST",
      body: "{}",
    }),

  pipelineStatus: () => req<PipelineOperationalStatus>(`/api/pipeline/jobs/status`),

  pipelineJob: (id: string) => req<{ job: PipelineJob }>(`/api/pipeline/jobs/${id}`),

  cancelJob: (id: string) =>
    req<{ job: PipelineJob }>(`/api/pipeline/jobs/${id}/cancel`, { method: "POST", body: "{}" }),

  acknowledgeJob: (id: string) =>
    req<{ job: PipelineJob }>(`/api/pipeline/jobs/${id}/acknowledge`, { method: "POST", body: "{}" }),

  suppression: (page = 1) => req<{ items: SuppressionEntry[]; total: number; pages: number }>(`/api/suppression?page=${page}`),

  addSuppression: (type: string, value: string, reason?: string) =>
    req<{ entry: SuppressionEntry; affectedLeads: number }>(`/api/suppression`, {
      method: "POST",
      body: JSON.stringify({ type, value, reason }),
    }),

  deleteSuppression: (id: string) => req<{ deleted: boolean }>(`/api/suppression/${id}`, { method: "DELETE" }),

  settings: () => req<{ settings: Settings }>(`/api/settings`),

  updateSettings: (patch: Record<string, unknown>) =>
    req<{ settings: Settings }>(`/api/settings`, { method: "PUT", body: JSON.stringify(patch) }),

  integrationStatus: () => req<IntegrationStatus>(`/api/settings/integrations`),

  theme: () => req<{ theme: unknown; updatedAt?: string }>(`/api/theme`),

  saveTheme: (theme: unknown) =>
    req<{ theme: unknown }>(`/api/theme`, { method: "PUT", body: JSON.stringify({ theme }) }),

  resetTheme: () => req<{ theme: unknown }>(`/api/theme`, { method: "DELETE" }),

  testAi: () => req<TestResult>(`/api/settings/test-ai`, { method: "POST", body: "{}" }),
  testEmail: () => req<TestResult>(`/api/settings/test-email`, { method: "POST", body: "{}" }),
  testPlaces: () => req<TestResult>(`/api/settings/test-places`, { method: "POST", body: "{}" }),
};

export { ApiError };
