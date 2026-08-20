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
import type { DsAnalysis, ContractLevel, FindingLevel } from "@/lib/ai/prompts/dsAnalysis";

type AnalyzeResponse =
  | {
      ok: true;
      analysis: DsAnalysis;
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

  // contracts[0], matching VehicleCard directly above this one (page.tsx:263).
  // Picking a different row — e.g. the first WITH a date — would flag one
  // contract's status while the card above displays another's, which reads as
  // a bug even when both values are individually correct.
  const contractEnd = contracts[0]?.date_fin_contrat ?? null;

  async function runAnalysis() {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/ds-history/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imm,
          contractEnd,
          vehicle: { brand: vehicle?.brand, model: vehicle?.model, state: vehicle?.vehicle_state },
          // The RL sheet is the vehicle-REPLACEMENT log; a plate appearing
          // there with a motif is a real health signal, and is already why
          // this page tints the vehicle card red.
          replacements: rlRows.map((r) => ({ date: r["Date"], motif: r["Motif"] })),
          entries: items.map((it) => ({
            date: it.date_ds,
            km: it.km,
            description: it.description == null ? undefined : String(it.description),
            // designation_consommation is the strongest signal in this data —
            // descriptions are frequently "pb" or ".".
            //
            // String()-coerced rather than trusting the declared `string |
            // undefined`: these values come straight from Mongo and are not
            // guaranteed to match their type (a real DS line carries
            // qte: "2" as a string, and BDD's modele arrives as a raw number —
            // the footgun 77f9eef fixed in the PDF export). Calling .trim() on
            // a number throws, which would break the button before it ever
            // reached the network.
            parts: (it.lines ?? [])
              .map((l) => String(l.designation_consommation ?? ""))
              .filter((p) => p.trim()),
          })),
        }),
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
          </div>
        )}
      </div>
    </div>
  );
}
