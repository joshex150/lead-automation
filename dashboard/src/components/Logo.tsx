"use client";

import Link from "next/link";
import { useTheme } from "@/lib/theme/provider";

/**
 * The YEAN mark, redrawn as vector.
 *
 * Traced from the supplied artwork: a square rule, a Y whose right arm carries
 * circuit routing, and a bar cutting the stem. Drawing it rather than shipping
 * the bitmap means it stays sharp at every size, costs no request, and takes its
 * colours from the theme, so the mark follows the palette instead of fighting it.
 *
 * Geometry is in a 32 unit box, scaled from the original 573px artwork.
 */
export function LogoMark({
  className,
  framed = true,
  title,
}: {
  className?: string;
  framed?: boolean;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {framed && (
        <rect x="0.5" y="0.5" width="31" height="31" fill="none" stroke="currentColor" strokeWidth="1" />
      )}

      {/* Arms and upper stem, as one outline. */}
      <path
        d="M8.99 5.7 L13.01 5.7 L16.2 10.52 L19.39 5.7 L23.41 5.7 L17.87 13.96 L17.87 20.22 L14.52 20.22 L14.52 13.96 Z"
        fill="currentColor"
      />

      {/*
        Circuit routing on the right arm, cut out in the surface colour so the
        traces read as gaps in the letterform rather than as drawn-on lines.
        Traced from the artwork: three fanning runs, a short cross tie, and two
        terminating pads.
      */}
      <g stroke="rgb(var(--surface))" strokeWidth="0.38" fill="none" strokeLinecap="round">
        <path d="M16.9 11.35 L19.8 6.6" />
        <path d="M17.8 11.35 L20.62 7.85" />
        <path d="M18.6 11.35 L21.05 5.9" />
        <path d="M16.05 10.92 L19.15 10.92" />
      </g>
      <g fill="rgb(var(--surface))">
        <circle cx="21.05" cy="5.75" r="0.46" />
        <circle cx="20.66" cy="7.93" r="0.42" />
      </g>

      {/* Lower stem, running into the rule at the foot. */}
      <rect x="14.52" y="25.64" width="3.35" height="6.36" fill="currentColor" />

      {/* The bar. Brand green by default, and whatever the accent is after that. */}
      <rect x="10.78" y="21.28" width="10.78" height="2.96" fill="rgb(var(--accent))" />
    </svg>
  );
}

/** The mark plus wordmark, linked home. Both parts follow the theme's brand settings. */
export function Brand({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { theme } = useTheme();
  const { brand } = theme;
  const label = `${brand.wordmark}${brand.wordmarkAccent}`.trim() || brand.productName;

  return (
    <Link
      href="/overview"
      aria-label={`${label}, overview`}
      title={compact ? label : undefined}
      className={`brand-lockup inline-flex min-w-0 items-center gap-2.5 ${className ?? ""}`}
    >
      {brand.logo !== "none" && (
        <LogoMark className="brand-logo h-9 w-9 shrink-0 text-ink" framed={brand.logo === "framed"} />
      )}
      {!compact && brand.showWordmark && (
        <span className="brand-wordmark min-w-0 truncate font-heading text-lg font-bold tracking-tight">
          {brand.wordmark}
          <span className="text-brand-600 dark:text-brand-500">{brand.wordmarkAccent}</span>
        </span>
      )}
    </Link>
  );
}
