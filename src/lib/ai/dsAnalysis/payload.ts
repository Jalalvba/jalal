// The single place that turns raw DS history into the analysis payload.
//
// Every page that can run "Analyse IA" sends the SAME request body to
// /api/ds-history/analyze — DS History's rich card, and the compact
// AnalyseAndSaveButton now used on Suivi RL / Parking / Atelier / Depot. Until
// this file existed the entries mapping was written out twice, byte-identical,
// with a comment in one saying it "mirrors" the other. That is exactly the
// duplication that drifts: a change to how parts or origin are derived would
// silently give the model a different picture depending on which page the
// analysis was launched from, and the resulting summaries all land in the same
// BDD gemini cell where nothing would reveal the difference.
//
// It sits under dsAnalysis/ next to prompt.ts rather than in prompts/ proper
// because it is the input side of that same prompt: prompt.ts is what we ask,
// this is what we ask it ABOUT.

import { classifyRepairOrigin } from "@/lib/ai/prompts/dsAnalysis";
import type { DsAnalysisEntry, DsAnalysisInput } from "@/lib/ai/prompts/dsAnalysis";
import type { DsHistoryItem } from "@/types";

/**
 * Maps DS lines to the entries the prompt renders.
 *
 * String()-coerced throughout: these values come from Mongo through an API
 * boundary and do not honour their declared types — the same footgun 77f9eef
 * fixed in the PDF export.
 */
export function toDsAnalysisEntries(items: DsHistoryItem[]): DsAnalysisEntry[] {
  return items.map((it) => ({
    date: it.date_ds,
    km: it.km,
    description: it.description == null ? undefined : String(it.description),
    ...classifyRepairOrigin(it.fournisseur, it.techniciens),
    parts: (it.lines ?? [])
      .map((l) => String(l.designation_consommation ?? ""))
      .filter((p) => p.trim()),
  }));
}

/**
 * The full request body.
 *
 * `contractEnd`, `vehicle` and `replacements` are optional because the zone
 * pages genuinely do not have them: they know a plate and nothing else, and
 * never load parc/cp or the RL replacement rows. Passing null/empty is honest —
 * the prompt has a documented branch for "date de fin de contrat indisponible"
 * — whereas inventing values to fill the shape would be fed to the model as
 * fact.
 */
export function buildDsAnalysisPayload(params: {
  imm: string;
  items: DsHistoryItem[];
  contractEnd?: string | null;
  vehicle?: DsAnalysisInput["vehicle"];
  replacements?: DsAnalysisInput["replacements"];
}): DsAnalysisInput {
  return {
    imm: params.imm,
    contractEnd: params.contractEnd ?? null,
    vehicle: params.vehicle ?? {},
    replacements: params.replacements ?? [],
    entries: toDsAnalysisEntries(params.items),
  };
}
