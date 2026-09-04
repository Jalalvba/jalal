// DS History "Analyse IA": sends one vehicle's maintenance history to the AI
// module and returns a structured health analysis. Writes nothing to
// Sheets, but IS NOT read-only: runDsAnalysis() (src/lib/ai/dsAnalysis/run.ts)
// upserts the result into Mongo's ds_analyses collection, keyed by the
// client-supplied `imm` in the request body — one document per plate, the
// CURRENT analysis, not a log. That document is what /api/ds-history/analysis
// reads back, and what Suivi RL's cards render without paying for a re-run.
// The client-controlled imm is accepted deliberately (see the trade-off note
// below on the whole payload being client-controlled): a compromised page
// could only ever overwrite its OWN analysis document, and
// parking/actions/route.ts's reuse (:322-347) is additionally gated on
// promptHash matching the CURRENT prompt, so a stale or tampered document
// can't silently outlive the rules that were supposed to produce it. The
// only OTHER record this route leaves is the usual gemini_usage cost row,
// under action "ds-history-analysis" so it is traceable separately from
// bdd-reformulate.
//
// The client sends data it has ALREADY loaded rather than this route
// re-fetching it. /api/ds/history's ~100-line aggregation (with its $lookup
// into bc) is not exported as a reusable helper, so re-fetching would mean a
// second copy of it — the same duplication class that let ef630e0's bug
// outlive its own fix. The page holds exactly this data after any search, so
// re-reading it would also cost a round trip for identical bytes. The
// trade-off accepted: the payload is client-controlled, so it is validated and
// capped below. There is no real threat model here — one authorised user, and
// the only person who could feed the model false data is the person reading
// the result.

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { rateLimitOrNull } from "@/lib/http/rateLimit";
import { callAI, AiCallError, type AiErrorKind } from "@/lib/ai";
import { log } from "@/lib/http/logger";
import {
  computeContractStatus,
  ungroundedDatesInText,
  canonicalizeSuppliers,
  DS_FOLLOWUP_SYSTEM_PROMPT,
  buildFollowUpPrompt,
  isDsAnalysisShape as isPriorAnalysisShape,
  MAX_FOLLOW_UP_LENGTH,
  MAX_ENTRIES,
  type DsAnalysis,
  type DsAnalysisInput,
  type RepairOrigin,
} from "@/lib/ai/prompts/dsAnalysis";
import {
  computeIntervalChecks,
  formatIntervalChecks,
  checkBeltPump,
  formatBeltPumpCheck,
  formatRulesReference,
  resolveVehicleKm,
  formatKmSourceLine,
} from "@/lib/ai/prompts/maintenanceIntervals";
import { checkOilGrade, formatOilGradeCheck } from "@/lib/ai/prompts/oilGrade";
import {
  runDsAnalysis,
  resolveTier,
  TIERS,
  TEMPERATURE,
  REQUEST_TIMEOUT_MS,
  type Tier,
} from "@/lib/ai/dsAnalysis/run";

// Lower than bdd-reformulate's 20/min: each call carries a whole vehicle
// history (~4k input tokens vs ~200) and is a deliberate one-at-a-time action,
// not something sitting next to every row on a list page.
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 1000;
// Separate, tighter bucket. A follow-up costs MORE than the analysis it
// challenges (it re-sends the payload AND the previous analysis), so sharing
// the analysis budget would let repeated challenges crowd out real analyses.
// 5/min is generous for a human typing questions.
const FOLLOWUP_RATE_LIMIT = 5;
// The tier table, the runner and its constants live in
// src/lib/ai/dsAnalysis/run.ts — shared with Parking's batch work-order
// generator so both go through the same prompt and the same guards.

const MAX_INPUT_ENTRIES = 500;
const MAX_TEXT_FIELD = 2000;

const ERROR_MESSAGES: Record<AiErrorKind, string> = {
  unconfigured: "L'analyse IA n'est pas configurée",
  "rate-limited": "Analyse rate-limitée en amont. Réessayez dans un instant.",
  upstream: "Échec de l'analyse",
  timeout: "L'analyse a expiré. Réessayez.",
  "bad-response": "L'analyse n'a pas produit de résultat exploitable",
};

/** Narrows the client payload without trusting any of it. */
function parseInput(body: unknown): DsAnalysisInput | string {
  if (typeof body !== "object" || body === null) return "Corps de requête invalide";
  const b = body as Record<string, unknown>;

  const imm = typeof b.imm === "string" ? b.imm.trim() : "";
  if (!imm) return "imm est requis";

  if (!Array.isArray(b.entries)) return "entries est requis";
  if (b.entries.length === 0) return "Aucune intervention à analyser";
  if (b.entries.length > MAX_INPUT_ENTRIES) return `Trop d'interventions (max ${MAX_INPUT_ENTRIES})`;

  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, MAX_TEXT_FIELD) : undefined);

  const ORIGINS: RepairOrigin[] = ["interne", "externe", "inconnu"];
  const entries = b.entries.map((raw) => {
    const e = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    // An unrecognised origin degrades to "inconnu" rather than being guessed —
    // "we don't know" is a real answer here, not a fallback to internal.
    const origin: RepairOrigin = ORIGINS.includes(e.origin as RepairOrigin)
      ? (e.origin as RepairOrigin)
      : "inconnu";
    const supplier = str(e.supplier)?.trim();
    return {
      date: str(e.date),
      km: typeof e.km === "number" && Number.isFinite(e.km) ? e.km : undefined,
      description: str(e.description),
      parts: Array.isArray(e.parts)
        ? e.parts.filter((p): p is string => typeof p === "string").map((p) => p.slice(0, 200))
        : [],
      origin,
      // A supplier only means anything on an external entry.
      ...(origin === "externe" && supplier ? { supplier: supplier.slice(0, 200) } : {}),
    };
  });

  const veh = (typeof b.vehicle === "object" && b.vehicle !== null ? b.vehicle : {}) as Record<string, unknown>;
  const reps = Array.isArray(b.replacements) ? b.replacements.slice(0, 50) : [];

  return {
    imm,
    contractEnd: typeof b.contractEnd === "string" && b.contractEnd.trim() ? b.contractEnd : null,
    vehicle: { brand: str(veh.brand), model: str(veh.model), state: str(veh.state) },
    replacements: reps.map((raw) => {
      const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
      return { date: str(r.date), motif: str(r.motif) };
    }),
    entries: canonicalizeSuppliers(entries),
    // Only a real positive number survives. Anything else — a string, NaN, a
    // negative, an absent field — falls through and the checks use the
    // DS-derived odometer, which is the correct behaviour for every zone that
    // has no KM column at all.
    ...(typeof b.manualKm === "number" && Number.isFinite(b.manualKm) && b.manualKm > 0
      ? { manualKm: b.manualKm }
      : {}),
  };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  // A follow-up is the same payload plus a question and the analysis being
  // challenged. Detected before rate limiting so it draws on its own bucket.
  const raw = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const followUpRaw = raw.followUp;
  const isFollowUp = typeof followUpRaw === "object" && followUpRaw !== null;

  const limited = await rateLimitOrNull(
    request,
    isFollowUp ? "ds-history-followup" : "ds-history-analysis",
    isFollowUp ? FOLLOWUP_RATE_LIMIT : RATE_LIMIT,
    RATE_WINDOW_MS
  );
  if (limited) return limited;

  const parsed = parseInput(body);
  if (typeof parsed === "string") {
    return NextResponse.json({ ok: false, error: parsed }, { status: 400 });
  }

  // Read off the raw body, not parseInput's shape: the tier is about HOW to
  // answer, not about the vehicle being asked about.
  const tier = resolveTier(raw.quality);

  if (isFollowUp) {
    // A follow-up challenges an analysis, so it is answered by the same tier
    // that produced it — a free model second-guessing a paid one's finding
    // would be worse than useless.
    return handleFollowUp(parsed, followUpRaw as Record<string, unknown>, tier);
  }

  try {
    const run = await runDsAnalysis(parsed, tier);

    return NextResponse.json({
      ok: true,
      analysis: run.analysis,
      stored: run.stored,
      intervalChecks: run.intervalChecks,
      beltPumpCheck: run.beltPumpCheck,
      oilGradeCheck: run.oilGradeCheck,
      truncated: parsed.entries.length > MAX_ENTRIES,
      analysedCount: Math.min(parsed.entries.length, MAX_ENTRIES),
      totalCount: parsed.entries.length,
      tier: run.tier,
      costInfo: run.costInfo,
    });
  } catch (e) {
    if (e instanceof AiCallError) {
      return NextResponse.json({ ok: false, error: ERROR_MESSAGES[e.kind] }, { status: e.status });
    }
    log("error", "ds-analysis", "Unexpected failure", { imm: parsed.imm });
    return NextResponse.json({ ok: false, error: "Échec de l'analyse" }, { status: 500 });
  }
}



/**
 * Answers a question about an analysis already shown, grounded in the exact
 * same payload. Free text, not JSON — a challenge deserves a sentence, not a
 * schema — so `validate` here is a non-empty check rather than a shape check.
 */
async function handleFollowUp(
  parsed: DsAnalysisInput,
  followUp: Record<string, unknown>,
  tier: Tier
): Promise<NextResponse> {
  const question = typeof followUp.question === "string" ? followUp.question.trim() : "";
  if (!question) {
    return NextResponse.json({ ok: false, error: "La question est vide" }, { status: 400 });
  }
  if (question.length > MAX_FOLLOW_UP_LENGTH) {
    return NextResponse.json(
      { ok: false, error: `La question dépasse ${MAX_FOLLOW_UP_LENGTH} caractères` },
      { status: 400 }
    );
  }
  if (!isPriorAnalysisShape(followUp.previousAnalysis)) {
    return NextResponse.json(
      { ok: false, error: "Analyse précédente manquante ou invalide" },
      { status: 400 }
    );
  }

  const contractStatus = computeContractStatus(parsed.contractEnd);
  // Same override the analysis turn used, from the same payload — the two
  // turns must not disagree about which odometer they are talking about.
  const intervalChecks = computeIntervalChecks(parsed.entries, parsed.manualKm);
  const beltPumpCheck = checkBeltPump(parsed.entries, parsed.manualKm);
  const oilGradeCheck = checkOilGrade(parsed.entries);

  try {
    const { text, costInfo } = await callAI({
      action: "ds-history-followup",
      model: TIERS[tier].model,
      prompt: buildFollowUpPrompt({
        input: parsed,
        contractStatus,
        intervalLines: [
          ...formatKmSourceLine(resolveVehicleKm(parsed.manualKm, parsed.entries)),
          ...formatIntervalChecks(intervalChecks),
          ...formatBeltPumpCheck(beltPumpCheck),
          ...formatOilGradeCheck(oilGradeCheck),
        ],
        // The rules the analysis was judged against, INCLUDING the ones that
        // did not fire — same check objects, not a second computation.
        rulesLines: formatRulesReference(intervalChecks, beltPumpCheck, oilGradeCheck),
        previousAnalysis: followUp.previousAnalysis as DsAnalysis,
        question,
      }),
      systemPrompt: DS_FOLLOWUP_SYSTEM_PROMPT,
      maxTokens: TIERS[tier].maxTokens,
      temperature: TEMPERATURE,
      timeoutMs: REQUEST_TIMEOUT_MS,
      validate: (t) => t.trim().length > 0,
    });

    // Same grounding standard as the analysis path. Prose cannot have a bad
    // finding removed from it, so an ungrounded date is surfaced to the reader
    // instead of being silently served.
    const badDates = ungroundedDatesInText(text, parsed);
    let answer = text;
    if (badDates.length > 0) {
      log("warn", "ds-analysis", "Follow-up cited dates absent from the source data", {
        imm: parsed.imm,
        ungrounded: badDates,
      });
      answer =
        `${text}\n\n⚠ Vérification automatique : cette réponse cite ${badDates.length > 1 ? "des dates absentes" : "une date absente"} des données sources (${badDates.join(", ")}). Recoupez avec les interventions listées ci-dessous avant d'agir.`;
    }

    return NextResponse.json({ ok: true, answer, question, ungroundedDates: badDates, costInfo });
  } catch (e) {
    if (e instanceof AiCallError) {
      return NextResponse.json({ ok: false, error: ERROR_MESSAGES[e.kind] }, { status: e.status });
    }
    log("error", "ds-analysis", "Unexpected follow-up failure", { imm: parsed.imm });
    return NextResponse.json({ ok: false, error: "Échec de la réponse" }, { status: 500 });
  }
}
