"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  RiDashboardLine,
  RiInboxArchiveLine,
  RiContactsBook2Line,
  RiForbidLine,
  RiSettings4Line,
  RiMenuLine,
  RiCloseLine,
  RiFlashlightFill,
  RiArrowLeftSLine,
  RiArrowRightSLine,
} from "react-icons/ri";
import { api } from "@/lib/api";

const NAV = [
  { href: "/", label: "Overview", icon: RiDashboardLine },
  { href: "/queue", label: "Approval queue", icon: RiInboxArchiveLine },
  { href: "/leads", label: "All leads", icon: RiContactsBook2Line },
  { href: "/suppression", label: "Suppression", icon: RiForbidLine },
  { href: "/settings", label: "Settings", icon: RiSettings4Line },
];

const SETTINGS_SECTIONS = ["Discovery", "AI writer", "Email", "Lead sources", "Scheduler", "Guardrails", "Scoring"];

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [pending, setPending] = useState<number | null>(null);

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
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        const queueCount = href === "/queue" ? pending : null;
        return (
          <Link
            key={href}
            href={href}
            title={compact ? label : undefined}
            aria-current={active ? "page" : undefined}
            className={`relative flex min-h-12 items-center border-b border-slate-200 text-sm font-semibold dark:border-slate-800 ${
              compact ? "justify-center px-0" : "gap-3 px-4"
            } ${
              active
                ? "border-l-4 border-l-brand-600 bg-brand-500/10 text-brand-700 dark:text-brand-400"
                : "border-l-4 border-l-transparent text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900"
            }`}
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
        </div>
      )}

      <aside
        className={`sticky top-0 hidden h-screen h-dvh shrink-0 flex-col border-r border-slate-200 bg-white lg:flex dark:border-slate-800 dark:bg-slate-950 ${
          collapsed ? "w-20" : "w-64"
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

function EngineNote() {
  return (
    <div className="border-t border-slate-200 p-5 text-xs leading-relaxed text-slate-500 dark:border-slate-800 dark:text-slate-400">
      <p className="font-heading font-bold text-slate-800 dark:text-slate-200">YEAN Technologies</p>
      <p className="mt-1">Lead operations workspace</p>
      <p className="mt-3 border-l-2 border-brand-600 pl-3">Discover → Check → Score → Pitch → Approve → Win.</p>
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="YEAN Leads overview" title={compact ? "YEAN Leads" : undefined}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-brand-600">
        <RiFlashlightFill className="h-5 w-5 text-white" />
      </span>
      {!compact && (
        <span className="font-heading text-lg font-bold tracking-tight">
          YEAN<span className="text-brand-600 dark:text-brand-500"> Leads</span>
        </span>
      )}
    </Link>
  );
}
