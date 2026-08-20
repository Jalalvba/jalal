// DS History "Analyse IA": sends one vehicle's maintenance history to the AI
// module and returns a structured health analysis. READ-ONLY — this route
// writes nothing to Mongo or Sheets and persists no analysis. The only record
// it leaves is the usual gemini_usage cost row, under action
// "ds-history-analysis" so it is traceable separately from bdd-reformulate.
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
import { log, serializeError } from "@/lib/http/logger";
import {
  buildDsAnalysisPrompt,
  computeContractStatus,
  isDsAnalysisShape,
  dsAnalysisShapeError,
  ungroundedDates,
  ungroundedSuppliers,
  ungroundedDatesInText,
  canonicalizeSuppliers,
  DS_ANALYSIS_SYSTEM_PROMPT,
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
} from "@/lib/ai/prompts/maintenanceIntervals";

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
const DEFAULT_MODEL = "gemini-flash-lite-latest";
const REQUEST_TIMEOUT_MS = 30_000;
// Raised from 900 after live testing: a 50-entry vehicle with three interval
// checks, the belt/pump check and six findings hit exactly 896/900 three times
// running, truncating the JSON mid-object. Highest observed legitimate use is
// ~900, so this leaves real headroom rather than shaving the limit.
const MAX_OUTPUT_TOKENS = 1_800;
const TEMPERATURE = 0.2;

// Hard ceiling on the client-supplied payload, independent of MAX_ENTRIES
// (which truncates for the prompt). This one exists so a malformed or hostile
// request cannot make the server build an unbounded string.
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

  if (isFollowUp) {
    return handleFollowUp(parsed, followUpRaw as Record<string, unknown>);
  }

  const contractStatus = computeContractStatus(parsed.contractEnd);
  // Computed here, never asked of the model — same rule as the contract date.
  const intervalChecks = computeIntervalChecks(parsed.entries);
  // Mileage-only: this check no longer reads date_fin_contrat.
  const beltPumpCheck = checkBeltPump(parsed.entries);
  const prompt = buildDsAnalysisPrompt(parsed, contractStatus, [
    ...formatIntervalChecks(intervalChecks),
    ...formatBeltPumpCheck(beltPumpCheck),
  ]);

  try {
    // validate runs inside callAI, after the response arrives — Gemini's
    // responseSchema steers rather than guarantees, so the shape is checked
    // here rather than assumed. A failure surfaces as kind "bad-response".
    const { text, costInfo } = await callAI({
      action: "ds-history-analysis",
      model: DEFAULT_MODEL,
      prompt,
      systemPrompt: DS_ANALYSIS_SYSTEM_PROMPT,
      maxTokens: MAX_OUTPUT_TOKENS,
      temperature: TEMPERATURE,
      timeoutMs: REQUEST_TIMEOUT_MS,
      validate: (t) => {
        // Logs WHICH field failed. A bare "failed validation" is impossible to
        // act on when the model is non-deterministic and the schema has ~6
        // fields plus an array — this names the offender.
        try {
          const reason = dsAnalysisShapeError(JSON.parse(stripFence(t)));
          if (reason) log("warn", "ds-analysis", "Response rejected by shape check", { imm: parsed.imm, reason });
          return reason === null;
        } catch (err) {
          log("warn", "ds-analysis", "Response was not parseable JSON", {
            imm: parsed.imm,
            head: t.slice(0, 120),
            ...serializeError(err),
          });
          return false;
        }
      },
    });

    const analysis = JSON.parse(stripFence(text)) as DsAnalysis;

    // Second guard: drop any finding carrying a date that isn't in the source.
    // The whole finding goes, not just the date — a recurrence claim stripped
    // of its (invented) evidence is not a weaker claim, it is an unsupported
    // one.
    const bad = ungroundedDates(analysis, parsed);
    if (bad.length > 0) {
      log("warn", "ds-analysis", "Model emitted dates absent from the source data", {
        imm: parsed.imm,
        ungrounded: bad,
      });
      analysis.findings = analysis.findings.filter(
        (f) => !bad.some((d) => f.title.includes(d) || f.detail.includes(d))
      );
      if (bad.some((d) => analysis.summary.includes(d))) {
        analysis.summary =
          "Résumé retiré : il citait des dates absentes des données sources. Consultez les constats ci-dessus.";
      }
    }

    // Same treatment for invented supplier names — an unsupported claim about
    // a named garage is the one this feature adds, so it gets the same guard.
    const badSuppliers = ungroundedSuppliers(analysis, parsed);
    if (badSuppliers.length > 0) {
      log("warn", "ds-analysis", "Model emitted supplier-like names absent from the source data", {
        imm: parsed.imm,
        ungrounded: badSuppliers,
      });
      const norm = (t: string) => t.toUpperCase().replace(/\s+/g, " ");
      analysis.findings = analysis.findings.filter(
        (f) => !badSuppliers.some((n) => norm(`${f.title} ${f.detail}`).includes(n))
      );
    }

    return NextResponse.json({
      ok: true,
      analysis,
      intervalChecks,
      beltPumpCheck,
      truncated: parsed.entries.length > MAX_ENTRIES,
      analysedCount: Math.min(parsed.entries.length, MAX_ENTRIES),
      totalCount: parsed.entries.length,
      costInfo,
    });
  } catch (e) {
    if (e instanceof AiCallError) {
      return NextResponse.json({ ok: false, error: ERROR_MESSAGES[e.kind] }, { status: e.status });
    }
    log("error", "ds-analysis", "Unexpected failure", { imm: parsed.imm });
    return NextResponse.json({ ok: false, error: "Échec de l'analyse" }, { status: 500 });
  }
}

/** Models wrap JSON in ```json fences often enough to be worth handling. */
function stripFence(t: string): string {
  const m = t.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : t.trim();
}


/**
 * Answers a question about an analysis already shown, grounded in the exact
 * same payload. Free text, not JSON — a challenge deserves a sentence, not a
 * schema — so `validate` here is a non-empty check rather than a shape check.
 */
async function handleFollowUp(
  parsed: DsAnalysisInput,
  followUp: Record<string, unknown>
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
  const intervalChecks = computeIntervalChecks(parsed.entries);
  const beltPumpCheck = checkBeltPump(parsed.entries);

  try {
    const { text, costInfo } = await callAI({
      action: "ds-history-followup",
      model: DEFAULT_MODEL,
      prompt: buildFollowUpPrompt({
        input: parsed,
        contractStatus,
        intervalLines: [
          ...formatIntervalChecks(intervalChecks),
          ...formatBeltPumpCheck(beltPumpCheck),
        ],
        // The rules the analysis was judged against, INCLUDING the ones that
        // did not fire — same check objects, not a second computation.
        rulesLines: formatRulesReference(intervalChecks, beltPumpCheck),
        previousAnalysis: followUp.previousAnalysis as DsAnalysis,
        question,
      }),
      systemPrompt: DS_FOLLOWUP_SYSTEM_PROMPT,
      maxTokens: MAX_OUTPUT_TOKENS,
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
