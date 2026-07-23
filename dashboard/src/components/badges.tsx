import type { WebsiteType } from "@/lib/types";

const WEBSITE_TYPE_STYLES: Record<WebsiteType, { label: string; cls: string }> = {
  NO_WEBSITE: { label: "No website", cls: "border-rose-500 bg-rose-500/5 text-rose-600 dark:text-rose-400" },
  BROKEN_WEBSITE: { label: "Broken website", cls: "border-red-500 bg-red-500/5 text-red-600 dark:text-red-400" },
  SHOPIFY: { label: "Shopify", cls: "border-emerald-500 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400" },
  LINK_IN_BIO_ONLY: { label: "Link-in-bio", cls: "border-amber-500 bg-amber-500/5 text-amber-700 dark:text-amber-400" },
  MENU_PLATFORM_ONLY: { label: "Menu platform", cls: "border-orange-500 bg-orange-500/5 text-orange-600 dark:text-orange-400" },
  SOCIAL_MEDIA_ONLY: { label: "Social only", cls: "border-fuchsia-500 bg-fuchsia-500/5 text-fuchsia-600 dark:text-fuchsia-400" },
  CUSTOM_WEBSITE: { label: "Custom website", cls: "border-slate-400 bg-slate-500/5 text-slate-600 dark:text-slate-300" },
  POOR_WEBSITE: { label: "Poor website", cls: "border-yellow-500 bg-yellow-500/5 text-yellow-700 dark:text-yellow-400" },
};

export function WebsiteTypeBadge({ type }: { type: WebsiteType }) {
  const style = WEBSITE_TYPE_STYLES[type] ?? WEBSITE_TYPE_STYLES.CUSTOM_WEBSITE;
  return <span className={`status-badge capitalize ${style.cls}`}>{style.label}</span>;
}

export function ScoreBadge({ score }: { score: number }) {
  const cls =
    score >= 70
      ? "border-emerald-600 bg-emerald-600 text-white"
      : score >= 50
        ? "border-cta-500 bg-cta-500 text-white"
        : "border-slate-500 bg-slate-500 text-white";
  return (
    <span
      className={`inline-flex h-11 min-w-11 shrink-0 items-center justify-center border px-2 font-heading text-sm font-extrabold tabular-nums ${cls}`}
      title={`Lead score: ${score}`}
      aria-label={`Lead score ${score}`}
    >
      {score}
    </span>
  );
}

export function StagePill({ stage }: { stage: string }) {
  const map: Record<string, string> = {
    PENDING_APPROVAL: "border-brand-500 bg-brand-500/5 text-brand-600 dark:text-brand-400",
    PITCH_READY: "border-brand-500 bg-brand-500/5 text-brand-600 dark:text-brand-400",
    APPROVED: "border-emerald-500 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400",
    REJECTED: "border-rose-500 bg-rose-500/5 text-rose-600 dark:text-rose-400",
    CONTACTED: "border-purple-500 bg-purple-500/5 text-purple-600 dark:text-purple-400",
    QUALIFIED: "border-cyan-500 bg-cyan-500/5 text-cyan-600 dark:text-cyan-400",
    DISQUALIFIED: "border-slate-400 bg-slate-500/5 text-slate-500",
    ARCHIVED: "border-slate-400 bg-slate-500/5 text-slate-500",
    DISCOVERED: "border-cyan-500 bg-cyan-500/5 text-cyan-600 dark:text-cyan-400",
    CHECKED: "border-sky-500 bg-sky-500/5 text-sky-600 dark:text-sky-400",
    ENRICHED: "border-indigo-500 bg-indigo-500/5 text-indigo-600 dark:text-indigo-400",
    SCORED: "border-violet-500 bg-violet-500/5 text-violet-600 dark:text-violet-400",
  };
  return (
    <span className={`status-badge ${map[stage] ?? "border-slate-400 bg-slate-500/5 text-slate-500"}`}>
      <span className="status-dot" />
      {stage.replaceAll("_", " ")}
    </span>
  );
}
