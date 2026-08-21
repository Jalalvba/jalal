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
// action with a clearly-labelled button, never something that fires on render
// or on hover.
//
// `regenerate` exists because this button now sits on every card of four
// pages, on an account still inside the free tier: a plate that already has a
// summary costs a full analysis to re-answer, usually with the same result.
// So the second and later runs go through a confirm, while the first — the one
// that produces information that does not exist yet — stays one click.

import { useState } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { buildDsAnalysisPayload } from "@/lib/ai/dsAnalysis/payload";
import type { DsHistoryItem } from "@/types";

type Props = {
  imm: string;
  className?: string;
  /** True when a summary already exists — turns the click into a confirm. */
  regenerate?: boolean;
  /**
   * Called with the summary AFTER it is written to the sheet. Exists so a page
   * already showing the gemini cell can refresh it — the write happened
   * server-side, so the caller's cached row is stale until it refetches. NOT a
   * hook to write it a second time.
   */
  onSaved?: (summary: string) => void;
};

export function AnalyseAndSaveButton({ imm, className, regenerate, onSaved }: Props) {
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

      // 2. The analysis. The payload is built by the shared builder, so this
      // page asks the model about exactly what DS History asks it about —
      // minus the contract/vehicle/replacement context these lists do not have.
      const aRes = await fetch("/api/ds-history/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildDsAnalysisPayload({ imm, items })),
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
      // The route fans the write out across BDD/ATELIER/PARKING and reports
      // which tabs took it, so the toast names them rather than claiming a
      // single destination.
      const sJson = (await sRes.json()) as
        | { ok: true; saved: boolean; tabs: string[]; failures: string[] }
        | { ok: false; error: string };

      if (sJson.ok && sJson.saved) {
        onSaved?.(aJson.analysis.summary);
        const failed = sJson.failures.length ? ` (échec : ${sJson.failures.join(", ")})` : "";
        toast.success(`${imm} analysé — résumé enregistré dans ${sJson.tabs.join(", ")}${failed}.`, {
          id,
          description: aJson.analysis.summary,
        });
      } else if (sJson.ok) {
        // Not a failure: the plate is in none of the tabs that store a summary.
        toast.warning(`${imm} analysé — aucune ligne BDD/ATELIER/PARKING, résumé non enregistré.`, {
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

  const button = (
    <Button
      variant="secondary"
      size="sm"
      onClick={regenerate ? undefined : run}
      disabled={busy}
      className={className}
      title={
        regenerate
          ? "Relancer l'analyse IA et remplacer le résumé existant (consomme un appel Gemini)"
          : "Analyse IA de l'historique DS, puis enregistrement du résumé dans la colonne gemini de BDD"
      }
    >
      <Sparkles className="h-3.5 w-3.5" />
      {busy ? "Analyse…" : regenerate ? "Regénérer" : "Résumé IA"}
    </Button>
  );

  if (!regenerate) return button;

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{button}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>Relancer l&apos;analyse de {imm} ?</AlertDialogTitle>
        <AlertDialogDescription>
          Un résumé existe déjà. Le relancer consomme un appel Gemini et écrase le
          résumé enregistré dans BDD.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction onClick={() => void run()}>Regénérer</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
