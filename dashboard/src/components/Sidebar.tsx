"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
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

  const nav = (
    <nav className="flex flex-col gap-1.5">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all ${
              active
                ? "bg-gradient-to-r from-brand-600 to-brand-500 text-white shadow-lg shadow-brand-500/25"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/70"
            }`}
          >
            <Icon className="h-5 w-5 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b border-slate-200/70 bg-white/80 px-4 py-3 backdrop-blur-xl lg:hidden dark:border-slate-800 dark:bg-slate-950/80">
        <Brand />
        <button onClick={() => setOpen(!open)} className="btn-ghost !p-2" aria-label="Toggle menu">
          {open ? <RiCloseLine className="h-5 w-5" /> : <RiMenuLine className="h-5 w-5" />}
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-30 bg-white/95 px-4 pt-20 backdrop-blur-xl lg:hidden dark:bg-slate-950/95">
          {nav}
        </div>
      )}
      {/* Spacer under fixed mobile bar */}
      <div className="h-14 lg:hidden" />

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col gap-8 border-r border-slate-200/70 bg-white/60 p-5 backdrop-blur-xl lg:flex dark:border-slate-800/70 dark:bg-slate-950/60">
        <Brand />
        {nav}
        <div className="mt-auto rounded-2xl bg-gradient-to-br from-brand-600/10 to-purple-600/10 p-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          <p className="font-heading font-bold text-slate-700 dark:text-slate-200">YEAN Lead Engine</p>
          <p className="mt-1">Discover → Check → Score → Pitch → Approve → Win the deal.</p>
        </div>
      </aside>
    </>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-purple-600 shadow-lg shadow-brand-500/30">
        <RiFlashlightFill className="h-5 w-5 text-white" />
      </span>
      <span className="font-heading text-lg font-bold tracking-tight">
        YEAN<span className="text-brand-600 dark:text-brand-500"> Leads</span>
      </span>
    </Link>
  );
}
