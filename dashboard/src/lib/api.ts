import type { IntegrationStatus, Lead, OutreachLogEntry, Settings, Stats, SuppressionEntry, TestResult } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? "";

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { "x-api-key": API_KEY } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, (body as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export const api = {
  stats: () => req<Stats>("/api/stats"),

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
    req<{ lead: Lead }>(`/api/leads/${id}/regenerate-pitch`, { method: "POST", body: "{}" }),

  runDiscovery: (cities?: string[], categories?: string[]) =>
    req<{ runId: string; found: number; created: number }>(`/api/pipeline/discover`, {
      method: "POST",
      body: JSON.stringify({ cities, categories }),
    }),

  runProcess: () => req<{ processed: number; qualified: number }>(`/api/pipeline/process`, { method: "POST", body: "{}" }),

  runFull: () =>
    req<{ found: number; created: number; processed: number; qualified: number }>(`/api/pipeline/run`, {
      method: "POST",
      body: "{}",
    }),

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

  testAi: () => req<TestResult>(`/api/settings/test-ai`, { method: "POST", body: "{}" }),
  testEmail: () => req<TestResult>(`/api/settings/test-email`, { method: "POST", body: "{}" }),
  testPlaces: () => req<TestResult>(`/api/settings/test-places`, { method: "POST", body: "{}" }),
};

export { ApiError };
