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
function formatMad(mad: number): string {
  return mad.toFixed(3);
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
        `Coût : ${costInfo.costUsd.toFixed(6)} USD` +
        (isFree ? "" : `\nCrédit restant : ${costInfo.remainingCreditUsd.toFixed(2)} USD`)
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
