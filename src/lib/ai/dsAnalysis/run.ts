// Running one vehicle's analysis: prompt, model call, guards, storage.
//
// Extracted from /api/ds-history/analyze so a SECOND caller — Parking's
// "generate the work orders" batch — runs byte-for-byte the same thing.
// Duplicating it would mean two prompts, two sets of guards and two chances to
// drift, in a feature whose entire value is that the output is trustworthy;
// this repo has been bitten by exactly that (see dsAnalysis/payload.ts's
// header on the entries mapping that was written out twice).
//
// The HTTP route keeps everything HTTP-shaped — parsing, rate limiting, status
// codes, the follow-up branch. This file knows nothing about requests.

import { log, serializeError } from "@/lib/http/logger";
import { callAI } from "@/lib/ai";
import type { CostInfo } from "@/lib/ai/types";
import {
  buildDsAnalysisPrompt,
  computeContractStatus,
  dsAnalysisShapeError,
  ungroundedDates,
  ungroundedSuppliers,
  DS_ANALYSIS_SYSTEM_PROMPT,
  type DsAnalysis,
  type DsAnalysisInput,
} from "@/lib/ai/prompts/dsAnalysis";
import {
  computeIntervalChecks,
  formatIntervalChecks,
  checkBeltPump,
  formatBeltPumpCheck,
  resolveVehicleKm,
  formatKmSourceLine,
  type IntervalCheck,
  type BeltPumpCheck,
} from "@/lib/ai/prompts/maintenanceIntervals";
import { checkOilGrade, formatOilGradeCheck, type OilGradeCheck } from "@/lib/ai/prompts/oilGrade";
import { resolveContractEnd } from "@/lib/vehicle/contractEnd";
import { saveAnalysis } from "@/lib/mongo/dsAnalyses";
import { promptFingerprint } from "@/lib/ai/dsAnalysis/stored";
import { enforceActionStyle } from "@/lib/ai/dsAnalysis/workOrder";
import { DS_PARKING_WORKORDER_PROMPT } from "@/lib/ai/dsAnalysis/prompt-parking";

/**
 * Two tiers, chosen by NAME. A client may ask for "pro"; it may never name a
 * model (docs/ai.md §2.3), or a compromised page could point this at anything
 * and bill it.
 *
 * Measured over all 101 Suivi RL plates, same prompt, graded in code
 * (scripts/audit-ds-analysis.ts): flash-lite cited a date absent from the data
 * on 11% of vehicles, got 14 supplier counts wrong and invented a whole "grade
 * d'huile" finding; gemini-flash-latest scored zero on all of those. So "pro"
 * is genuinely more accurate, and genuinely costs ~$0.008 (≈0.08 MAD) a call
 * against flash-lite's free tier.
 */
export const TIERS = {
  standard: { model: "gemini-flash-lite-latest", maxTokens: 1_800 },
  // 1_800 is NOT enough here: gemini-3.7-flash is a thinking model and its
  // thoughtsTokenCount is billed — and capped — as output. At 1_800, 31 of 101
  // calls came back HTTP 200 with finishReason MAX_TOKENS, i.e. a truncated
  // body failing the shape check as an opaque "bad-response". At 4_000 that
  // fell to 1 of 101; 5_000 is that measurement plus margin.
  pro: { model: "gemini-flash-latest", maxTokens: 5_000 },
} as const;

export type Tier = keyof typeof TIERS;

/** Anything other than the literal "pro" means the free tier. Never throws. */
export function resolveTier(v: unknown): Tier {
  return v === "pro" ? "pro" : "standard";
}

/**
 * Default sampling temperature: the DS History analysis and the follow-up.
 *
 * Unchanged. Those produce prose for a human to read, and nothing in this
 * project shows their quality suffering from it.
 */
export const TEMPERATURE = 0.2;

/**
 * The PARKING work order runs at 0 — greedy decoding.
 *
 * Its load-bearing output is a CLASSIFICATION, not prose: rule A0.5 picks one
 * of nine zone values, and that value is written to a validated sheet column
 * and acted on physically. There is no diversity to be gained from sampling a
 * label, and variance there is a correctness bug rather than a style
 * difference. Measured 2026-08-29 at 0.2, same vehicle, same input, four runs:
 * 26845-T-6 returned DISPONIBLE-A-LIVRER, then ATELIER, then ATELIER, then
 * AVIS-PIERRE-PARENT. One vehicle, three different destinations.
 *
 * It also cuts sheet churn. mayOverwrite() compares the ACTION cell against
 * this app's own last output byte for byte, so an answer that reshuffles
 * between runs rewrites the cell every pass; a stable one leaves it alone.
 *
 * 0 rather than 0.05: greedy decoding is the argmax, which is exactly what a
 * classifier should return. A small non-zero value buys nothing here — it only
 * reintroduces, at lower probability, the same failure. Note this makes the
 * call as deterministic as the provider allows, not mathematically guaranteed:
 * backend batching and hardware can still shift a token. Treat it as "stable",
 * not "provably fixed".
 */
export const PARKING_WORKORDER_TEMPERATURE = 0;

/**
 * Which temperature a prompt runs at.
 *
 * Keyed on the prompt document rather than on the calling route, deliberately:
 * /api/parking/analyse is a Parking route that runs the DS HISTORY prompt, so
 * "is this parking?" is the wrong question and would have silently dropped that
 * route's summaries to 0 as well. The prompt is the task; the task sets the
 * temperature. A new prompt gets the default until it is listed here.
 */
export function temperatureFor(systemPrompt: string): number {
  return systemPrompt === DS_PARKING_WORKORDER_PROMPT
    ? PARKING_WORKORDER_TEMPERATURE
    : TEMPERATURE;
}
// Median pro call 4.3s, slowest of 98 was 14.8s. 45s is headroom, not a guess.
export const REQUEST_TIMEOUT_MS = 45_000;

/** Models wrap JSON in ```json fences often enough to be worth handling. */
export function stripFence(t: string): string {
  const m = t.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : t.trim();
}

export type AnalysisRun = {
  analysis: DsAnalysis;
  intervalChecks: IntervalCheck[];
  beltPumpCheck: BeltPumpCheck;
  oilGradeCheck: OilGradeCheck;
  checkLines: string[];
  costInfo: CostInfo;
  stored: boolean;
  tier: Tier;
};

/**
 * The whole chain for one vehicle. Throws AiCallError on a model failure —
 * callers decide what that means in their own context (an HTTP status, or one
 * failed row in a batch).
 *
 * `input.contractEnd` is filled in here when the caller had none, which is why
 * a card that knows only a plate no longer reports "contrat inconnu" for a
 * vehicle whose contract end we hold.
 */
export async function runDsAnalysis(
  input: DsAnalysisInput,
  tier: Tier,
  /**
   * Which prompt document to run. DS History's analysis is the default;
   * Parking passes DS_PARKING_WORKORDER_PROMPT, which asks the same model,
   * about the same data, under the same grounding rules, for a work order
   * instead of a report. Passed in rather than branched on a mode flag: the
   * prompts are separate documents (see prompt-parking.ts's header) and this
   * keeps the runner unaware of how many there are.
   */
  systemPrompt: string = DS_ANALYSIS_SYSTEM_PROMPT
): Promise<AnalysisRun> {
  input.contractEnd = await resolveContractEnd(input.imm, input.contractEnd);

  const contractStatus = computeContractStatus(input.contractEnd);
  // Computed in code, never asked of the model — same rule as the contract date.
  const intervalChecks = computeIntervalChecks(input.entries, input.manualKm);
  const beltPumpCheck = checkBeltPump(input.entries, input.manualKm);
  // No manualKm: this check does no km arithmetic at all (see oilGrade.ts's
  // header), so an odometer override has nothing to act on here.
  const oilGradeCheck = checkOilGrade(input.entries);
  const resolvedKm = resolveVehicleKm(input.manualKm, input.entries);
  // Built once: these lines go INTO the prompt and are also source text for the
  // supplier guard (the model is told to quote them, so quoting them cannot
  // count as fabrication). A second, separately built copy is what would drift.
  const checkLines = [
    // FIRST, before the checks it explains: it names which odometer every line
    // below was computed against. It is also guard source text — "KM DÉCLARÉ
    // MANUELLEMENT" is an upper-case run that ungroundedSuppliers() would
    // otherwise read as a fabricated supplier name and use to delete the very
    // finding that quoted it (prompts/dsAnalysis.ts:332-347).
    ...formatKmSourceLine(resolvedKm),
    ...formatIntervalChecks(intervalChecks),
    ...formatBeltPumpCheck(beltPumpCheck),
    ...formatOilGradeCheck(oilGradeCheck),
  ];

  const { text, costInfo } = await callAI({
    action: "ds-history-analysis",
    model: TIERS[tier].model,
    prompt: buildDsAnalysisPrompt(input, contractStatus, checkLines),
    systemPrompt,
    maxTokens: TIERS[tier].maxTokens,
    temperature: temperatureFor(systemPrompt),
    timeoutMs: REQUEST_TIMEOUT_MS,
    validate: (t) => {
      // Names WHICH field failed. "failed validation" is impossible to act on
      // when the model is non-deterministic and the schema has ~6 fields.
      try {
        const reason = dsAnalysisShapeError(JSON.parse(stripFence(t)));
        if (reason) log("warn", "ds-analysis", "Response rejected by shape check", { imm: input.imm, reason });
        return reason === null;
      } catch (err) {
        log("warn", "ds-analysis", "Response was not parseable JSON", {
          imm: input.imm,
          head: t.slice(0, 120),
          ...serializeError(err),
        });
        return false;
      }
    },
  });

  const analysis = JSON.parse(stripFence(text)) as DsAnalysis;

  // BEFORE the guards: an action carrying a date is a style violation the
  // prompt already forbids, and leaving it in means ungroundedDates() deletes
  // the whole instruction instead of the decoration. Stripping first keeps the
  // guard's job (unsupported CLAIMS) separate from formatting.
  if (analysis.actions) analysis.actions = enforceActionStyle(analysis.actions);

  // Drop anything carrying a date absent from the source. The whole item goes,
  // not just the date: a claim stripped of its invented evidence is not a
  // weaker claim, it is an unsupported one — and an ACTION carrying one is
  // worse than a finding, because somebody books the work.
  const bad = ungroundedDates(analysis, input);
  if (bad.length > 0) {
    log("warn", "ds-analysis", "Model emitted dates absent from the source data", { imm: input.imm, ungrounded: bad });
    analysis.findings = analysis.findings.filter(
      (f) => !bad.some((d) => f.title.includes(d) || f.detail.includes(d))
    );
    analysis.actions = analysis.actions?.filter((a) => !bad.some((d) => a.includes(d)));
    if (bad.some((d) => analysis.summary.includes(d))) {
      analysis.summary =
        "Résumé retiré : il citait des dates absentes des données sources. Consultez les constats ci-dessus.";
    }
  }

  // Same treatment for invented supplier names.
  const badSuppliers = ungroundedSuppliers(analysis, input, checkLines);
  if (badSuppliers.length > 0) {
    log("warn", "ds-analysis", "Model emitted supplier-like names absent from the source data", {
      imm: input.imm,
      ungrounded: badSuppliers,
    });
    const norm = (t: string) => t.toUpperCase().replace(/\s+/g, " ");
    analysis.findings = analysis.findings.filter(
      (f) => !badSuppliers.some((n) => norm(`${f.title} ${f.detail}`).includes(n))
    );
    analysis.actions = analysis.actions?.filter((a) => !badSuppliers.some((n) => norm(a).includes(n)));
  }

  // Stored so the next reader gets this answer for free. Awaited but never
  // fatal: the call is paid for and the analysis is correct, so a Mongo failure
  // costs a future re-run, not this result.
  let stored = false;
  try {
    stored = await saveAnalysis({
      imm: input.imm,
      analysis,
      tier,
      model: TIERS[tier].model,
      costUsd: costInfo.costUsd,
      entriesCount: input.entries.length,
      lastEntryDate: input.entries[0]?.date ?? null,
      // Which odometer this answer was computed against — isStale() compares it
      // so a corrected km forces a re-run, the same way promptHash does for a
      // rules change.
      manualKm: input.manualKm,
      // Which rules produced this. A later run under different rules must not
      // reuse it — see StoredDsAnalysis.promptHash.
      promptHash: promptFingerprint(systemPrompt),
    });
  } catch (e) {
    log("warn", "ds-analysis", "Could not store the analysis", { imm: input.imm, ...serializeError(e) });
  }

  return { analysis, intervalChecks, beltPumpCheck, oilGradeCheck, checkLines, costInfo, stored, tier };
}
