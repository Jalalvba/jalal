"use client";

// The AI summary for one vehicle, plus the button that (re)generates it.
//
// One component for all four pages that show it. Suivi RL, Atelier and Parking
// each read a tab that HAS a `gemini` column of its own, so they pass their own
// value straight in. Depot's tab has no such column (verified against the live
// header row, 2026-08-21), so there — and only there — the summary is looked up
// from BDD by plate.
//
// The BDD fetch behind that fallback is shared: useBddRows() is one React
// Query entry (~101 rows), so a page rendering 84 of these makes ONE request,
// not 84.

import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useBddRows } from "@/hooks/useBddRows";
import { markFresh } from "@/hooks/freshFetch";
import { AnalyseAndSaveButton } from "@/components/fleet/AnalyseAndSaveButton";

type Props = {
  imm: string;
  /**
   * Pass it when the caller's own tab has a gemini column (Suivi RL, Atelier,
   * Parking). Omit it to have the summary looked up from BDD by plate (Depot).
   */
  summary?: string;
  className?: string;
};

export function GeminiSummaryBlock({ imm, summary, className }: Props) {
  const queryClient = useQueryClient();
  // Only subscribe when the caller did NOT supply the value — otherwise Suivi
  // RL would pull a second copy of data it is already rendering.
  const needsLookup = summary === undefined;
  const { data: rows } = useBddRows();

  const resolved = useMemo(() => {
    if (!needsLookup) return summary ?? "";
    const plate = imm.trim();
    const hit = rows?.find((r) => String(r.IMM ?? "").trim() === plate);
    return String(hit?.gemini ?? "");
  }, [needsLookup, summary, rows, imm]);

  const text = resolved.trim();

  return (
    <div className={`rounded-xl border border-border bg-muted/40 px-3 py-2 ${className ?? ""}`}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Résumé IA
        </span>
        <AnalyseAndSaveButton
          imm={imm}
          className="ml-auto"
          // A plate that already has a summary costs a full Gemini call to
          // re-answer, so re-running is put behind a confirm — see the note at
          // the top of AnalyseAndSaveButton.
          regenerate={text.length > 0}
          // The button already wrote to the sheet; this pulls the fresh value
          // back so the block stops showing the previous one.
          onSaved={() => {
            // The write fans out to every tab that has the plate AND a gemini
            // column (see /api/bdd/gemini), so every one of those caches is
            // now stale — not just the one this block happens to read.
            for (const scope of ["bdd", "atelier", "parking"]) {
              // markFresh so the refetch bypasses the server cache — see
              // src/hooks/freshFetch.ts; invalidating alone reads back the
              // pre-write value.
              markFresh(scope);
              void queryClient.invalidateQueries({ queryKey: [scope] });
            }
          }}
        />
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm text-card-foreground">
        {text || (
          <span className="italic text-muted-foreground">
            Aucun résumé — lancez l&apos;analyse pour en générer un.
          </span>
        )}
      </p>
    </div>
  );
}
