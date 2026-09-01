"use client";

import { cn } from "@/lib/utils/cn";

/**
 * The "Voir les détails" / "Masquer les détails" bar that collapses a card's
 * raw reference fields.
 *
 * Visually this is the toggle src/app/ds-history/page.tsx's VehicleCard has
 * had inline since it was written (full-width, border-t, centered chevron,
 * dim until hover) — extracted here rather than restyled, so a card that
 * collapses something looks the same wherever it appears. That card still
 * carries its own copy; folding it onto this component is a separate change,
 * not one to make while it is working.
 *
 * Caller owns the state and keeps the collapsed content MOUNTED (hidden), so
 * nothing about how it is fetched or refreshed changes.
 */
export function DetailsToggle({
  open,
  onToggle,
  className,
}: {
  open: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        "mt-2 flex w-full items-center justify-center gap-1.5 border-t border-border py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground",
        className
      )}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d={open ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4"} strokeLinecap="round" />
      </svg>
      {open ? "Masquer les détails" : "Voir les détails"}
    </button>
  );
}
