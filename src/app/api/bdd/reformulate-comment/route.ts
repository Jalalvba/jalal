// Reformulates a Suivi RL row's Commentaire via the Gemini API — same
// provider/model/pattern as src/app/api/generate-email/route.ts (see that
// file's header comment for the DEFAULT_MODEL rationale), just a shorter,
// lower-temperature prompt suited to polishing an existing short comment
// rather than drafting one from scratch. Never writes to the Sheet itself —
// the caller reviews the suggestion and saves it via the existing
// /api/bdd/update path (same as any other manual Commentaire edit).

import { NextResponse } from "next/server";
import { rateLimitOrNull } from "@/lib/http/rateLimit";
import { callGeminiWithTracking, GeminiCallError } from "@/lib/gemini/costTracker";
import type { ReformulateCommentRequest } from "@/types";

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_COMMENT_LENGTH = 1000;
const DEFAULT_MODEL = "gemini-flash-lite-latest";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_TOKENS = 150;
const TEMPERATURE = 0.3;
const SYSTEM_INSTRUCTION =
  "You are reformulating a short internal fleet-maintenance comment (Commentaire) written by a technician, in French. You are given the following context about the vehicle/case:\n" +
  "- Modèle (vehicle model)\n" +
  "- ETAT (current status/state)\n" +
  "- Prestataire (service provider)\n" +
  "- Flag (issue category flag)\n" +
  "- Catégorie (category)\n" +
  "- Technicien (technician name)\n\n" +
  "Use this context ONLY to understand what the comment likely refers to and to reformulate it more clearly and professionally — do NOT restate the context fields in the output, do NOT invent details not present in the original comment, do NOT change the comment's actual meaning. Fix grammar, tighten wording, keep it concise and professional French. If a context field is blank, ignore it. Return only the reformulated Commentaire text, nothing else — no labels, no quotes, no explanation.";

// Builds the user-turn text, omitting any blank/undefined context field
// entirely rather than sending a literal "Modèle=undefined" — the whole
// "Contexte:" line is dropped too if every field is blank. Context values
// come from client-supplied JSON, not a type-checked internal call — a
// BddRow field like modele can be a raw number straight from the Sheet
// (see src/app/suivi-rl/page.tsx's downloadBddPdf comment on the same
// footgun), so this coerces via String() rather than trusting the
// declared `string | undefined` type and calling .trim() directly.
function buildUserTurn(comment: string, context: ReformulateCommentRequest["context"]): string {
  const pairs: [string, unknown][] = [
    ["Modèle", context?.modele],
    ["ETAT", context?.etat],
    ["Prestataire", context?.prestataire],
    ["Flag", context?.flag],
    ["Catégorie", context?.categorie],
    ["Technicien", context?.technicien],
  ];
  const contextLine = pairs
    .map(([k, v]) => [k, String(v ?? "").trim()] as const)
    .filter(([, v]) => v.length > 0)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  return contextLine
    ? `Contexte: ${contextLine}\nCommentaire original: ${comment}`
    : `Commentaire original: ${comment}`;
}

// Client-facing French messages per failure kind. The wrapper logs the raw
// upstream detail server-side; none of it is echoed to the client.
const ERROR_MESSAGES: Record<GeminiCallError["kind"], string> = {
  unconfigured: "La reformulation n'est pas configurée",
  "rate-limited": "Reformulation rate-limitée en amont. Réessayez dans un instant.",
  upstream: "Échec de la reformulation",
  timeout: "La reformulation a expiré. Réessayez.",
  "bad-response": "Échec de la reformulation",
};

// Return type is left unannotated (unlike generate-email's POST) because
// rateLimitOrNull's early return is a NextResponse<unknown>. The response
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
    // All Gemini access goes through callGeminiWithTracking — never fetch the
    // API directly from a route, or the call escapes cost tracking entirely.
    const { result, costInfo } = await callGeminiWithTracking({
      action: "bdd-reformulate",
      model: DEFAULT_MODEL,
      prompt: userTurn,
      systemInstruction: SYSTEM_INSTRUCTION,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: TEMPERATURE,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });

    // costInfo is passed straight through so the client gets the cost in the
    // same round trip as the suggestion.
    return NextResponse.json({ ok: true, reformulated: result, costInfo });
  } catch (e) {
    if (e instanceof GeminiCallError) {
      return NextResponse.json({ ok: false, error: ERROR_MESSAGES[e.kind] }, { status: e.status });
    }
    console.error("[bdd/reformulate-comment] Unexpected failure:", e);
    return NextResponse.json({ ok: false, error: "Échec de la reformulation" }, { status: 500 });
  }
}
