import type { WebsiteType } from "@/lib/types";

const WEBSITE_TYPE_STYLES: Record<WebsiteType, { label: string; cls: string }> = {
  NO_WEBSITE: { label: "No website", cls: "bg-rose-500/15 text-rose-600 dark:text-rose-400 ring-rose-500/30" },
  BROKEN_WEBSITE: { label: "Broken website", cls: "bg-red-500/15 text-red-600 dark:text-red-400 ring-red-500/30" },
  SHOPIFY: { label: "Shopify", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-emerald-500/30" },
  LINK_IN_BIO_ONLY: { label: "Link-in-bio only", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-amber-500/30" },
  MENU_PLATFORM_ONLY: { label: "Menu platform", cls: "bg-orange-500/15 text-orange-600 dark:text-orange-400 ring-orange-500/30" },
  SOCIAL_MEDIA_ONLY: { label: "Social media only", cls: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400 ring-fuchsia-500/30" },
  CUSTOM_WEBSITE: { label: "Custom website", cls: "bg-slate-500/15 text-slate-600 dark:text-slate-300 ring-slate-500/30" },
  POOR_WEBSITE: { label: "Poor website", cls: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 ring-yellow-500/30" },
};

export function WebsiteTypeBadge({ type }: { type: WebsiteType }) {
  const s = WEBSITE_TYPE_STYLES[type] ?? WEBSITE_TYPE_STYLES.CUSTOM_WEBSITE;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${s.cls}`}>
      {s.label}
    </span>
  );
}

export function ScoreBadge({ score }: { score: number }) {
  const cls =
    score >= 70
      ? "from-emerald-500 to-teal-500 shadow-emerald-500/30"
      : score >= 50
        ? "from-cta-500 to-amber-500 shadow-cta-500/30"
        : "from-slate-400 to-slate-500 shadow-slate-500/20";
  return (
    <span
      className={`inline-flex h-10 min-w-10 items-center justify-center rounded-full bg-gradient-to-br px-2 font-heading text-sm font-bold text-white shadow-lg ${cls}`}
      title={`Lead score: ${score}`}
    >
      {score}
    </span>
  );
}

export function StagePill({ stage }: { stage: string }) {
  const map: Record<string, string> = {
    PENDING_APPROVAL: "bg-brand-500/15 text-brand-600 dark:text-brand-500",
    APPROVED: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    REJECTED: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
    CONTACTED: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
    DISQUALIFIED: "bg-slate-500/15 text-slate-500",
    ARCHIVED: "bg-slate-500/15 text-slate-500",
    DISCOVERED: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide ${map[stage] ?? "bg-slate-500/15 text-slate-500"}`}
    >
      {stage.replaceAll("_", " ")}
    </span>
  );
}
