"use client";

// One-click "analyse this vehicle and save the summary to BDD", for the
// Parking / Atelier / Depot lists.
//
// Those pages know a plate and nothing else — unlike DS History, they never
// load DS history — so this does the whole chain itself: fetch the history,
// run the analysis, write the summary. DS History keeps its own richer card;
// this is the compact form for a list row.
//
// Each click is a REAL, billed Gemini call, so it is a deliberate per-row
// action with a confirm-free but clearly-labelled button, never something that
// fires on render or on hover.

import { useState } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { classifyRepairOrigin } from "@/lib/ai/prompts/dsAnalysis";
import type { DsHistoryItem } from "@/types";

type Props = {
  imm: string;
  className?: string;
  /**
   * Called with the summary AFTER it is written to the sheet. Exists so a page
   * already showing the gemini cell can refresh it — the write happened
   * server-side, so the caller's cached row is stale until it refetches. NOT a
   * hook to write it a second time.
   */
  onSaved?: (summary: string) => void;
};

export function AnalyseAndSaveButton({ imm, className, onSaved }: Props) {
  const [busy, setBusy] = useState(false);

  async function run() {
    if (busy || !imm.trim()) return;
    setBusy(true);
    const id = toast.loading(`Analyse de ${imm}…`);
    try {
      // 1. The vehicle's DS history — the same endpoint DS History uses.
      const hRes = await fetch(`/api/ds/history?imm=${encodeURIComponent(imm)}`);
      const hJson = (await hRes.json()) as { ok: boolean; items?: DsHistoryItem[]; error?: string };
      if (!hRes.ok || !hJson.ok) throw new Error(hJson.error ?? `Historique indisponible (${hRes.status})`);
      const items = hJson.items ?? [];
      if (items.length === 0) {
        toast.error(`${imm} : aucune intervention à analyser.`, { id });
        return;
      }

      // 2. The analysis. Payload shape mirrors DsAnalysisCard's buildPayload()
      // — same route, same validation, same cost accounting.
      const aRes = await fetch("/api/ds-history/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imm,
          contractEnd: null,
          vehicle: {},
          replacements: [],
          entries: items.map((it) => ({
            date: it.date_ds,
            km: it.km,
            description: it.description == null ? undefined : String(it.description),
            ...classifyRepairOrigin(it.fournisseur, it.techniciens),
            parts: (it.lines ?? [])
              .map((l) => String(l.designation_consommation ?? ""))
              .filter((p) => p.trim()),
          })),
        }),
      });
      const aJson = (await aRes.json()) as
        | { ok: true; analysis: { summary: string } }
        | { ok: false; error: string };
      if (!aJson.ok) throw new Error(aJson.error);

      // 3. Save. A failure here does NOT invalidate the analysis, which is
      // already paid for — it is reported separately rather than as a failure
      // of the whole action.
      const sRes = await fetch("/api/bdd/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imm, summary: aJson.analysis.summary }),
      });
      const sJson = (await sRes.json()) as
        | { ok: true; saved: true; row: number }
        | { ok: true; saved: false; reason: "no-row" }
        | { ok: false; error: string };

      if (sJson.ok && sJson.saved) {
        onSaved?.(aJson.analysis.summary);
        toast.success(`${imm} analysé — résumé enregistré dans BDD (ligne ${sJson.row}).`, {
          id,
          description: aJson.analysis.summary,
        });
      } else if (sJson.ok) {
        toast.warning(`${imm} analysé — pas de ligne BDD, résumé non enregistré.`, {
          id,
          description: aJson.analysis.summary,
        });
      } else {
        toast.warning(`${imm} analysé, mais l'enregistrement a échoué : ${sJson.error}`, {
          id,
          description: aJson.analysis.summary,
        });
      }
    } catch (e) {
      toast.error(`${imm} : ${e instanceof Error ? e.message : "échec de l'analyse"}`, { id });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={run}
      disabled={busy}
      className={className}
      title="Analyse IA de l'historique DS, puis enregistrement du résumé dans la colonne gemini de BDD"
    >
      <Sparkles className="h-3.5 w-3.5" />
      {busy ? "Analyse…" : "Résumé IA"}
    </Button>
  );
}
