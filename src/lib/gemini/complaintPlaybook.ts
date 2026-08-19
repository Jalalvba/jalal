// Complaint-handling playbook generation (Phase 1).
//
// Takes the raw text of one or more real client complaint email threads —
// collected by hand out of Gmail and uploaded through /admin/complaints — and
// asks Gemini to derive a reusable playbook: what kinds of complaint actually
// occur, what clients want, how AVIS actually responded, and what worked.
//
// Phase 1 ends at "produce the playbook". Applying a playbook to a NEW
// incoming complaint is Phase 2 and is deliberately not built or scaffolded
// here.
//
// Prompt text lives in this module rather than in the route, matching how the
// sheet/Mongo modules keep logic out of src/app/api/**, and keeping a ~200-line
// French system prompt out of the shared transport wrapper.
//
// ── Ported from Anthropic on 2026-08-19 ────────────────────────────────────
// This was originally built against claude-opus-5. It was migrated to Gemini
// because this app has a Gemini key and no Anthropic account — a real port,
// not a config swap, because the two structured-output mechanisms differ (see
// PLAYBOOK_RESPONSE_SCHEMA and isPlaybookShape below). The system prompt is
// carried over verbatim; the grounding rules are the load-bearing part and
// were not rewritten for the new provider.

import { callGeminiWithTracking, type CostInfo } from "@/lib/gemini/costTracker";
import type {
  ComplaintPlaybook,
  ComplaintCategory,
  PlaybookConfidence,
  PlaybookEffectivenessVerdict,
} from "@/types";

/**
 * Pinned deliberately: a playbook is only comparable to another one built the
 * same way. "gemini-flash-latest" rather than the app's usual
 * "gemini-flash-lite-latest" — this is a judgement-heavy analysis over a long
 * document, which is what the lite tier is worst at. Note FREE_TIER_LIMITS in
 * costTracker.ts has no entry for this model, so every call here is costed as
 * paid (pessimistic by design; it will log a warning saying so).
 */
const MODEL = "gemini-flash-latest";
const MAX_OUTPUT_TOKENS = 32_000;
/** Low but not zero: this is extraction and judgement, not creative writing. */
const TEMPERATURE = 0.2;
/**
 * Minutes, not the wrapper's 20s default. A 400k-character upload analysed at
 * this depth is nothing like the 150-token reformulation the default was sized
 * for. Stays under the route's own maxDuration.
 */
const TIMEOUT_MS = 600_000;

/** Bumped whenever the schema below changes shape, so stored playbooks stay interpretable. */
export const PLAYBOOK_SCHEMA_VERSION = 1;

// ── Output schema ──────────────────────────────────────────────────────────
// Gemini's responseSchema is an OpenAPI 3.0 subset, NOT JSON Schema. Three
// things the Anthropic version relied on do not exist here:
//   - additionalProperties:false  → unsupported, silently ignored
//   - type: ["string","null"]     → unsupported, expressed as nullable:true
//   - grammar-level strictness    → this is a strong steer, not a guarantee
// That last one is why isPlaybookShape() below exists and is not optional:
// under Anthropic a parse failure was the only realistic failure mode, here a
// well-formed-JSON-but-wrong-shape response is possible and must be caught
// before it reaches Mongo or the UI.
//
// Note there is no verbatim-quote field anywhere: quotes are raw client
// complaint text, and this document is persisted. Everything the model reports
// is a paraphrase or a count. See the storage note in the route.
const PLAYBOOK_RESPONSE_SCHEMA = {
  type: "object",
  required: ["sourceSummary", "categories", "crossCuttingObservations", "notEvidenced"],
  properties: {
    sourceSummary: {
      type: "object",
      required: ["threadsObserved", "dateRangeObserved", "languagesObserved"],
      properties: {
        threadsObserved: { type: "integer" },
        dateRangeObserved: {
          type: "string",
          nullable: true,
          description: "e.g. '2026-03 to 2026-08'. null if the threads carry no dates.",
        },
        languagesObserved: { type: "array", items: { type: "string" } },
      },
    },
    categories: {
      type: "array",
      items: {
        type: "object",
        required: [
          "id",
          "label",
          "description",
          "evidence",
          "avisResponsePattern",
          "effectiveness",
          "recommendedResponse",
          "confidence",
          "unknowns",
        ],
        properties: {
          id: {
            type: "string",
            description: "kebab-case slug, stable identifier, e.g. 'vehicle-mechanical'",
          },
          label: { type: "string" },
          description: { type: "string" },
          evidence: {
            type: "object",
            required: ["threadCount", "clientGoalsObserved"],
            properties: {
              threadCount: { type: "integer" },
              clientGoalsObserved: {
                type: "array",
                items: { type: "string" },
                description: "What the client asked to have resolved, paraphrased.",
              },
            },
          },
          avisResponsePattern: {
            type: "object",
            required: ["tone", "typicalConcessions", "typicalTimeline", "escalationPath", "channel"],
            properties: {
              tone: { type: "string" },
              typicalConcessions: { type: "array", items: { type: "string" } },
              typicalTimeline: { type: "string", nullable: true },
              escalationPath: { type: "string", nullable: true },
              channel: { type: "string" },
            },
          },
          effectiveness: {
            type: "object",
            required: ["verdict", "signals"],
            properties: {
              verdict: {
                type: "string",
                enum: ["effective", "ineffective", "mixed", "not-determinable"],
              },
              signals: {
                type: "array",
                items: { type: "string" },
                description: "What in the thread supports the verdict.",
              },
            },
          },
          recommendedResponse: {
            type: "object",
            required: ["openingMove", "mustInclude", "mustAvoid", "concessionLadder"],
            properties: {
              openingMove: { type: "string" },
              mustInclude: { type: "array", items: { type: "string" } },
              mustAvoid: { type: "array", items: { type: "string" } },
              concessionLadder: {
                type: "array",
                items: { type: "string" },
                description: "Ordered least-to-most costly, as evidenced by the threads.",
              },
            },
          },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          unknowns: { type: "array", items: { type: "string" } },
        },
      },
    },
    crossCuttingObservations: { type: "array", items: { type: "string" } },
    notEvidenced: {
      type: "array",
      items: { type: "string" },
      description: "Things a reader might expect this playbook to cover that the threads do not.",
    },
  },
} as const;

// ── The prompt ─────────────────────────────────────────────────────────────
// The grounding rules are the load-bearing part. A model asked to write a
// "playbook" will happily produce a plausible generic car-rental complaints
// process — which would be worse than useless here, because it would look
// exactly like a real finding. notEvidenced exists so there is somewhere to
// put uncertainty: a model with nowhere to put "I don't know" invents an
// answer instead.
const SYSTEM_PROMPT = `You analyse real client complaint email threads for AVIS Maroc, a vehicle rental company, and derive a reusable complaint-handling playbook from them.

The input is the raw text of one or more email threads, copied out of a mailbox by hand. Formatting is inconsistent: quoting styles vary, threads may be separated only by blank lines or headers, signatures and disclaimers are included, and the text may mix French, Moroccan Darija, Arabic and English.

YOUR TASK
Identify the distinct kinds of complaint actually present, and for each one describe what clients want, how AVIS actually responded, and what the threads show about whether that worked.

GROUNDING RULES — these override everything else:
1. Work ONLY from what is in the uploaded text. Every category, concession, timeline, tone and escalation path you report must be traceable to something actually written in a thread. This applies to dates as well: set "dateRangeObserved" to null unless an actual date appears in the text. Do NOT infer a date range from the current date, from a reservation number, or from anything other than a date literally written in a thread. A null here is a correct answer, not a missing one.
2. Do NOT invent company policies, procedures, SLAs, compensation rules, org structure or escalation paths that the threads do not show. If AVIS's actual policy is not visible in the text, that is a fact to record, not a gap to fill.
3. Derive the categories from the data. Do not map the threads onto a generic taxonomy of car-rental complaints you already know.
4. If the threads only show AVIS's replies and never the outcome, say the effectiveness is "not-determinable". Do not infer success from a polite reply.
5. A category supported by one thread must be marked confidence "low". Reserve "high" for patterns you can see repeat across several threads.
6. Put everything a reader might reasonably expect but the data does not support into "notEvidenced". An empty notEvidenced array on a small sample is itself a warning sign — be honest instead of complete.
7. Never include verbatim client text, client names, email addresses, phone numbers, licence plates, contract numbers, or amounts tied to an identifiable person. Paraphrase. The output is stored; the source text is not.

WRITING THE RECOMMENDATIONS
"recommendedResponse" is the one place you may go slightly beyond pure description — it is advice for handling the NEXT complaint of that category. Base it on what the threads show working. Where the threads show something failing, say so in mustAvoid. Do not invent concessions AVIS has never been observed offering.

Write labels, descriptions and recommendations in French, matching the working language of the app. Keep "id" as a kebab-case ASCII slug.

Reply with a single JSON object conforming to the provided schema. No prose, no markdown fence.`;

// ── Validation ─────────────────────────────────────────────────────────────
// Hand-written rather than pulled from a validation library: the repo has no
// runtime schema validator as a dependency, and adding one for a single call
// site is a worse trade than 60 lines that fail loudly.

const CONFIDENCES: readonly PlaybookConfidence[] = ["high", "medium", "low"];
const VERDICTS: readonly PlaybookEffectivenessVerdict[] = [
  "effective",
  "ineffective",
  "mixed",
  "not-determinable",
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isNullableString(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

function isCategory(v: unknown): v is ComplaintCategory {
  if (!isRecord(v)) return false;
  if (typeof v.id !== "string" || typeof v.label !== "string" || typeof v.description !== "string") {
    return false;
  }

  const ev = v.evidence;
  if (!isRecord(ev)) return false;
  if (typeof ev.threadCount !== "number" || !isStringArray(ev.clientGoalsObserved)) return false;

  const arp = v.avisResponsePattern;
  if (!isRecord(arp)) return false;
  if (typeof arp.tone !== "string" || typeof arp.channel !== "string") return false;
  if (!isStringArray(arp.typicalConcessions)) return false;
  if (!isNullableString(arp.typicalTimeline) || !isNullableString(arp.escalationPath)) return false;

  const eff = v.effectiveness;
  if (!isRecord(eff)) return false;
  if (!VERDICTS.includes(eff.verdict as PlaybookEffectivenessVerdict)) return false;
  if (!isStringArray(eff.signals)) return false;

  const rr = v.recommendedResponse;
  if (!isRecord(rr)) return false;
  if (typeof rr.openingMove !== "string") return false;
  if (!isStringArray(rr.mustInclude) || !isStringArray(rr.mustAvoid)) return false;
  if (!isStringArray(rr.concessionLadder)) return false;

  if (!CONFIDENCES.includes(v.confidence as PlaybookConfidence)) return false;
  if (!isStringArray(v.unknowns)) return false;

  return true;
}

type ModelPlaybook = Omit<ComplaintPlaybook, "schemaVersion">;

/**
 * Full structural check of the model's JSON. Exported for unit testing.
 *
 * Deliberately all-or-nothing: a playbook that is half-valid is not a partial
 * result to salvage, it is evidence the model ignored the schema, and a
 * half-read playbook presented as a finding would be worse than an error.
 */
export function isPlaybookShape(v: unknown): v is ModelPlaybook {
  if (!isRecord(v)) return false;

  const ss = v.sourceSummary;
  if (!isRecord(ss)) return false;
  if (typeof ss.threadsObserved !== "number") return false;
  if (!isNullableString(ss.dateRangeObserved)) return false;
  if (!isStringArray(ss.languagesObserved)) return false;

  if (!Array.isArray(v.categories) || !v.categories.every(isCategory)) return false;
  if (!isStringArray(v.crossCuttingObservations)) return false;
  if (!isStringArray(v.notEvidenced)) return false;

  return true;
}

// ── Date guard ─────────────────────────────────────────────────────────────
// Grounding rule 1 tells the model to leave dateRangeObserved null when the
// threads carry no dates. It does not obey: on a dated-nothing sample it first
// returned "2026-08", and after the rule was tightened to explicitly forbid
// inferring from the current date, it returned today's date instead. Two
// prompt attempts, worse each time — the model appears to have a current-date
// notion no wording reliably suppresses.
//
// So this is enforced in code rather than asked for in the prompt, the same
// "validate, don't trust" stance isPlaybookShape() takes about the schema. A
// fabricated date range is the one field here that looks authoritative while
// being pure invention, which makes it worth being deterministic about.

/** Matches French month names, with or without accents. */
const MONTH_NAMES =
  "janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre";

const DATE_PATTERNS: RegExp[] = [
  // ISO-ish: 2026-08-19, 2026-08, 2026/08/19
  /\b(19|20)\d{2}[-/](0?[1-9]|1[0-2])\b/,
  // Day-first numeric: 19/08/2026, 19-08-26, 19.08.2026
  /\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.]((19|20)?\d{2})\b/,
  // "19 août 2026" / "août 2026" / "le 3 mars"
  new RegExp(`\\b(${MONTH_NAMES})\\b`, "i"),
  // A bare year, but only as a standalone token — avoids matching the 4412 in
  // a reservation number while still catching "en 2026".
  /(?:^|[^\d/-])(19|20)\d{2}(?![\d/-])/,
];

/**
 * Whether the uploaded text contains anything that could honestly be read as a
 * date. Deliberately generous: a false positive merely lets the model's own
 * (then plausibly grounded) date range through, whereas a false negative
 * discards a real one. Exported for unit testing.
 */
export function containsDateLiteral(text: string): boolean {
  return DATE_PATTERNS.some((re) => re.test(text));
}

/**
 * Strips a ```json fence if the model emitted one despite JSON mode. Cheap
 * insurance: JSON mode makes this unlikely, not impossible, and the
 * alternative is failing the whole analysis over three backticks.
 */
function stripFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
}

/**
 * Runs the analysis. Returns the parsed playbook plus the cost of the call.
 *
 * Both a parse failure and a shape failure are surfaced as errors rather than
 * a partial playbook. Under Anthropic's strict json_schema only the former was
 * realistically possible; Gemini's responseSchema does not grammar-guarantee
 * the shape, which is exactly why the second check exists.
 */
export async function generateComplaintPlaybook(
  threadsText: string
): Promise<{ playbook: ComplaintPlaybook; costInfo: CostInfo }> {
  const { result, costInfo } = await callGeminiWithTracking({
    action: "complaint-playbook",
    model: MODEL,
    systemInstruction: SYSTEM_PROMPT,
    prompt: `Voici les fils de réclamation à analyser :\n\n${threadsText}`,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    temperature: TEMPERATURE,
    timeoutMs: TIMEOUT_MS,
    responseMimeType: "application/json",
    responseSchema: PLAYBOOK_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(result));
  } catch (e) {
    console.error("[complaint-playbook] Response was not valid JSON despite JSON mode:", e);
    throw new PlaybookShapeError();
  }

  if (!isPlaybookShape(parsed)) {
    // The response is logged, not the source text — this is model output, and
    // it is the only way to diagnose why the schema was not respected.
    console.error(
      "[complaint-playbook] Response did not match the playbook schema:",
      JSON.stringify(parsed).slice(0, 2000)
    );
    throw new PlaybookShapeError();
  }

  // See containsDateLiteral's comment: the model invents this field on undated
  // input regardless of what the prompt says, so it is overridden here rather
  // than trusted. Logged when it fires, because a discarded range that WAS
  // grounded would mean the detector is too narrow.
  let playbook: ModelPlaybook = parsed;
  if (playbook.sourceSummary.dateRangeObserved !== null && !containsDateLiteral(threadsText)) {
    console.warn(
      `[complaint-playbook] Model reported dateRangeObserved="${playbook.sourceSummary.dateRangeObserved}" ` +
        "but the uploaded text contains no date literal — discarding it as ungrounded."
    );
    playbook = {
      ...playbook,
      sourceSummary: { ...playbook.sourceSummary, dateRangeObserved: null },
    };
  }

  return { playbook: { ...playbook, schemaVersion: PLAYBOOK_SCHEMA_VERSION }, costInfo };
}

/** Thrown when the model's JSON is unparseable or structurally wrong. Mapped to a 500. */
export class PlaybookShapeError extends Error {
  constructor() {
    super("Model response did not match the playbook schema");
    this.name = "PlaybookShapeError";
  }
}
