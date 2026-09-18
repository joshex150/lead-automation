"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RiErrorWarningLine, RiRefreshLine, RiArrowLeftLine } from "react-icons/ri";

/**
 * The last line before a blank page.
 *
 * A single unexpected value used to take the whole dashboard down: React
 * unmounts the tree on an uncaught render error, and what is left is the
 * browser's "Application error: a client-side exception has occurred", which
 * tells the operator nothing and offers them nothing. One page failing should
 * cost that page, not the session.
 *
 * Next renders this in place of the route that threw. The navigation around it
 * survives, so the rest of the app is still reachable.
 */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("route error", error);
  }, [error]);

  return (
    <div className="page-shell">
      <div className="empty-state mt-10">
        <div className="empty-state-icon text-rose-500">
          <RiErrorWarningLine />
        </div>
        <h1 className="mt-4 font-heading text-xl font-bold">This page stopped working</h1>
        <p className="mt-2 max-w-lg text-sm leading-relaxed text-slate-500 dark:text-slate-400">
          Nothing was lost. Your leads, settings and messages are all still on the server; it was only this view that
          failed to draw.
        </p>
        {error.message && (
          <p className="mt-3 max-w-lg break-words text-xs text-slate-400">
            {error.message}
            {error.digest && <span className="ml-1 opacity-60">({error.digest})</span>}
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={reset} className="btn-primary">
            <RiRefreshLine className="h-4 w-4" /> Try again
          </button>
          <Link href="/overview" className="btn-ghost">
            <RiArrowLeftLine className="h-4 w-4" /> Back to the overview
          </Link>
        </div>
      </div>
    </div>
  );
}
