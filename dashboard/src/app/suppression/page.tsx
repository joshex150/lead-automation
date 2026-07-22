"use client";

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { motion } from "framer-motion";
import { RiDeleteBin6Line, RiShieldCheckLine } from "react-icons/ri";
import { api } from "@/lib/api";
import type { SuppressionEntry } from "@/lib/types";

const TYPES = ["EMAIL", "PHONE", "DOMAIN", "INSTAGRAM", "PLACE_ID"];

export default function SuppressionPage() {
  const [entries, setEntries] = useState<SuppressionEntry[] | null>(null);
  const [form, setForm] = useState({ type: "EMAIL", value: "", reason: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    api
      .suppression()
      .then((r) => {
        if (!cancelled) setEntries(r.items);
      })
      .catch((e: Error) => {
        if (!cancelled) toast.error(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(load, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.value.trim()) return;
    setBusy(true);
    try {
      const r = await api.addSuppression(form.type, form.value.trim(), form.reason.trim() || undefined);
      toast.success(
        r.affectedLeads > 0 ? `Added, ${r.affectedLeads} existing lead(s) archived` : "Added to suppression list",
      );
      setForm({ ...form, value: "", reason: "" });
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.deleteSuppression(id);
      setEntries((prev) => prev?.filter((e) => e._id !== id) ?? null);
      toast.success("Removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <motion.header initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="font-heading text-3xl font-extrabold tracking-tight sm:text-4xl">
          Suppression{" "}
          <span className="bg-gradient-to-r from-brand-600 to-purple-600 bg-clip-text text-transparent">list</span>
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
          Anyone here is never contacted again, the NDPA right to object, honoured permanently. Adding an entry also
          archives every matching lead.
        </p>
      </motion.header>

      <motion.form
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        onSubmit={add}
        className="glass-card mt-8 flex flex-wrap items-end gap-3 p-5"
      >
        <div>
          <label className="label">Type</label>
          <select className="input !w-36" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="min-w-52 flex-1">
          <label className="label">Value</label>
          <input
            className="input"
            placeholder="e.g. owner@business.ng, +2348031234567, business.ng, @username"
            value={form.value}
            onChange={(e) => setForm({ ...form, value: e.target.value })}
          />
        </div>
        <div className="min-w-40 flex-1">
          <label className="label">Reason (optional)</label>
          <input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </div>
        <button disabled={busy} className="btn-primary">
          <RiShieldCheckLine className="h-4 w-4" /> Suppress
        </button>
      </motion.form>

      <div className="glass-card mt-6 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-slate-200/60 text-left text-xs uppercase tracking-wider text-slate-400 dark:border-slate-800/60">
              <th className="px-5 py-3.5">Type</th>
              <th className="px-5 py-3.5">Value</th>
              <th className="px-5 py-3.5">Reason</th>
              <th className="px-5 py-3.5">Added</th>
              <th className="px-5 py-3.5" />
            </tr>
          </thead>
          <tbody>
            {entries?.map((e) => (
              <tr key={e._id} className="border-b border-slate-100 dark:border-slate-800/40">
                <td className="px-5 py-3">
                  <span className="rounded-full bg-slate-500/15 px-2.5 py-1 text-[11px] font-bold text-slate-500">
                    {e.type}
                  </span>
                </td>
                <td className="px-5 py-3 font-medium">{e.value}</td>
                <td className="px-5 py-3 text-slate-500">{e.reason ?? ", "}</td>
                <td className="px-5 py-3 text-xs text-slate-400">{new Date(e.createdAt).toLocaleDateString()}</td>
                <td className="px-5 py-3 text-right">
                  <button
                    onClick={() => remove(e._id)}
                    className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-500"
                    title="Remove"
                  >
                    <RiDeleteBin6Line className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
            {entries && entries.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-14 text-center text-slate-400">
                  Suppression list is empty.
                </td>
              </tr>
            )}
            {!entries &&
              [...Array(4)].map((_, i) => (
                <tr key={i}>
                  <td colSpan={5} className="px-5 py-4">
                    <div className="h-6 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
