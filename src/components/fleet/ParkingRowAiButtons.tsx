"use client";

// The two per-row AI actions on the Parking tab, side by side.
//
// The tab has two AI columns answering two different questions, and both are
// worth running for a single vehicle rather than only for the whole list:
//
//   ⚡ Action     -> ACTION column, prompt-parking.ts — what the workshop does
//   ✨ Analyse DS -> gemini column, the DS analysis   — what the history says
//
// They go through the same two batch endpoints the header buttons use, with a
// list of one. That keeps the reuse rule, the "never overwrite a hand-typed
// ACTION" rule and the verdicts in ONE place on the server — a per-row route
// of its own would be a second copy of all three, and they would drift.

import { useState } from "react";
import { toast } from "sonner";
import { Sparkles, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";

type Outcome =
  | "written" | "reused" | "manual" | "no-action" | "no-summary" | "no-history" | "no-row" | "failed";

const KINDS = {
  action: {
    endpoint: "/api/parking/actions",
    icon: ListChecks,
    label: "Action",
    title: "Générer les opérations à effectuer dans la colonne ACTION",
    ok: "opérations écrites dans ACTION",
  },
  analyse: {
    endpoint: "/api/parking/analyse",
    icon: Sparkles,
    label: "Analyse DS",
    title: "Analyser l'historique DS et écrire le résumé dans la colonne gemini",
    ok: "résumé écrit dans gemini",
  },
} as const;

// French for each verdict the routes can return. A silent no-op is the one
// outcome a per-row button must never produce: the user clicked, something
// decided not to write, and they are owed the reason.
const OUTCOME_MESSAGE: Record<Outcome, string> = {
  written: "",
  reused: "",
  manual: "cellule ACTION saisie à la main — conservée",
  "no-action": "aucune opération à effectuer sur ce véhicule",
  "no-summary": "analyse sans résumé exploitable",
  "no-history": "aucune intervention DS à analyser",
  "no-row": "ligne introuvable sur l'onglet",
  failed: "échec",
};

export function ParkingRowAiButtons({
  imm,
  /** True when the target cell already holds something — turns this into a
   *  refresh, so the server re-analyses instead of handing back stored text. */
  hasAction,
  hasSummary,
  onDone,
}: {
  imm: string;
  hasAction?: boolean;
  hasSummary?: boolean;
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState<null | keyof typeof KINDS>(null);

  async function run(kind: keyof typeof KINDS) {
    if (busy) return;
    const k = KINDS[kind];
    setBusy(kind);
    const id = toast.loading(`${imm} — ${k.label}…`);
    try {
      const res = await fetch(k.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imms: [imm],
          force: kind === "action" ? hasAction === true : hasSummary === true,
        }),
      });
      const json = (await res.json()) as
        | { ok: true; results: { outcome: Outcome; error?: string }[] }
        | { ok: false; error: string };
      if (!json.ok) throw new Error(json.error);

      const r = json.results[0];
      const outcome = r?.outcome ?? "failed";
      onDone?.();

      if (outcome === "written" || outcome === "reused") {
        toast.success(
          `${imm} — ${k.ok}${outcome === "reused" ? " (analyse enregistrée réutilisée)" : ""}.`,
          { id }
        );
      } else if (outcome === "failed") {
        toast.error(`${imm} : ${r?.error ?? "échec"}`, { id });
      } else {
        toast.warning(`${imm} : ${OUTCOME_MESSAGE[outcome]}`, { id });
      }
    } catch (e) {
      toast.error(`${imm} : ${e instanceof Error ? e.message : "échec"}`, { id });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-1">
      {(Object.keys(KINDS) as (keyof typeof KINDS)[]).map((kind) => {
        const k = KINDS[kind];
        const Icon = k.icon;
        return (
          <Button
            key={kind}
            variant="secondary"
            size="sm"
            disabled={busy !== null}
            onClick={() => void run(kind)}
            title={k.title}
            className="h-7 gap-1 px-2 text-micro"
          >
            <Icon className={busy === kind ? "h-3.5 w-3.5 animate-pulse" : "h-3.5 w-3.5"} />
            {busy === kind ? "…" : k.label}
          </Button>
        );
      })}
    </div>
  );
}
