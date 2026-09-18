"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  RiDashboardLine,
  RiBarChartBoxLine,
  RiInboxArchiveLine,
  RiContactsBook2Line,
  RiForbidLine,
  RiSettings4Line,
  RiPaletteLine,
  RiQuestionLine,
  RiMenuLine,
  RiCloseLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiLogoutBoxRLine,
} from "react-icons/ri";
import type { IconType } from "react-icons";
import { api } from "@/lib/api";
import { Brand } from "@/components/Logo";
import { useTheme } from "@/lib/theme/provider";
import { NAV_ITEMS } from "@/lib/theme/tokens";

/** Everything a nav id needs to become a link. Order and visibility come from the theme. */
const NAV_DEFS: Record<string, { href: string; icon: IconType }> = {
  overview: { href: "/overview", icon: RiDashboardLine },
  analytics: { href: "/analytics", icon: RiBarChartBoxLine },
  queue: { href: "/queue", icon: RiInboxArchiveLine },
  leads: { href: "/leads", icon: RiContactsBook2Line },
  suppression: { href: "/suppression", icon: RiForbidLine },
  "site-control": { href: "/site-control", icon: RiPaletteLine },
  settings: { href: "/settings", icon: RiSettings4Line },
  help: { href: "/help", icon: RiQuestionLine },
};

const NAV_LABELS: Record<string, string> = Object.fromEntries(NAV_ITEMS.map((n) => [n.id, n.label]));

const SETTINGS_SECTIONS = ["Discovery", "AI writer", "Email", "Lead sources", "Scheduler", "Guardrails", "Scoring"];

export function Sidebar() {
  const pathname = usePathname();
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [pending, setPending] = useState<number | null>(null);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const items = useMemo(
    () =>
      theme.layout.navOrder
        .filter((id) => !theme.layout.navHidden.includes(id) && NAV_DEFS[id])
        .map((id) => ({ id, label: NAV_LABELS[id] ?? id, ...NAV_DEFS[id] })),
    [theme.layout.navOrder, theme.layout.navHidden],
  );

  useEffect(() => {
    setOpen(false);
    document.documentElement.dataset.route = pathname.startsWith("/settings")
      ? "settings"
      : pathname.startsWith("/leads/")
        ? "lead-detail"
        : pathname.split("/")[1] || "overview";
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem("yean-sidebar-collapsed") === "true");
  }, []);

  /*
   * Whether this deployment has sign-in turned on. Asked for once, from the
   * dashboard's own route rather than from the API's integration status: that
   * one reports whether the server wants an API key, which is a different
   * switch, and showing a sign-out button on a deployment with no sign-in would
   * be offering to end a session that does not exist.
   */
  useEffect(() => {
    let active = true;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { authEnabled?: boolean } | null) => {
        if (active) setAuthEnabled(Boolean(body?.authEnabled));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const load = () => {
      api
        .stats()
        .then((stats) => {
          if (active) setPending(stats.totals.pendingApproval);
        })
        .catch(() => undefined);
    };
    load();
    const interval = window.setInterval(load, 30000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // The cookie may already be gone. Either way the next line is the same.
    }
    window.location.href = "/login";
  }

  function toggleCollapsed() {
    setCollapsed((value) => {
      const next = !value;
      window.localStorage.setItem("yean-sidebar-collapsed", String(next));
      return next;
    });
  }

  const renderNav = (id?: string, compact = false) => (
    <nav id={id} aria-label="Primary navigation" className="flex flex-col border-t border-slate-200 dark:border-slate-800">
      <p className={`px-4 pb-2 pt-4 text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400 ${compact ? "sr-only" : ""}`}>
        Workspace
      </p>
      {items.map(({ id: itemId, href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        const queueCount = itemId === "queue" ? pending : null;
        return (
          <Link
            key={itemId}
            href={href}
            title={compact ? label : undefined}
            aria-current={active ? "page" : undefined}
            className={`relative flex items-center border-b border-slate-200 text-sm font-semibold dark:border-slate-800 ${
              compact ? "justify-center px-0" : "gap-3 px-4"
            } ${
              active
                ? "border-l-4 border-l-brand-600 bg-brand-500/10 text-brand-700 dark:text-brand-400"
                : "border-l-4 border-l-transparent text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900"
            }`}
            style={{ minHeight: "var(--control-height)" }}
          >
            <Icon className="h-5 w-5 shrink-0" />
            {!compact && <span className="min-w-0 flex-1 truncate">{label}</span>}
            {!compact && queueCount !== null && queueCount > 0 && (
              <span className="inline-flex min-w-6 items-center justify-center border border-brand-600 bg-brand-600 px-1.5 py-0.5 text-[10px] font-extrabold text-white">
                {queueCount > 99 ? "99+" : queueCount}
              </span>
            )}
            {compact && queueCount !== null && queueCount > 0 && (
              <span className="absolute right-2 top-2 h-2 w-2 bg-brand-600" aria-label={`${queueCount} leads awaiting approval`} />
            )}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 lg:hidden dark:border-slate-800 dark:bg-slate-950">
        <Brand />
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="btn-ghost h-11 w-11 !p-0"
          aria-label={open ? "Close navigation" : "Open navigation"}
          aria-expanded={open}
          aria-controls="mobile-navigation"
        >
          {open ? <RiCloseLine className="h-5 w-5" /> : <RiMenuLine className="h-5 w-5" />}
        </button>
      </header>

      {open && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-40 overflow-y-auto bg-white lg:hidden dark:bg-slate-950">
          {renderNav("mobile-navigation")}
          <EngineNote />
          {authEnabled && <SignOutButton busy={signingOut} onSignOut={signOut} />}
        </div>
      )}

      <aside
        className={`app-sidebar sticky top-0 hidden h-screen h-dvh shrink-0 flex-col border-r border-slate-200 bg-white lg:flex dark:border-slate-800 dark:bg-slate-950 ${
          collapsed ? "!w-20" : ""
        }`}
      >
        <div className={`flex h-20 items-center border-b border-slate-200 dark:border-slate-800 ${collapsed ? "justify-center px-2" : "px-5"}`}>
          <Brand compact={collapsed} />
        </div>
        <div className="flex-1 overflow-y-auto">
          {renderNav(undefined, collapsed)}
          {pathname.startsWith("/settings") && !collapsed && <SettingsSectionNavigation />}
        </div>
        {!collapsed && <EngineNote />}
        {authEnabled && <SignOutButton compact={collapsed} busy={signingOut} onSignOut={signOut} />}
        <button
          type="button"
          onClick={toggleCollapsed}
          className={`flex min-h-12 items-center border-t border-slate-200 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-900 ${
            collapsed ? "justify-center" : "gap-2 px-5"
          }`}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : undefined}
        >
          {collapsed ? <RiArrowRightSLine className="h-5 w-5" /> : <RiArrowLeftSLine className="h-5 w-5" />}
          {!collapsed && <span>Collapse navigation</span>}
        </button>
      </aside>
    </>
  );
}

function SettingsSectionNavigation() {
  function scrollToSection(index: number) {
    const sections = document.querySelectorAll<HTMLElement>("main section");
    sections[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <nav aria-label="Settings sections" className="border-b border-slate-200 px-4 py-4 dark:border-slate-800">
      <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400">Settings sections</p>
      <div className="border-l border-slate-300 dark:border-slate-700">
        {SETTINGS_SECTIONS.map((section, index) => (
          <button
            key={section}
            type="button"
            onClick={() => scrollToSection(index)}
            className="block w-full border-l-2 border-l-transparent px-3 py-1.5 text-left text-xs font-semibold text-slate-500 hover:border-l-brand-600 hover:bg-brand-500/5 hover:text-brand-600 dark:text-slate-400"
          >
            {section}
          </button>
        ))}
      </div>
    </nav>
  );
}

/**
 * Ends the session.
 *
 * The endpoint that clears the cookie has existed since sign-in was added and
 * nothing ever called it, so the only way out of a signed-in dashboard was to
 * clear the cookie by hand or wait twelve hours for it to lapse. A full page
 * load afterwards rather than a client navigation, so nothing cached for the
 * signed-in operator is still on screen for whoever signs in next.
 */
function SignOutButton({
  compact = false,
  busy,
  onSignOut,
}: {
  compact?: boolean;
  busy: boolean;
  onSignOut: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSignOut}
      disabled={busy}
      aria-label="Sign out"
      title={compact ? "Sign out" : undefined}
      className={`flex min-h-12 w-full items-center border-t border-slate-200 text-xs font-bold text-slate-500 hover:bg-slate-100 disabled:opacity-60 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-900 ${
        compact ? "justify-center" : "gap-2 px-5"
      }`}
      style={{ minHeight: "var(--control-height)" }}
    >
      <RiLogoutBoxRLine className="h-5 w-5 shrink-0" />
      {!compact && <span>{busy ? "Signing out…" : "Sign out"}</span>}
    </button>
  );
}

function EngineNote() {
  const { theme } = useTheme();
  return (
    <div className="border-t border-slate-200 p-5 text-xs leading-relaxed text-slate-500 dark:border-slate-800 dark:text-slate-400">
      <p className="font-heading font-bold text-slate-800 dark:text-slate-200">{theme.brand.productName}</p>
      <p className="mt-1">{theme.brand.tagline}</p>
      <p className="mt-3 border-l-2 border-brand-600 pl-3">Discover, check, score, pitch, approve, win.</p>
    </div>
  );
}
