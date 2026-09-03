"use client";

import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils/cn";

// Shared trigger look for the "labeled row" editable fields (Catégorie,
// Technicien, Prestataire) — a faint background + pencil affordance marks
// these as tappable, distinct from the plain read-only rows around them.
// Used by both src/app/suivi-rl/page.tsx and src/app/ds-history/page.tsx, which edit
// the same BDD sheet fields in two different card layouts.

export function FieldRowTrigger({
  label,
  value,
  placeholder,
  pending,
  justSaved,
  error,
  onOpen,
  dot,
}: {
  label: string;
  value: string;
  placeholder: string;
  pending: boolean;
  justSaved: boolean;
  error: string;
  onOpen: () => void;
  dot?: string | null;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onOpen}
        disabled={pending}
        className={cn(
          "flex min-h-11 w-full items-start justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition disabled:opacity-60",
          justSaved
            ? "border-emerald-500/60 bg-emerald-500/5"
            : error
              ? "border-red-500/60 bg-red-500/5"
              : "border-border bg-muted active:bg-muted/70"
        )}
      >
        <span className="flex min-w-0 items-start gap-1.5">
          <span className="flex-shrink-0 pt-0.5 text-micro font-bold uppercase text-muted-foreground">{label}</span>
          {dot && <span className={cn("mt-1 inline-block h-2 w-2 flex-shrink-0 rounded-full", dot)} />}
          <span className={cn("whitespace-normal break-words", value ? "text-foreground" : "italic text-muted-foreground")}>{value || placeholder}</span>
        </span>
        <Pencil className="mt-0.5 h-3 w-3 flex-shrink-0 text-muted-foreground" />
      </button>
      {error && <div className="mt-1 text-micro text-red-600 dark:text-red-400">{error}</div>}
    </div>
  );
}
