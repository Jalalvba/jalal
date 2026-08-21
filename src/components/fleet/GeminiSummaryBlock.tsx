"use client";

// The AI summary for one vehicle, plus the button that (re)generates it.
//
// One component for all four pages that show it. Suivi RL renders BDD itself
// so it passes the value straight in; Parking/Atelier/Depot read their own
// sheet tabs, which have no `gemini` column, so there the summary is looked up
// from BDD by plate.
//
// That lookup is why this exists rather than each page rolling its own: the
// summary is stored in exactly one place (BDD's gemini column) but is useful
// on every page where you are looking at a vehicle in real time, and four
// copies of "find the BDD row for this plate" would drift.
//
// The BDD fetch is shared: useBddRows() is one React Query entry (101 rows),
// so a page rendering 84 of these makes ONE request, not 84 — and Suivi RL,
// which already has the rows, never triggers it at all because it passes
// `summary` explicitly.

import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useBddRows, ROWS_KEY } from "@/hooks/useBddRows";
import { AnalyseAndSaveButton } from "@/components/fleet/AnalyseAndSaveButton";

type Props = {
  imm: string;
  /**
   * Pass it when the caller already has the row (Suivi RL). Omit it to have
   * the summary looked up from BDD by plate (Parking/Atelier/Depot).
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
          onSaved={() => void queryClient.invalidateQueries({ queryKey: ROWS_KEY })}
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
