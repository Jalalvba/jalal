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
  type IntervalCheck,
  type BeltPumpCheck,
} from "@/lib/ai/prompts/maintenanceIntervals";
import { checkOilGrade, formatOilGradeCheck, type OilGradeCheck } from "@/lib/ai/prompts/oilGrade";
import { resolveContractEnd } from "@/lib/vehicle/contractEnd";
import { saveAnalysis } from "@/lib/mongo/dsAnalyses";

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

export const TEMPERATURE = 0.2;
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
export async function runDsAnalysis(input: DsAnalysisInput, tier: Tier): Promise<AnalysisRun> {
  input.contractEnd = await resolveContractEnd(input.imm, input.contractEnd);

  const contractStatus = computeContractStatus(input.contractEnd);
  // Computed in code, never asked of the model — same rule as the contract date.
  const intervalChecks = computeIntervalChecks(input.entries);
  const beltPumpCheck = checkBeltPump(input.entries);
  const oilGradeCheck = checkOilGrade(input.entries);
  // Built once: these lines go INTO the prompt and are also source text for the
  // supplier guard (the model is told to quote them, so quoting them cannot
  // count as fabrication). A second, separately built copy is what would drift.
  const checkLines = [
    ...formatIntervalChecks(intervalChecks),
    ...formatBeltPumpCheck(beltPumpCheck),
    ...formatOilGradeCheck(oilGradeCheck),
  ];

  const { text, costInfo } = await callAI({
    action: "ds-history-analysis",
    model: TIERS[tier].model,
    prompt: buildDsAnalysisPrompt(input, contractStatus, checkLines),
    systemPrompt: DS_ANALYSIS_SYSTEM_PROMPT,
    maxTokens: TIERS[tier].maxTokens,
    temperature: TEMPERATURE,
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
    });
  } catch (e) {
    log("warn", "ds-analysis", "Could not store the analysis", { imm: input.imm, ...serializeError(e) });
  }

  return { analysis, intervalChecks, beltPumpCheck, oilGradeCheck, checkLines, costInfo, stored, tier };
}
