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
import { useStoredAnalyses, useInvalidateStoredAnalyses } from "@/hooks/useStoredAnalyses";
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
  /**
   * Use the paid analysis tier. Suivi RL passes it; Parking, Atelier and Depot
   * do not — the paid model is confined to the page whose summary is treated
   * as the record. See AnalyseAndSaveButton's `pro`.
   */
  pro?: boolean;
  /**
   * Where this block's button saves. Parking passes "parking" so the write
   * stays on its own tab instead of fanning out to BDD and ATELIER — see
   * AnalyseAndSaveButton's `saveTo`.
   */
  saveTo?: "bdd-fanout" | "parking";
  /**
   * Render the summary WITHOUT its own trigger. Parking passes this because
   * its card carries both AI buttons together (ParkingRowAiButtons) — one
   * sparkle here and another button elsewhere on the same card would be two
   * affordances for the same thing in two places.
   */
  hideButton?: boolean;
};

export function GeminiSummaryBlock({ imm, summary, className, pro, saveTo, hideButton }: Props) {
  const queryClient = useQueryClient();
  // Only subscribe when the caller did NOT supply the value — otherwise Suivi
  // RL would pull a second copy of data it is already rendering.
  const needsLookup = summary === undefined;
  const { data: rows } = useBddRows();

  // Analyses stored in Mongo — one request for the whole page, looked up here
  // by plate. This is what makes a previously-analysed vehicle render its
  // summary instantly instead of costing another call.
  const { data: stored } = useStoredAnalyses();

  const resolved = useMemo(() => {
    if (!needsLookup) return summary ?? "";
    const plate = imm.trim();
    const hit = rows?.find((r) => String(r.IMM ?? "").trim() === plate);
    return String(hit?.gemini ?? "");
  }, [needsLookup, summary, rows, imm]);

  // The sheet cell wins when it has something: it is what the user sees in
  // Sheets and may have edited by hand. Mongo fills the gap for a vehicle
  // analysed before the column existed, or one whose sheet write found no row
  // (a plate in none of BDD/ATELIER/PARKING still gets a stored analysis).
  const text = resolved.trim() || (stored?.get(imm.trim().toUpperCase())?.summary ?? "").trim();

  const invalidateStored = useInvalidateStoredAnalyses();

  function onGenerated() {
    // The write fans out to every tab that has the plate AND a gemini column
    // (see /api/bdd/gemini), so every one of those caches is now stale — not
    // just the one this block happens to read.
    for (const scope of ["bdd", "atelier", "parking"]) {
      // markFresh so the refetch bypasses the server cache — see
      // src/hooks/freshFetch.ts; invalidating alone reads back the pre-write
      // value.
      markFresh(scope);
      void queryClient.invalidateQueries({ queryKey: [scope] });
    }
    // …and the stored analysis the route just wrote.
    invalidateStored(imm);
  }

  // Nothing to show yet: render the trigger ALONE, no panel. An empty bordered
  // rectangle saying "aucun résumé" on every un-analysed row is a page full of
  // boxes announcing their own emptiness — on Suivi RL that was ~95 of them.
  // The affordance to create one is all that is needed until one exists.
  // Nothing to show and no trigger to offer: render nothing at all rather than
  // an empty container.
  if (!text && hideButton) return null;

  if (!text) {
    return (
      <div className={`flex justify-end ${className ?? ""}`}>
        <AnalyseAndSaveButton imm={imm} pro={pro} saveTo={saveTo} onSaved={onGenerated} iconOnly />
      </div>
    );
  }

  return (
    <div className={`rounded-xl border border-border bg-muted/40 px-3 py-2 ${className ?? ""}`}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Résumé IA
        </span>
        {!hideButton && (
        <AnalyseAndSaveButton
          imm={imm}
          className="ml-auto"
          // A plate that already has a summary costs a full Gemini call to
          // re-answer, so re-running is put behind a confirm — see the note at
          // the top of AnalyseAndSaveButton.
          regenerate={text.length > 0}
          pro={pro}
          saveTo={saveTo}
          // The button already wrote to the sheet; this pulls the fresh value
          // back so the block stops showing the previous one.
          onSaved={onGenerated}
        />
        )}
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
