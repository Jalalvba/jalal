"use client";

// DS History "Analyse IA" card. Sits between the vehicle identity card and the
// sheet rows, above the DS entries it analyses.
//
// Nothing happens on mount: the analysis is only requested when the user
// clicks, so opening the page never costs a Gemini call. The result is
// advisory and is never persisted — reloading the page clears it, which is
// correct, since it would go stale the moment a new DS entry lands.

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { CostBadge } from "@/components/fleet/CostBadge";
import type { CostInfo, DsHistoryItem, ParcItem, CpItem } from "@/types";
import type { RlRow } from "@/lib/sheets/googleSheetsRl";
import { classifyRepairOrigin } from "@/lib/ai/prompts/dsAnalysis";
import type { DsAnalysis, ContractLevel, FindingLevel } from "@/lib/ai/prompts/dsAnalysis";
import type { IntervalCheck, BeltPumpCheck } from "@/lib/ai/prompts/maintenanceIntervals";
import type { OilGradeCheck } from "@/lib/ai/prompts/oilGrade";

type FollowUpExchange = { question: string; answer: string };

type FollowUpResponse =
  | { ok: true; answer: string; question: string; ungroundedDates: string[]; costInfo: CostInfo }
  | { ok: false; error: string };

type AnalyzeResponse =
  | {
      ok: true;
      analysis: DsAnalysis;
      intervalChecks: IntervalCheck[];
      beltPumpCheck: BeltPumpCheck;
      oilGradeCheck: OilGradeCheck;
      truncated: boolean;
      analysedCount: number;
      totalCount: number;
      costInfo: CostInfo;
    }
  | { ok: false; error: string };

const CONTRACT_STYLE: Record<ContractLevel, { variant: "success" | "warning" | "error" | "neutral"; icon: string }> = {
  ok: { variant: "success", icon: "✓" },
  warn: { variant: "warning", icon: "⚠" },
  expired: { variant: "error", icon: "⛔" },
  unknown: { variant: "neutral", icon: "?" },
};

const INTERVAL_STYLE: Record<
  IntervalCheck["status"],
  { variant: "success" | "warning" | "error" | "neutral"; label: string }
> = {
  ok: { variant: "success", label: "À jour" },
  overdue: { variant: "error", label: "Dépassé" },
  never: { variant: "warning", label: "Jamais" },
  unknown: { variant: "neutral", label: "Indéterminé" },
};

// Three distinct visible states — skipped is NOT the same as compliant, and
// neither is the same as flagged. "not_applicable" renders nothing at all:
// saying "does not apply" on every in-contract vehicle would be pure noise.
const BELT_PUMP_STYLE: Record<
  Exclude<BeltPumpCheck["status"], "not_applicable">,
  { variant: "success" | "warning" | "error" | "neutral"; label: string }
> = {
  ok: { variant: "success", label: "Effectué" },
  never: { variant: "error", label: "Jamais" },
  skipped: { variant: "neutral", label: "Non vérifié" },
};

// Only the fired state is shown. "ok"/"not_applicable"/"unknown" are all
// ordinary outcomes here — a vehicle that never left its established grade,
// one that never reached it, and one whose DS never recorded a grade at all
// are not findings, and badging them would put a row on nearly every vehicle.
const OIL_GRADE_STYLE = { variant: "warning" as const, label: "Écart" };

const FINDING_STYLE: Record<FindingLevel, { variant: "success" | "warning" | "error" | "neutral"; label: string }> = {
  info: { variant: "neutral", label: "Info" },
  warn: { variant: "warning", label: "Attention" },
  critical: { variant: "error", label: "Critique" },
};

export function DsAnalysisCard({
  imm,
  items,
  vehicle,
  contracts,
  rlRows,
}: {
  imm: string;
  items: DsHistoryItem[];
  vehicle: ParcItem | null;
  contracts: CpItem[];
  rlRows: RlRow[];
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Extract<AnalyzeResponse, { ok: true }> | null>(null);
  // Appended, never replaced — the point is a visible record of
  // analysis -> question -> answer, not a question silently overwriting it.
  const [exchanges, setExchanges] = useState<FollowUpExchange[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState("");

  // contracts[0], matching VehicleCard directly above this one (page.tsx:263).
  // Picking a different row — e.g. the first WITH a date — would flag one
  // contract's status while the card above displays another's, which reads as
  // a bug even when both values are individually correct.
  const contractEnd = contracts[0]?.date_fin_contrat ?? null;

  // Shown next to the button so the user can see the internal/external split
  // that is being sent, before spending a call on it.
  const originCounts = items.reduce(
    (acc, it) => {
      acc[classifyRepairOrigin(it.fournisseur, it.techniciens).origin]++;
      return acc;
    },
    { interne: 0, externe: 0, inconnu: 0 }
  );

  function buildPayload() {
    return {
      imm,
      contractEnd,
      vehicle: { brand: vehicle?.brand, model: vehicle?.model, state: vehicle?.vehicle_state },
      replacements: rlRows.map((r) => ({ date: r["Date"], motif: r["Motif"] })),
      entries: items.map((it) => ({
        date: it.date_ds,
        km: it.km,
        description: it.description == null ? undefined : String(it.description),
        ...classifyRepairOrigin(it.fournisseur, it.techniciens),
        parts: (it.lines ?? [])
          .map((l) => String(l.designation_consommation ?? ""))
          .filter((p) => p.trim()),
      })),
    };
  }

  async function askFollowUp() {
    const q = question.trim();
    if (!q || !result) return;
    setAsking(true);
    setAskError("");
    try {
      const res = await fetch("/api/ds-history/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The SAME payload the analysis used, plus the analysis being
        // challenged — the answer must be grounded in identical data.
        body: JSON.stringify({
          ...buildPayload(),
          followUp: { question: q, previousAnalysis: result.analysis },
        }),
      });
      const json = (await res.json()) as FollowUpResponse;
      if (!json.ok) {
        setAskError(json.error);
        return;
      }
      setExchanges((prev) => [...prev, { question: json.question, answer: json.answer }]);
      setQuestion("");
    } catch {
      setAskError("Échec de la question — vérifiez la connexion.");
    } finally {
      setAsking(false);
    }
  }

  async function runAnalysis() {
    setLoading(true);
    setError("");
    setResult(null);
    setExchanges([]);
    setAskError("");
    try {
      const res = await fetch("/api/ds-history/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const json = (await res.json()) as AnalyzeResponse;
      if (!json.ok) {
        setError(json.error);
        return;
      }
      setResult(json);
    } catch {
      setError("Échec de l'analyse — vérifiez la connexion.");
    } finally {
      setLoading(false);
    }
  }

  const contractStyle = result ? CONTRACT_STYLE[result.analysis.contractFlag.level] : null;

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Analyse IA
          </span>
        </div>
        {result && <CostBadge costInfo={result.costInfo} />}
      </div>

      <div className="px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={runAnalysis} disabled={loading || items.length === 0}>
            {loading ? "Analyse en cours…" : result ? "Relancer l'analyse" : "Analyser"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {items.length} intervention{items.length > 1 ? "s" : ""}
            {originCounts.externe > 0 || originCounts.interne > 0
              ? ` (${originCounts.interne} interne${originCounts.interne > 1 ? "s" : ""} · ${originCounts.externe} externe${originCounts.externe > 1 ? "s" : ""}${originCounts.inconnu > 0 ? ` · ${originCounts.inconnu} inconnu${originCounts.inconnu > 1 ? "s" : ""}` : ""})`
              : ""}
            {contractEnd
              ? ` · contrat → ${new Date(contractEnd).toLocaleDateString("fr-FR")}`
              : " · contrat inconnu"}
            {rlRows.length > 0 ? ` · ${rlRows.length} remplacement${rlRows.length > 1 ? "s" : ""}` : ""}
          </span>
        </div>

        {error && <Alert className="mt-3">{error}</Alert>}

        {result && (
          <div className="mt-4 space-y-3">
            {/* Truncation notice — surfaced to the user, not just to the model. */}
            {result.truncated && (
              <Alert className="text-xs">
                Analyse basée sur les {result.analysedCount} interventions les plus récentes sur{" "}
                {result.totalCount}. La période antérieure n&apos;a pas été analysée.
              </Alert>
            )}

            {result.analysis.insufficientData && (
              <Alert className="text-xs">
                Données insuffisantes pour conclure de façon fiable.
              </Alert>
            )}

            {/* Contract flag */}
            <div className="flex items-start gap-2">
              <Badge variant={contractStyle!.variant} className="shrink-0">
                {contractStyle!.icon} Contrat
              </Badge>
              <span className="text-sm text-card-foreground">
                {result.analysis.contractFlag.label}
              </span>
            </div>

            {/* Interval compliance — computed in code, shown as facts rather
                than as model prose, so the numbers are auditable. */}
            {result.intervalChecks.length > 0 && (
              <div className="rounded-lg border border-border">
                <div className="border-b border-border px-3 py-1.5 text-micro font-medium uppercase tracking-wide text-muted-foreground">
                  Intervalles d&apos;entretien
                </div>
                <ul className="divide-y divide-border">
                  {result.intervalChecks.map((c) => (
                    <li key={c.service} className="flex items-start gap-2 px-3 py-2">
                      <Badge variant={INTERVAL_STYLE[c.status].variant} className="shrink-0">
                        {INTERVAL_STYLE[c.status].label}
                      </Badge>
                      <div className="min-w-0 text-sm">
                        <span className="font-medium text-card-foreground">{c.label}</span>{" "}
                        <span className="text-muted-foreground">
                          ({c.intervalKm.toLocaleString("fr-FR")} km)
                        </span>
                        <div className="text-xs text-muted-foreground">
                          {c.status === "overdue" &&
                            `Dépassé de ${c.overdueByKm?.toLocaleString("fr-FR")} km — dernier le ${c.lastDate?.slice(0, 10)} à ${c.lastKm?.toLocaleString("fr-FR")} km, compteur ${c.currentKm?.toLocaleString("fr-FR")} km`}
                          {c.status === "ok" &&
                            `${c.kmSince?.toLocaleString("fr-FR")} km depuis le dernier (${c.lastDate?.slice(0, 10)})`}
                          {(c.status === "never" || c.status === "unknown") && c.note}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                {result.beltPumpCheck.status !== "not_applicable" && (
                  <div className="flex items-start gap-2 border-t border-border px-3 py-2">
                    <Badge
                      variant={BELT_PUMP_STYLE[result.beltPumpCheck.status].variant}
                      className="shrink-0"
                    >
                      {BELT_PUMP_STYLE[result.beltPumpCheck.status].label}
                    </Badge>
                    <div className="min-w-0 text-sm">
                      <span className="font-medium text-card-foreground">
                        {result.beltPumpCheck.label}
                      </span>
                      <div className="text-xs text-muted-foreground">
                        {result.beltPumpCheck.status === "never" &&
                          `Jamais enregistré — ${result.beltPumpCheck.currentKm?.toLocaleString("fr-FR")} km (seuil ${result.beltPumpCheck.thresholdKm.toLocaleString("fr-FR")} km)`}
                        {result.beltPumpCheck.status === "ok" &&
                          `Effectué le ${result.beltPumpCheck.lastServiceDate?.slice(0, 10)}${result.beltPumpCheck.lastServiceKm ? ` à ${result.beltPumpCheck.lastServiceKm.toLocaleString("fr-FR")} km` : ""}`}
                        {result.beltPumpCheck.status === "skipped" && result.beltPumpCheck.note}
                      </div>
                    </div>
                  </div>
                )}
                {result.oilGradeCheck.status === "regression" && (
                  <div className="flex items-start gap-2 border-t border-border px-3 py-2">
                    <Badge variant={OIL_GRADE_STYLE.variant} className="shrink-0">
                      {OIL_GRADE_STYLE.label}
                    </Badge>
                    <div className="min-w-0 text-sm">
                      <span className="font-medium text-card-foreground">
                        {result.oilGradeCheck.label}
                      </span>
                      <div className="text-xs text-muted-foreground">
                        {/* Leads with the pre-computed unique list, then the
                            chronology as supporting evidence. Both come from
                            oilGradeCheck.uniqueGrades / .regressions, so this
                            row and the AI finding cannot disagree. */}
                        <span className="font-medium text-card-foreground">
                          {`Grades utilisés : ${result.oilGradeCheck.uniqueGrades.join(", ")} (${result.oilGradeCheck.uniqueGrades.length} grades différents)`}
                        </span>
                        {` — passé au ${result.oilGradeCheck.establishedGrade} le ${result.oilGradeCheck.establishedAt?.date?.slice(0, 10)}, puis ${result.oilGradeCheck.regressions
                          .map((r) => `${r.grade} le ${r.date?.slice(0, 10)}`)
                          .join(", ")}. Grade constructeur inconnu de l'application, à vérifier.`}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Findings */}
            {result.analysis.findings.length > 0 ? (
              <ul className="space-y-2">
                {result.analysis.findings.map((f, i) => {
                  const s = FINDING_STYLE[f.level];
                  return (
                    <li key={i} className="flex items-start gap-2">
                      <Badge variant={s.variant} className="shrink-0">
                        {s.label}
                      </Badge>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-card-foreground">{f.title}</div>
                        {f.detail.trim() && (
                          <div className="text-sm text-muted-foreground">{f.detail}</div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="text-sm text-muted-foreground">
                Aucun signal particulier identifié dans les données fournies.
              </div>
            )}

            {/* Summary */}
            <div className="rounded-lg border border-border bg-muted px-3 py-2">
              <div className="text-micro font-medium uppercase tracking-wide text-muted-foreground">
                Résumé
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-card-foreground">
                {result.analysis.summary}
              </p>
            </div>

            <p className="text-xs text-muted-foreground">
              Analyse générée par IA à partir des interventions listées ci-dessous — vérifiez avant
              de décider.
            </p>

            {/* Question -> answer record. Appended below the analysis, never
                replacing it, so the trail stays visible. */}
            {exchanges.length > 0 && (
              <div className="space-y-2 border-t border-border pt-3">
                {exchanges.map((x, i) => (
                  <div key={i} className="rounded-lg border border-border">
                    <div className="border-b border-border px-3 py-1.5 text-xs font-medium text-card-foreground">
                      <span className="text-muted-foreground">Q — </span>
                      {x.question}
                    </div>
                    <p className="whitespace-pre-wrap px-3 py-2 text-sm text-card-foreground">
                      {x.answer}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Only after an analysis exists — there is nothing to challenge before. */}
            <div className="border-t border-border pt-3">
              <label
                htmlFor="ds-followup"
                className="text-micro font-medium uppercase tracking-wide text-muted-foreground"
              >
                Une question sur cette analyse ?
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id="ds-followup"
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !asking && question.trim()) {
                      e.preventDefault();
                      askFollowUp();
                    }
                  }}
                  maxLength={500}
                  placeholder="ex : pourquoi tu n'as pas mentionné la récurrence sur l'embrayage ?"
                  className="h-9 flex-1 rounded-lg border border-border bg-input px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-zinc-500 focus:outline-none"
                />
                <Button
                  type="button"
                  onClick={askFollowUp}
                  disabled={asking || !question.trim()}
                  className="h-9"
                >
                  {asking ? "…" : "Demander"}
                </Button>
              </div>
              {askError && <Alert className="mt-2 text-xs">{askError}</Alert>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
