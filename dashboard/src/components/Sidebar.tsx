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
} from "react-icons/ri";

const NAV = [
  { href: "/", label: "Overview", icon: RiDashboardLine },
  { href: "/queue", label: "Approval queue", icon: RiInboxArchiveLine },
  { href: "/leads", label: "All leads", icon: RiContactsBook2Line },
  { href: "/suppression", label: "Suppression", icon: RiForbidLine },
  { href: "/settings", label: "Settings", icon: RiSettings4Line },
];

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const nav = (
    <nav id="primary-navigation" className="flex flex-col border-t border-slate-200 dark:border-slate-800">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex min-h-12 items-center gap-3 border-b border-slate-200 px-4 text-sm font-semibold dark:border-slate-800 ${
              active
                ? "border-l-4 border-l-brand-600 bg-brand-600 text-white"
                : "border-l-4 border-l-transparent text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900"
            }`}
          >
            <Icon className="h-5 w-5 shrink-0" />
            <span>{label}</span>
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
          aria-controls="primary-navigation"
        >
          {open ? <RiCloseLine className="h-5 w-5" /> : <RiMenuLine className="h-5 w-5" />}
        </button>
      </header>

      {open && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-40 overflow-y-auto border-b border-slate-200 bg-white lg:hidden dark:border-slate-800 dark:bg-slate-950">
          {nav}
          <EngineNote />
        </div>
      )}

      <aside className="sticky top-0 hidden h-screen h-dvh w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex dark:border-slate-800 dark:bg-slate-950">
        <div className="flex h-20 items-center border-b border-slate-200 px-5 dark:border-slate-800">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto">{nav}</div>
        <EngineNote />
      </aside>
    </>
  );
}

function EngineNote() {
  return (
    <div className="border-t border-slate-200 p-5 text-xs leading-relaxed text-slate-500 dark:border-slate-800 dark:text-slate-400">
      <p className="font-heading font-bold text-slate-800 dark:text-slate-200">YEAN Lead Engine</p>
      <p className="mt-1">Discover → Check → Score → Pitch → Approve → Win the deal.</p>
    </div>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="YEAN Leads overview">
      <span className="flex h-9 w-9 items-center justify-center bg-brand-600">
        <RiFlashlightFill className="h-5 w-5 text-white" />
      </span>
      <span className="font-heading text-lg font-bold tracking-tight">
        YEAN<span className="text-brand-600 dark:text-brand-500"> Leads</span>
      </span>
    </Link>
  );
}
