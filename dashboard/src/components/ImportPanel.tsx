"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { RiUploadCloud2Line, RiCloseLine, RiCheckLine, RiLoader4Line, RiFileList3Line } from "react-icons/ri";
import { api } from "@/lib/api";
import type { ImportRow } from "@/lib/types";

/** Parse one loose CSV/tab-separated business line into an import row. */
export function parseLine(line: string): ImportRow | null {
  const parts = line
    .split(/[,\t]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const row: ImportRow = { businessName: "" };
  const leftovers: string[] = [];
  for (const part of parts) {
    if (!row.businessName) {
      row.businessName = part;
      continue;
    }
    if (/^https?:\/\//i.test(part) || /^[a-z0-9-]+\.[a-z]{2,}/i.test(part)) {
      row.websiteUrl = /^https?:\/\//i.test(part) ? part : `https://${part}`;
    } else if (/^@/.test(part) || /instagram\.com/i.test(part)) {
      row.instagramUsername = part.replace(/.*instagram\.com\//i, "").replace(/^@/, "").replace(/\/.*$/, "");
    } else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(part)) {
      row.email = part;
    } else if (/^\+?[\d\s()-]{7,}$/.test(part)) {
      row.phone = part;
    } else {
      leftovers.push(part);
    }
  }
  if (leftovers.length && !row.city) row.city = leftovers[0];
  if (leftovers.length > 1 && !row.category) row.category = leftovers[1];
  return row.businessName ? row : null;
}

export function ImportPanel({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone?: () => void }) {
  const [text, setText] = useState("");
  const [city, setCity] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);

  const rows = text
    .split("\n")
    .map(parseLine)
    .filter((row): row is ImportRow => row !== null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, busy, onClose]);

  async function submit() {
    if (rows.length === 0) {
      toast.error("Add at least one business");
      return;
    }
    setBusy(true);
    try {
      const result = await api.importLeads(rows, {
        city: city.trim() || undefined,
        category: category.trim() || undefined,
      });
      toast.success(
        `Imported ${result.created} new lead${result.created === 1 ? "" : "s"}` +
          (result.duplicates ? `, ${result.duplicates} already known` : "") +
          (result.processing?.qualified ? `, ${result.processing.qualified} qualified` : ""),
        { duration: 7000 },
      );
      setText("");
      onDone?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/70 sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-leads-title"
        className="flex max-h-[94dvh] w-full max-w-3xl flex-col border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-950"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 p-5 dark:border-slate-800">
          <div>
            <p className="page-kicker">Manual discovery source</p>
            <h2 id="import-leads-title" className="flex items-center gap-2 font-heading text-xl font-extrabold">
              <RiUploadCloud2Line className="text-brand-600" /> Import leads
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Paste loose CSV-style lines; contact and website fields are detected automatically.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="btn-ghost h-11 w-11 !p-0" aria-label="Close import dialog">
            <RiCloseLine className="h-5 w-5" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-5">
          <div className="space-y-4 border-b border-slate-200 p-5 lg:col-span-3 lg:border-b-0 lg:border-r dark:border-slate-800">
            <div>
              <label className="label" htmlFor="lead-import-text">Businesses, one per line</label>
              <textarea
                id="lead-import-text"
                className="input min-h-64 resize-y font-mono !text-sm leading-relaxed"
                placeholder={"Crystal Scents, @crystalscents, crystal@scents.ng\nAmara Kitchen, https://amara.ng, Port Harcourt, restaurants\nGlow Haven Beauty, @glowhaven"}
                value={text}
                onChange={(event) => setText(event.target.value)}
                autoFocus
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="import-city">Default city</label>
                <input id="import-city" className="input" value={city} onChange={(event) => setCity(event.target.value)} placeholder="e.g. Lagos" />
              </div>
              <div>
                <label className="label" htmlFor="import-category">Default category</label>
                <input
                  id="import-category"
                  className="input"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  placeholder="e.g. fashion stores"
                />
              </div>
            </div>
            <div className="border-l-4 border-brand-600 bg-brand-500/5 p-3 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              Accepted signals: website URL, email, phone number, Instagram handle, city, and category. Missing city/category values use the defaults above.
            </div>
          </div>

          <aside className="p-5 lg:col-span-2">
            <div className="section-heading">
              <div>
                <h3 className="section-title flex items-center gap-2"><RiFileList3Line /> Import preview</h3>
                <p className="section-description">{rows.length} valid {rows.length === 1 ? "business" : "businesses"} detected</p>
              </div>
            </div>
            {rows.length === 0 ? (
              <div className="empty-state min-h-52">
                <p className="text-sm font-bold">No valid rows yet</p>
                <p className="mt-1 text-xs text-slate-400">Start typing or paste your business list.</p>
              </div>
            ) : (
              <div className="max-h-80 divide-y divide-slate-200 overflow-y-auto border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {rows.slice(0, 10).map((row, index) => (
                  <div key={`${row.businessName}-${index}`} className="p-3">
                    <p className="truncate text-sm font-bold">{row.businessName}</p>
                    <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                      {row.email ?? row.instagramUsername ?? row.phone ?? row.websiteUrl ?? "No contact signal"}
                    </p>
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      {row.city ?? city || "City unset"} · {row.category ?? category || "Category unset"}
                    </p>
                  </div>
                ))}
                {rows.length > 10 && <p className="p-3 text-center text-xs font-bold text-slate-400">+{rows.length - 10} more rows</p>}
              </div>
            )}
          </aside>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-4 dark:border-slate-800">
          <p className="text-xs text-slate-500">Duplicates and suppression matches are handled automatically.</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="btn-ghost">Cancel</button>
            <button type="button" onClick={submit} disabled={busy || rows.length === 0} className="btn-cta">
              {busy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : <RiCheckLine className="h-4 w-4" />}
              {busy ? "Importing…" : `Import ${rows.length || ""}`.trim()}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
