"use client";

import * as React from "react";
import { toast } from "sonner";
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
import type { ImportPipelineResult, ImportPipelineRunStatus, ImportPipelineStep } from "@/types";

const LAST_RUN_STORAGE_KEY = "jalal:last-import";

type Phase = "idle" | "running" | "replaying" | "done" | "error";

type FlatLine = {
  pipeline: string;
  step: string;
  // Step-level statuses (started/success/failed/skipped) from real step
  // lines, plus "warning" for the injected stepDetailWarning line, plus
  // ImportPipelineRunStatus for the "no steps recorded" fallback line,
  // which carries the pipeline's own run status (success/failed/
  // skipped_absent/skipped_unchanged/running) instead of a step status.
  status: ImportPipelineStep["status"] | ImportPipelineRunStatus | "warning";
  detail: string;
  timestamp: string | null;
};

type LastRunSummary = {
  ok: boolean;
  text: string;
  finishedAt: string;
};

// Same "space instead of T" Python-str(datetime) shape src/app/api/trigger-import
// already normalizes server-side to real ISO — this only needs the
// browser-local HH:MM:SS.
function fmtTime(iso: string | null): string {
  if (!iso) return "--:--:--";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "--:--:--";
  return d.toLocaleTimeString("fr-FR", { hour12: false });
}

function statusColor(status: FlatLine["status"]): string {
  switch (status) {
    case "success":
      return "text-emerald-400";
    case "started":
    case "skipped":
    case "skipped_absent":
    case "skipped_unchanged":
    case "running":
      return "text-amber-400";
    case "failed":
    case "warning":
      return "text-red-400";
    default:
      return "text-zinc-400";
  }
}

// Degraded data (e.g. the backend's step-detail endpoint being unreachable)
// must never look identical to the real thing — a warning line is injected
// ahead of that pipeline's steps rather than left for the reader to infer
// from suspiciously blank timestamps.
function flattenLines(results: ImportPipelineResult[]): FlatLine[] {
  return results.flatMap((r) => {
    const warning: FlatLine[] = r.stepDetailWarning
      ? [
          {
            pipeline: r.pipeline.toUpperCase(),
            step: "step_detail_lookup",
            status: "warning",
            detail: r.stepDetailWarning,
            timestamp: null,
          },
        ]
      : [];

    const stepLines: FlatLine[] =
      r.steps.length > 0
        ? r.steps.map((s) => ({
            pipeline: r.pipeline.toUpperCase(),
            step: s.step,
            status: s.status,
            detail: s.detail,
            timestamp: s.timestamp,
          }))
        : [
            {
              pipeline: r.pipeline.toUpperCase(),
              // Real status string doubles as the label here (e.g.
              // "skipped_unchanged" vs "skipped_absent") so the two skip
              // reasons stay distinguishable even with no step detail.
              step: r.status === "success" || r.status === "failed" ? "no steps recorded" : r.status,
              status: r.status,
              detail: "",
              timestamp: r.finished_at,
            },
          ];

    return [...warning, ...stepLines];
  });
}

export function buildSummary(results: ImportPipelineResult[], durationSec: number): { ok: boolean; text: string } {
  const failed = results.filter((r) => r.status === "failed");
  const succeeded = results.filter((r) => r.status === "success");
  // Two distinct skip reasons (confirmed against ~/import/run.py's
  // run_all() directly): "skipped_unchanged" (nothing changed since the
  // last successful run — the common case) vs "skipped_absent" (an
  // expected file wasn't in the Drive folder at all — worth calling out
  // separately since it usually means something's actually wrong upstream,
  // not just "up to date"). Grouped together for the aggregate count below
  // but the absent ones get their own callout.
  const skippedUnchanged = results.filter((r) => r.status === "skipped_unchanged");
  const skippedAbsent = results.filter((r) => r.status === "skipped_absent");
  const skippedTotal = skippedUnchanged.length + skippedAbsent.length;

  if (failed.length > 0) {
    const detail = failed
      .map((r) => {
        const failStep = r.steps.find((s) => s.status === "failed") ?? r.steps[r.steps.length - 1];
        const why = failStep ? `${failStep.step}: ${failStep.detail || "no detail available"}` : "unknown error";
        return `${r.pipeline.toUpperCase()} (${why})`;
      })
      .join(", ");
    return { ok: false, text: `❌ Import failed after ${durationSec}s — ${detail}` };
  }

  const absentNote =
    skippedAbsent.length > 0
      ? ` — ${skippedAbsent.map((r) => r.pipeline.toUpperCase()).join(", ")} file${
          skippedAbsent.length > 1 ? "s" : ""
        } not found in Drive`
      : "";

  if (succeeded.length === results.length) {
    return { ok: true, text: `✅ All ${results.length} pipelines completed successfully in ${durationSec}s` };
  }

  if (succeeded.length === 0) {
    return {
      ok: true,
      text: `⏭️ All ${results.length} pipelines already up to date in ${durationSec}s — no changes since last run${absentNote}`,
    };
  }

  return {
    ok: true,
    text: `✅ Import complete in ${durationSec}s — ${succeeded.length} updated, ${skippedTotal} already up to date${absentNote}`,
  };
}

function persistLastRun(summary: LastRunSummary) {
  try {
    localStorage.setItem(LAST_RUN_STORAGE_KEY, JSON.stringify(summary));
  } catch {
    // localStorage unavailable (private browsing, etc.) — non-critical
  }
}

function readLastRun(): LastRunSummary | null {
  try {
    const raw = localStorage.getItem(LAST_RUN_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LastRunSummary) : null;
  } catch {
    return null;
  }
}

const REVEAL_STAGGER_MS = 45;

export function LastImportCard() {
  const [lastRun, setLastRun] = React.useState<LastRunSummary | null | "loading">("loading");

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- readLastRun() reads browser storage, which does not exist on the server; the "loading" sentinel is rendered on both sides and replaced only after mount. Reading it during render would hydrate-mismatch.
    setLastRun(readLastRun());
  }, []);

  // Re-read after ImportTrigger persists a new run in the same tab.
  React.useEffect(() => {
    function onStorage() {
      setLastRun(readLastRun());
    }
    window.addEventListener("import-trigger:last-run", onStorage);
    return () => window.removeEventListener("import-trigger:last-run", onStorage);
  }, []);

  if (lastRun === "loading") {
    return (
      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground">Chargement…</p>
      </div>
    );
  }

  if (!lastRun) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Dernier import</p>
        <p className="mt-1.5 text-sm text-muted-foreground">Aucun import lancé depuis cet appareil.</p>
      </div>
    );
  }

  const date = new Date(lastRun.finishedAt);
  const when = isNaN(date.getTime())
    ? lastRun.finishedAt
    : date.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Dernier import</p>
        <span className={`h-2 w-2 rounded-full ${lastRun.ok ? "bg-emerald-500" : "bg-red-500"}`} />
      </div>
      <p className="mt-1.5 text-sm text-foreground">{lastRun.text}</p>
      <p className="mt-1 text-xs text-muted-foreground">{when}</p>
    </div>
  );
}

export function ImportTrigger() {
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [results, setResults] = React.useState<ImportPipelineResult[] | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [visibleCount, setVisibleCount] = React.useState(0);
  const [runningTick, setRunningTick] = React.useState(0);
  const [elapsedSec, setElapsedSec] = React.useState<number | null>(null);
  const startedAtRef = React.useRef<number | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const flatLines = React.useMemo(() => (results ? flattenLines(results) : []), [results]);
  const summary = React.useMemo(
    () => (results && elapsedSec != null ? buildSummary(results, elapsedSec) : null),
    [results, elapsedSec]
  );

  // "Watching it happen" reveal — data already arrived all at once, so this
  // is purely presentational pacing, not a real-time stream.
  React.useEffect(() => {
    if (phase !== "replaying") return;
    if (visibleCount >= flatLines.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- terminal transition of a timed reveal sequence. This one IS derivable (`phase === "replaying" && visibleCount >= flatLines.length`) and setPhase("done") has no other call site, but deriving it also requires reworking isBusy below — which would otherwise stay true forever once a run finishes — plus five other `phase === "done"` reads. That is a state-machine refactor for a component with no test coverage, so it is tracked rather than folded into a lint pass. See issue #2.
      setPhase("done");
      return;
    }
    const t = setTimeout(() => setVisibleCount((n) => n + 1), REVEAL_STAGGER_MS);
    return () => clearTimeout(t);
  }, [phase, visibleCount, flatLines.length]);

  // Ticking "elapsed" readout while the trigger call is still in flight, so
  // the ~90s wait doesn't read as a stuck/frozen button.
  React.useEffect(() => {
    if (phase !== "running") return;
    const id = setInterval(() => setRunningTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visibleCount, phase]);

  React.useEffect(() => {
    if (phase !== "done" || !summary) return;
    persistLastRun({ ok: summary.ok, text: summary.text, finishedAt: new Date().toISOString() });
    window.dispatchEvent(new Event("import-trigger:last-run"));
  }, [phase, summary]);

  async function startImport() {
    setPhase("running");
    setErrorMsg(null);
    setResults(null);
    setVisibleCount(0);
    setRunningTick(0);
    setElapsedSec(null);
    startedAtRef.current = Date.now();

    try {
      const res = await fetch("/api/trigger-import", { method: "POST" });

      let body: { ok?: boolean; error?: string; results?: ImportPipelineResult[] } | null = null;
      try {
        body = await res.json();
      } catch {
        // non-JSON body — most likely a platform-level timeout
      }

      if (!res.ok || !body?.ok || !body.results) {
        const timeoutHint = res.status === 504 ? " — the request timed out" : "";
        throw new Error(body?.error || `Import request failed (HTTP ${res.status})${timeoutHint}`);
      }

      const elapsed = Math.round((Date.now() - (startedAtRef.current ?? Date.now())) / 1000);
      setElapsedSec(elapsed);
      setResults(body.results);
      setPhase("replaying");
      const { ok, text } = buildSummary(body.results, elapsed);
      if (ok) toast.success(text);
      else toast.error(text);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Erreur inconnue";
      setErrorMsg(message);
      setPhase("error");
      toast.error(`Import échoué : ${message}`);
    }
  }

  const isBusy = phase === "running" || phase === "replaying";

  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-foreground">Import des données flotte</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Relance les 4 pipelines (DS, CP, PARC, BC) depuis Drive vers Mongo — environ 60 à 90 secondes.
          </p>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="default" disabled={isBusy} className="shrink-0">
              {isBusy ? "Import en cours…" : "Run Fleet Data Import"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogTitle>Lancer l&apos;import des données ?</AlertDialogTitle>
            <AlertDialogDescription>
              Ceci va importer des données fraîches dans Mongo (DS, CP, PARC, BC). L&apos;opération prend
              généralement 60 à 90 secondes. Continuer ?
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel />
              <AlertDialogAction onClick={startImport}>Lancer l&apos;import</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {phase !== "idle" && (
        <div
          ref={scrollRef}
          className="mt-4 h-72 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-300 sm:h-80"
        >
          {phase === "running" && (
            <>
              <p className="text-zinc-400">
                Starting import<span className="animate-pulse text-zinc-500">…</span>
              </p>
              <p className="mt-1 text-zinc-500">
                Ceci peut prendre jusqu&apos;à ~90 secondes — merci de patienter.{" "}
                <span className="animate-pulse">▊</span>
                <span className="ml-2 text-zinc-600">({runningTick}s écoulées)</span>
              </p>
            </>
          )}

          {(phase === "replaying" || phase === "done") &&
            flatLines.slice(0, phase === "done" ? flatLines.length : visibleCount).map((line, i) =>
              line.status === "warning" ? (
                <p key={i} className={statusColor(line.status)}>
                  <span className="text-zinc-600">[{fmtTime(line.timestamp)}]</span>{" "}
                  <span className="text-zinc-400">[{line.pipeline}]</span> ⚠ {line.detail}
                </p>
              ) : (
                <p key={i} className={statusColor(line.status)}>
                  <span className="text-zinc-600">[{fmtTime(line.timestamp)}]</span>{" "}
                  <span className="text-zinc-400">[{line.pipeline}]</span> {line.step}: {line.status}
                  {line.detail ? <span className="text-zinc-400"> — {line.detail}</span> : null}
                </p>
              )
            )}

          {phase === "done" && summary && (
            <p className={`mt-2 font-semibold ${summary.ok ? "text-emerald-400" : "text-red-400"}`}>
              {summary.text}
            </p>
          )}

          {phase === "error" && (
            <p className="text-red-400">
              ❌ {errorMsg}
              <br />
              <span className="text-zinc-500">Vous pouvez réessayer.</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
