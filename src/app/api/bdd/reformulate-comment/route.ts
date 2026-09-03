// Reformulates a Suivi RL row's Commentaire via the Gemini API. Never writes
// to the Sheet itself — the caller reviews the suggestion and saves it via the
// existing /api/bdd/update path (same as any other manual Commentaire edit).
//
// DEFAULT_MODEL is pinned to the "-latest" rolling alias for the cheapest
// active Flash-Lite tier rather than a dated snapshot like
// "gemini-2.5-flash-lite", which Google has already retired once for this key
// (404, "no longer available"). A rolling alias can silently swap the
// underlying model version over time — acceptable here because every
// suggestion is reviewed by a human before it reaches the Sheet, but do not
// reuse this alias-over-snapshot choice for anything output-sensitive without
// flagging that tradeoff again. src/lib/ai/pricing.ts's detectAliasDrift()
// is what makes such a swap visible after the fact. The API
// key belongs to the "jalal" project in Google AI Studio.
//
// This header previously lived in src/app/api/generate-email/route.ts, which
// this route deferred to; that route was deleted as dead code, so the
// rationale was moved here rather than lost with it.

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { rateLimitOrNull } from "@/lib/http/rateLimit";
import { toErrorResponse } from "@/lib/http/apiError";
import { callAI, AiCallError, type AiErrorKind } from "@/lib/ai";
import type { ReformulateCommentRequest } from "@/types";
import { isInHousePrestataire } from "@/lib/utils/prestataire";

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_COMMENT_LENGTH = 1000;
const DEFAULT_MODEL = "gemini-flash-lite-latest";
const REQUEST_TIMEOUT_MS = 20_000;
// Raised from 150 when this prompt stopped being a pure rewrite: a note that
// weaves in up to seven context fields is longer than one that only tightens
// the original wording, and 150 truncated it mid-sentence.
const MAX_OUTPUT_TOKENS = 400;
const TEMPERATURE = 0.3;
const SYSTEM_INSTRUCTION = [
  "You are rewriting a short internal fleet-maintenance note (Commentaire) for AVIS Maroc, in French.",
  "",
  "SOURCE OF TRUTH — this overrides everything else:",
  "1. The 'Commentaire original' is the ROOT of the output. Everything you write must be grounded in it. Never replace it, never drop what it says, never change its meaning.",
  "2. NEVER invent a fact that is not in the Commentaire original or in the context fields you were given. No diagnosis, no cause, no part, no date, no next step that is not already stated.",
  "",
  "ENRICHMENT — only from the context fields actually present in the message:",
  "3. Weave the given context fields into the note so it reads as one continuous French paragraph, not a list and not a set of labelled pairs.",
  "4. The last review meeting's conclusion reaches you ONLY as a line starting with 'Conclusion de la dernière réunion'. When that line is present, it is not a descriptive attribute: it is what has to be acted on, so present it as the outstanding decision or follow-up to carry out, not as a fact to restate.",
  "4b. When that line is ABSENT, no meeting has been recorded for this vehicle. Do not mention a meeting, a 'réunion', a 'réunion N-1', a decision taken or a follow-up agreed — in any wording. In particular, NEVER attribute the Commentaire original to a meeting: the comment is a technician's note, not a meeting outcome, and presenting it as one invents a decision that was never taken. This was a real observed failure, not a hypothetical.",
  "",
  "SILENCE OVER FALSE CONTENT — a field you were not given DOES NOT EXIST for this vehicle:",
  "5. Only the context fields listed in the message exist. Any other field is absent, and absent means it is never mentioned — not its value, and not its name either.",
  "6. For an absent field, write NOTHING about it. No placeholder, no empty label, no 'non spécifié', no 'non renseigné', no 'aucun technicien assigné', no 'à définir', no parentheses left open. Do not point out that anything is missing. The note must read as if that field had never applied to this vehicle.",
  "",
  "IN-HOUSE VS EXTERNAL:",
  "7. When the message says 'Prise en charge: en interne, à notre propre atelier', the work is being done by AVIS's own workshop. Say so — 'pris en charge en interne à l'atelier' or equivalent. NEVER present it as an outside garage, never write 'chez le prestataire', and never name the in-house entity as if it were a provider.",
  "8. Only a line labelled 'Prestataire' names an EXTERNAL garage. If there is no such line, no external provider is involved: do not invent one.",
  "",
  "STYLE:",
  "9. Concise, factual, professional French. Fix grammar and tighten wording. No commercial pitch, no alarmist tone.",
  "10. Return ONLY the rewritten Commentaire text — no labels, no quotes, no explanation, no heading.",
].join("\n");

// Builds the user-turn text, omitting any blank/undefined context field
// entirely rather than sending a literal "Modèle=undefined" — the whole
// "Contexte:" line is dropped too if every field is blank.
//
// This omission IS the "ignore absent fields" rule, enforced structurally
// rather than by asking the model nicely: a blank field never reaches the
// model at all, so there is nothing for it to hedge about, apologise for or
// render as "non spécifié". Rule 6 in SYSTEM_INSTRUCTION is the backstop for
// the case where a field is present but the model wants to editorialise about
// what is missing around it — same discipline as src/lib/ai/prompts/oilGrade.ts,
// where a check that cannot fire is simply absent from the payload rather than
// reported as inconclusive.
//
// Réunion N-1 is labelled in place rather than passed as a bare value: the
// label is what tells the model this line is the last meeting's conclusion to
// act on (rule 4), not another attribute to mention in passing.
//
// Context values come from client-supplied JSON, not a type-checked internal
// call — a BddRow field like modele can be a raw number straight from the
// Sheet (see src/app/suivi-rl/page.tsx's downloadBddPdf comment on the same
// footgun), so this coerces via String() rather than trusting the declared
// `string | undefined` type and calling .trim() directly.
function buildUserTurn(comment: string, context: ReformulateCommentRequest["context"]): string {
  // "Prestataire" labels an EXTERNAL garage only. An in-house value (SCAL and
  // its variants) is never emitted under that label — it becomes the
  // "Prise en charge" line below instead, so the model is never handed the
  // words that produce "chez le prestataire SCAL". Structural, like the
  // blank-field omission above: the wrong framing is not available to it.
  //
  // `flag` is absent from ReformulateCommentContext entirely and must stay
  // absent — an internal triage marker, re-sorted month to month, carrying
  // nothing about the vehicle.
  const inHouse = isInHousePrestataire(context?.prestataire);
  const pairs: [string, unknown][] = [
    ["Modèle", context?.modele],
    ["ETAT", context?.etat],
    ["Prestataire", inHouse ? "" : context?.prestataire],
    ["Catégorie", context?.categorie],
    ["Technicien", context?.technicien],
    ["Délai", context?.delai],
  ];
  const contextLine = pairs
    .map(([k, v]) => [k, String(v ?? "").trim()] as const)
    .filter(([, v]) => v.length > 0)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  const reunion = String(context?.reunionN1 ?? "").trim();

  return [
    contextLine ? `Contexte: ${contextLine}` : "",
    inHouse ? "Prise en charge: en interne, à notre propre atelier" : "",
    reunion ? `Conclusion de la dernière réunion (à suivre): ${reunion}` : "",
    `Commentaire original: ${comment}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// Client-facing French messages per failure kind. The wrapper logs the raw
// upstream detail server-side; none of it is echoed to the client.
const ERROR_MESSAGES: Record<AiErrorKind, string> = {
  unconfigured: "La reformulation n'est pas configurée",
  "rate-limited": "Reformulation rate-limitée en amont. Réessayez dans un instant.",
  upstream: "Échec de la reformulation",
  timeout: "La reformulation a expiré. Réessayez.",
  "bad-response": "Échec de la reformulation",
};

// Return type is left unannotated because rateLimitOrNull's early return is
// a NextResponse<unknown>. The response
// bodies below still conform to ReformulateCommentResponse.
export async function POST(request: Request) {
  const limited = await rateLimitOrNull(request, "bdd-reformulate", RATE_LIMIT, RATE_WINDOW_MS);
  if (limited) return limited;

  let body: ReformulateCommentRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const comment = body.comment?.trim();
  if (!comment) {
    return NextResponse.json({ ok: false, error: "comment is required" }, { status: 400 });
  }
  if (comment.length > MAX_COMMENT_LENGTH) {
    return NextResponse.json(
      { ok: false, error: `comment exceeds ${MAX_COMMENT_LENGTH} characters` },
      { status: 400 }
    );
  }

  const userTurn = buildUserTurn(comment, body.context);

  try {
    // All AI access goes through callAI — never fetch a model API directly
    // from a route, or the call escapes cost tracking entirely.
    const { text, costInfo } = await callAI({
      action: "bdd-reformulate",
      model: DEFAULT_MODEL,
      prompt: userTurn,
      systemPrompt: SYSTEM_INSTRUCTION,
      maxTokens: MAX_OUTPUT_TOKENS,
      temperature: TEMPERATURE,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });

    // costInfo is passed straight through so the client gets the cost in the
    // same round trip as the suggestion.
    return NextResponse.json({ ok: true, reformulated: text, costInfo });
  } catch (e) {
    if (e instanceof AiCallError) {
      return NextResponse.json({ ok: false, error: ERROR_MESSAGES[e.kind] }, { status: e.status });
    }
    // AiCallError is handled above: it carries its own curated French message
    // and status, and is NOT an ApiError, so toErrorResponse would flatten it
    // into a generic 500. Everything past that branch is genuinely unexpected,
    // which is exactly what toErrorResponse is for — it replaces a bare
    // console.error with the structured log the other 45 routes emit.
    return toErrorResponse(e, "Échec de la reformulation");
  }
}
