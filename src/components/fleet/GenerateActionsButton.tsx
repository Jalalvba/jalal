"use client";

// One click for a whole column of the PARKING tab. Two variants, because the
// tab has two AI columns answering two different questions:
//
//   ACTION  the work order — what the workshop should do (prompt-parking.ts)
//   gemini  the DS analysis — what the vehicle's history says (the main prompt)
//
// Both reuse a stored analysis when the vehicle has not been worked on since,
// so a second pass over the tab costs nothing.
//
// Batched deliberately. Sending 84 plates as one request would sit silently
// for minutes and die on a function timeout; this walks the tab in small
// batches so the toast can say where it is, and so a failure costs one batch
// rather than the run.

import { useState } from "react";
import { toast } from "sonner";
import { ListChecks } from "lucide-react";
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

// Matches the route's own cap.
const BATCH = 8;

type Outcome =
  | "written" | "reused" | "manual" | "no-action" | "no-summary" | "no-history" | "no-row" | "failed";
type Result = { imm: string; outcome: Outcome; actions?: number; error?: string };

const VARIANTS = {
  actions: {
    endpoint: "/api/parking/actions",
    // "(liste)" because each ROW carries its own Action / Analyse DS pair:
    // two buttons with the same name on one page, one acting on a vehicle and
    // one on 84 of them, is a mis-click waiting to happen.
    label: "Actions IA (liste)",
    busyLabel: "Génération…",
    title: "Analyser chaque véhicule et écrire les opérations à effectuer dans sa colonne ACTION",
    dialogTitle: (n: number) => `Générer les actions pour ${n} véhicule(s) ?`,
    dialogBody:
      "Les opérations à effectuer sont écrites dans la colonne ACTION, prêtes à être copiées dans un ordre de réparation. Une analyse déjà enregistrée est réutilisée telle quelle — seuls les véhicules dont l'historique a changé consomment un appel. Les cellules ACTION remplies à la main ne sont jamais écrasées.",
    confirm: "Générer",
  },
  analyse: {
    endpoint: "/api/parking/analyse",
    label: "Analyse DS (liste)",
    busyLabel: "Analyse…",
    title: "Analyser l'historique DS de chaque véhicule et écrire le résumé dans sa colonne gemini",
    dialogTitle: (n: number) => `Analyser ${n} véhicule(s) ?`,
    dialogBody:
      "L'historique DS de chaque véhicule est analysé et le résumé est écrit dans la colonne gemini de CET onglet — aucun autre onglet n'est touché. Une analyse déjà enregistrée est relue depuis la base sans nouvel appel ; seuls les véhicules dont l'historique a changé en consomment un.",
    confirm: "Analyser",
  },
} as const;

export function GenerateActionsButton({
  imms,
  variant = "actions",
  onDone,
}: {
  imms: string[];
  /** Which column this button fills. See VARIANTS. */
  variant?: keyof typeof VARIANTS;
  /** Called once at the end so the page can refetch the rows it just changed. */
  onDone?: () => void;
}) {
  const v = VARIANTS[variant];
  const [busy, setBusy] = useState(false);

  async function run() {
    if (busy || imms.length === 0) return;
    setBusy(true);
    const id = toast.loading(`${v.label} — 0/${imms.length}`);
    const all: Result[] = [];

    try {
      for (let i = 0; i < imms.length; i += BATCH) {
        const slice = imms.slice(i, i + BATCH);
        const res = await fetch(v.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imms: slice }),
        });
        const json = (await res.json()) as { ok: true; results: Result[] } | { ok: false; error: string };
        if (!json.ok) throw new Error(json.error);
        all.push(...json.results);
        toast.loading(`${v.label} — ${Math.min(i + BATCH, imms.length)}/${imms.length}`, { id });
      }

      const n = (o: Outcome) => all.filter((r) => r.outcome === o).length;
      const written = n("written") + n("reused");
      // Every outcome is named. A silent "done" over a run that wrote 3 cells
      // and skipped 60 would be worse than no button at all.
      const parts = [
        `${written} ${variant === "actions" ? "action(s)" : "résumé(s)"} écrit(s)`,
        n("reused") > 0 ? `dont ${n("reused")} sans nouvel appel` : "",
        n("manual") > 0 ? `${n("manual")} conservée(s) (saisie manuelle)` : "",
        n("no-action") > 0 ? `${n("no-action")} sans action à faire` : "",
        n("no-summary") > 0 ? `${n("no-summary")} sans résumé exploitable` : "",
        n("no-history") > 0 ? `${n("no-history")} sans historique DS` : "",
        n("failed") > 0 ? `${n("failed")} en échec` : "",
      ].filter(Boolean);

      onDone?.();
      if (n("failed") > 0) toast.warning(parts.join(" · "), { id, duration: 10_000 });
      else toast.success(parts.join(" · "), { id, duration: 8_000 });
    } catch (e) {
      toast.error(`${v.label} interrompu : ${e instanceof Error ? e.message : "échec"}`, { id });
      onDone?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || imms.length === 0}
          title={v.title}
        >
          <ListChecks className="h-3.5 w-3.5" />
          {busy ? v.busyLabel : v.label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>{v.dialogTitle(imms.length)}</AlertDialogTitle>
        <AlertDialogDescription>{v.dialogBody}</AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction onClick={() => void run()}>{v.confirm}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
