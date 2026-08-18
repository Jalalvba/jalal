// Generates email drafts (complaint responses, supplier emails, routine
// notices) via the Gemini API — a second, parallel LLM provider alongside
// this app, not a replacement for anything existing.
//
// Uses Gemini's free tier: DEFAULT_MODEL is pinned to the "-latest" rolling
// alias for the cheapest active Flash-Lite tier (verified live against
// GET /v1beta/models/gemini-flash-lite-latest, not just assumed from
// training data) rather than a dated snapshot like "gemini-2.5-flash-lite",
// which Google has already retired once for this key (404, "no longer
// available"). A rolling alias can silently swap the underlying model
// version over time — acceptable for internal email drafting, but do not
// reuse this alias-over-snapshot choice for anything output-sensitive
// without flagging that tradeoff again. The API key belongs to the "jalal"
// project in Google AI Studio.

import { NextResponse } from "next/server";
import { checkRateLimit, clientIp } from "@/lib/http/rateLimit";
import { callGeminiWithTracking, GeminiCallError } from "@/lib/gemini/costTracker";
import type { GenerateEmailRequest, GenerateEmailResponse } from "@/types";

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_PROMPT_LENGTH = 5000;
const DEFAULT_MODEL = "gemini-flash-lite-latest";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_TOKENS = 400;
const TEMPERATURE = 0.25;
const SYSTEM_INSTRUCTION =
  "You draft short, professional business emails. Output only the email body — no preamble, no commentary.";

// Client-facing messages per failure kind. The wrapper logs the raw upstream
// detail server-side; none of it is echoed to the client.
const ERROR_MESSAGES: Record<GeminiCallError["kind"], string> = {
  unconfigured: "Email generation is not configured",
  "rate-limited": "Email generation is rate-limited upstream. Try again shortly.",
  upstream: "Email generation failed",
  timeout: "Email generation timed out. Try again.",
  "bad-response": "Email generation failed",
};

export async function POST(request: Request): Promise<NextResponse<GenerateEmailResponse>> {
  const { allowed, retryAfterSeconds } = await checkRateLimit(
    "generate-email",
    clientIp(request),
    RATE_LIMIT,
    RATE_WINDOW_MS
  );
  if (!allowed) {
    return NextResponse.json(
      { ok: false, error: `Trop de requêtes. Réessayez dans ${retryAfterSeconds}s.` },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
    );
  }

  let body: GenerateEmailRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const prompt = body.prompt?.trim();
  if (!prompt) {
    return NextResponse.json({ ok: false, error: "prompt is required" }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json(
      { ok: false, error: `prompt exceeds ${MAX_PROMPT_LENGTH} characters` },
      { status: 400 }
    );
  }

  // Model is never a secret and stays client-overridable per the route's
  // contract — only the API key is locked to the server-side env var. Note a
  // client-supplied model with no PRICING entry costs out at 0 (logged loudly
  // by computeCallCost) rather than failing the request.
  const model = body.model?.trim() || DEFAULT_MODEL;
  const tone = body.tone?.trim();
  const fullPrompt = tone ? `Tone: ${tone}\n\n${prompt}` : prompt;

  try {
    // All Gemini access goes through callGeminiWithTracking — never fetch the
    // API directly from a route, or the call escapes cost tracking entirely.
    const { result, costInfo } = await callGeminiWithTracking({
      action: "generate-email",
      model,
      prompt: fullPrompt,
      systemInstruction: SYSTEM_INSTRUCTION,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: TEMPERATURE,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });

    // costInfo is passed straight through so the client gets the cost in the
    // same round trip as the email.
    return NextResponse.json({ ok: true, email: result, costInfo });
  } catch (e) {
    if (e instanceof GeminiCallError) {
      return NextResponse.json({ ok: false, error: ERROR_MESSAGES[e.kind] }, { status: e.status });
    }
    console.error("[generate-email] Unexpected failure:", e);
    return NextResponse.json({ ok: false, error: "Email generation failed" }, { status: 500 });
  }
}
