"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { RiDeleteBin6Line, RiShieldCheckLine, RiLoader4Line, RiForbidLine, RiErrorWarningLine } from "react-icons/ri";
import { api } from "@/lib/api";
import type { SuppressionEntry } from "@/lib/types";

const TYPES = ["EMAIL", "PHONE", "DOMAIN", "INSTAGRAM", "PLACE_ID"];

export default function SuppressionPage() {
  const [entries, setEntries] = useState<SuppressionEntry[] | null>(null);
  const [form, setForm] = useState({ type: "EMAIL", value: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    api
      .suppression()
      .then((result) => {
        if (!cancelled) setEntries(result.items);
      })
      .catch((e: Error) => {
        if (!cancelled) toast.error(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(load, [load]);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!form.value.trim()) return;
    setBusy(true);
    try {
      const result = await api.addSuppression(form.type, form.value.trim(), form.reason.trim() || undefined);
      toast.success(
        result.affectedLeads > 0
          ? `Suppressed and archived ${result.affectedLeads} matching lead${result.affectedLeads === 1 ? "" : "s"}`
          : "Added to the suppression list",
      );
      setForm({ ...form, value: "", reason: "" });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add suppression entry");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setRemoving(id);
    try {
      await api.deleteSuppression(id);
      setEntries((previous) => previous?.filter((entry) => entry._id !== id) ?? null);
      toast.success("Suppression entry removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove entry");
    } finally {
      setRemoving(null);
    }
  }

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const entry of entries ?? []) counts[entry.type] = (counts[entry.type] ?? 0) + 1;
    return counts;
  }, [entries]);

  return (
    <div className="page-shell">
      <header className="page-header">
        <div>
          <p className="page-kicker">Compliance control</p>
          <h1 className="page-title">Suppression list</h1>
          <p className="page-subtitle">
            Permanently honour opt-outs and prevent matching emails, phones, domains, Instagram accounts, or Place IDs from re-entering outreach.
          </p>
        </div>
        <div className="page-actions">
          <span className="status-badge border-rose-500 bg-rose-500/5 text-rose-500">
            <RiForbidLine className="mr-1 h-4 w-4" /> {entries?.length ?? 0} suppressed
          </span>
        </div>
      </header>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {TYPES.map((type) => (
          <div key={type} className="metric-card accent-rose !min-h-28">
            <p className="metric-value !mt-0 !text-2xl">{typeCounts[type] ?? 0}</p>
            <p className="metric-label">{type.replaceAll("_", " ")}</p>
          </div>
        ))}
      </section>

      <form onSubmit={add} className="panel accent-rose mt-6 border-t-4">
        <div className="section-heading">
          <div>
            <h2 className="section-title">Add a suppression rule</h2>
            <p className="section-description">Matching existing leads are archived immediately; future discoveries are rejected before storage.</p>
          </div>
          <RiShieldCheckLine className="h-5 w-5 text-rose-500" />
        </div>
        <div className="grid items-end gap-3 lg:grid-cols-12">
          <div className="lg:col-span-2">
            <label className="label" htmlFor="suppression-type">Type</label>
            <select id="suppression-type" className="input" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
              {TYPES.map((type) => <option key={type}>{type}</option>)}
            </select>
          </div>
          <div className="lg:col-span-5">
            <label className="label" htmlFor="suppression-value">Value</label>
            <input
              id="suppression-value"
              className="input"
              placeholder="owner@business.ng, +234…, business.ng, or @username"
              value={form.value}
              onChange={(event) => setForm({ ...form, value: event.target.value })}
            />
          </div>
          <div className="lg:col-span-3">
            <label className="label" htmlFor="suppression-reason">Reason</label>
            <input
              id="suppression-reason"
              className="input"
              placeholder="Optional compliance note"
              value={form.reason}
              onChange={(event) => setForm({ ...form, reason: event.target.value })}
            />
          </div>
          <button disabled={busy || !form.value.trim()} className="btn-danger lg:col-span-2">
            {busy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : <RiShieldCheckLine className="h-4 w-4" />}
            {busy ? "Adding…" : "Suppress"}
          </button>
        </div>
      </form>

      <div className="desktop-table table-shell">
        <table className="data-table min-w-[720px]">
          <thead>
            <tr><th>Type</th><th>Suppressed value</th><th>Reason</th><th>Source</th><th>Added</th><th aria-label="Remove" /></tr>
          </thead>
          <tbody>
            {entries?.map((entry) => (
              <tr key={entry._id}>
                <td><span className="status-badge border-rose-500 bg-rose-500/5 text-rose-500">{entry.type}</span></td>
                <td className="font-bold">{entry.value}</td>
                <td className="text-slate-500 dark:text-slate-400">{entry.reason || "No reason provided"}</td>
                <td className="text-xs capitalize text-slate-500">{entry.source.replaceAll("_", " ").toLowerCase()}</td>
                <td className="text-xs text-slate-400">{new Date(entry.createdAt).toLocaleDateString("en-NG")}</td>
                <td className="text-right">
                  <button
                    type="button"
                    onClick={() => remove(entry._id)}
                    disabled={removing !== null}
                    className="inline-flex h-10 w-10 items-center justify-center border border-slate-300 text-slate-400 hover:border-rose-500 hover:bg-rose-500/5 hover:text-rose-500 dark:border-slate-700"
                    title="Remove suppression entry"
                  >
                    {removing === entry._id ? <RiLoader4Line className="animate-spin" /> : <RiDeleteBin6Line />}
                  </button>
                </td>
              </tr>
            ))}
            {!entries && [...Array(5)].map((_, index) => <tr key={index}><td colSpan={6}><div className="skeleton-block h-7" /></td></tr>)}
            {entries && entries.length === 0 && (
              <tr><td colSpan={6} className="py-16 text-center text-slate-400">Suppression list is empty.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mobile-record-list">
        {!entries && [...Array(4)].map((_, index) => <div key={index} className="skeleton-block mb-3 h-32" />)}
        {entries?.map((entry) => (
          <article key={entry._id} className="mobile-record">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="status-badge border-rose-500 bg-rose-500/5 text-rose-500">{entry.type}</span>
                <h2 className="mt-2 break-all font-heading text-base font-extrabold">{entry.value}</h2>
              </div>
              <button
                type="button"
                onClick={() => remove(entry._id)}
                disabled={removing !== null}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center border border-slate-300 text-slate-400 hover:border-rose-500 hover:text-rose-500 dark:border-slate-700"
                aria-label={`Remove ${entry.value}`}
              >
                {removing === entry._id ? <RiLoader4Line className="animate-spin" /> : <RiDeleteBin6Line />}
              </button>
            </div>
            <div className="mobile-record-grid">
              <div><span className="mobile-record-label">Reason</span><span className="text-sm text-slate-600 dark:text-slate-300">{entry.reason || "No reason provided"}</span></div>
              <div><span className="mobile-record-label">Added</span><span className="text-sm text-slate-600 dark:text-slate-300">{new Date(entry.createdAt).toLocaleDateString("en-NG")}</span></div>
            </div>
          </article>
        ))}
        {entries && entries.length === 0 && (
          <div className="empty-state mt-4">
            <div className="empty-state-icon"><RiErrorWarningLine /></div>
            <h2 className="mt-4 font-heading text-lg font-extrabold">No suppression rules</h2>
            <p className="mt-2 text-sm text-slate-500">Opt-outs and manual exclusions will appear here.</p>
          </div>
        )}
      </div>
    </div>
  );
}
