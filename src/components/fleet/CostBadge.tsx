// Displays the cost of one Gemini call, next to that call's result. Every
// action that calls Gemini gets its costInfo back inline in the same response
// (see src/lib/ai/), so this renders immediately — it never
// fetches anything itself.
//
// The figure is an estimate, not billing — hence the "est." prefix and the
// title tooltip. See the header comment in src/lib/ai/gemini.ts.

import { Badge } from "@/components/ui/badge";
import type { CostInfo } from "@/types";

// 3 decimals: a single Flash-Lite call lands around 0.001–0.05 MAD, so 2 would
// round most calls to "0.00 MAD".
//
// Every numeric read here goes through num(): this badge renders a payload
// that crossed the network, and its type is a promise about the CURRENT
// server, not the one that actually answered. A browser holding client JS from
// one deploy can be served by a function from another, and a field added later
// is then simply absent. `undefined.toFixed()` throws during render, and this
// badge sits inside a card — before CardErrorBoundary that took the whole page
// down with it. A missing figure shows "?" instead.
function num(v: unknown, digits: number): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "?";
}

function formatMad(mad: unknown): string {
  return num(mad, 3);
}

export function CostBadge({ costInfo, className }: { costInfo: CostInfo; className?: string }) {
  const isFree = costInfo.tier === "free";

  return (
    <Badge
      variant={isFree ? "success" : "warning"}
      className={className}
      title={
        `Estimation locale, pas une facture — à recouper avec le tableau de bord Google AI Studio.\n` +
        `Modèle demandé : ${costInfo.model}\n` +
        (costInfo.servedModel ? `Modèle servi : ${costInfo.servedModel}\n` : "") +
        `Tarifé comme : ${costInfo.pricedAs}\n` +
        (costInfo.aliasDrift ? `⚠ L'alias a changé de modèle — coût non fiable.\n` : "") +
        `Tokens : ${costInfo.inputTokens} entrée / ${costInfo.outputTokens} sortie\n` +
        `Coût : ${num(costInfo.costUsd, 6)} USD` +
        (isFree ? "" : `\nCrédit restant : ${num(costInfo.remainingCreditUsd, 2)} USD`)
      }
    >
      <span className="font-mono">est. {formatMad(costInfo.costMad)} MAD</span>
      <span aria-hidden="true">·</span>
      <span>
        {isFree
          ? "gratuit"
          : `payant, ${costInfo.inputTokens} / ${costInfo.outputTokens} tokens`}
      </span>
    </Badge>
  );
}
