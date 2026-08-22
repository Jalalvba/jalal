"use client";

// One click: analyse every vehicle on the PARKING tab and write each one's
// work order into its own ACTION cell.
//
// The list pages already carry a per-card "Résumé IA" button; this is the
// other half — the service advisor's view, where the useful output is not a
// paragraph about the vehicle but the list of operations to book, sitting in
// the column they already read.
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

type Outcome = "written" | "reused" | "manual" | "no-action" | "no-history" | "no-row" | "failed";
type Result = { imm: string; outcome: Outcome; actions?: number; error?: string };

export function GenerateActionsButton({
  imms,
  onDone,
}: {
  imms: string[];
  /** Called once at the end so the page can refetch the rows it just changed. */
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function run() {
    if (busy || imms.length === 0) return;
    setBusy(true);
    const id = toast.loading(`Génération des actions — 0/${imms.length}`);
    const all: Result[] = [];

    try {
      for (let i = 0; i < imms.length; i += BATCH) {
        const slice = imms.slice(i, i + BATCH);
        const res = await fetch("/api/parking/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imms: slice }),
        });
        const json = (await res.json()) as { ok: true; results: Result[] } | { ok: false; error: string };
        if (!json.ok) throw new Error(json.error);
        all.push(...json.results);
        toast.loading(`Génération des actions — ${Math.min(i + BATCH, imms.length)}/${imms.length}`, { id });
      }

      const n = (o: Outcome) => all.filter((r) => r.outcome === o).length;
      const written = n("written") + n("reused");
      // Every outcome is named. A silent "done" over a run that wrote 3 cells
      // and skipped 60 would be worse than no button at all.
      const parts = [
        `${written} action(s) écrite(s)`,
        n("reused") > 0 ? `dont ${n("reused")} sans nouvel appel` : "",
        n("manual") > 0 ? `${n("manual")} conservée(s) (saisie manuelle)` : "",
        n("no-action") > 0 ? `${n("no-action")} sans action à faire` : "",
        n("no-history") > 0 ? `${n("no-history")} sans historique DS` : "",
        n("failed") > 0 ? `${n("failed")} en échec` : "",
      ].filter(Boolean);

      onDone?.();
      if (n("failed") > 0) toast.warning(parts.join(" · "), { id, duration: 10_000 });
      else toast.success(parts.join(" · "), { id, duration: 8_000 });
    } catch (e) {
      toast.error(`Génération interrompue : ${e instanceof Error ? e.message : "échec"}`, { id });
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
          title="Analyser chaque véhicule et écrire les opérations à effectuer dans sa colonne ACTION"
        >
          <ListChecks className="h-3.5 w-3.5" />
          {busy ? "Génération…" : "Actions IA"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>Générer les actions pour {imms.length} véhicule(s) ?</AlertDialogTitle>
        <AlertDialogDescription>
          Chaque véhicule est analysé et les opérations à effectuer sont écrites dans sa
          colonne ACTION, prêtes à être copiées dans un ordre de réparation. Une analyse
          déjà enregistrée est réutilisée telle quelle — seuls les véhicules dont
          l&apos;historique a changé consomment un appel. Les cellules ACTION remplies à la
          main ne sont jamais écrasées.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction onClick={() => void run()}>Générer</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
