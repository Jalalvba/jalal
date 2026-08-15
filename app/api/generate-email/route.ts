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
import { checkRateLimit, clientIp } from "@/lib/rateLimit";
import type { GenerateEmailRequest, GenerateEmailResponse } from "@/lib/types";

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_PROMPT_LENGTH = 5000;
const DEFAULT_MODEL = "gemini-flash-lite-latest";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_TOKENS = 400;
const TEMPERATURE = 0.25;
const SYSTEM_INSTRUCTION =
  "You draft short, professional business emails. Output only the email body — no preamble, no commentary.";

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
  // contract — only the API key is locked to the server-side env var below.
  const model = body.model?.trim() || DEFAULT_MODEL;
  const tone = body.tone?.trim();
  const fullPrompt = tone ? `Tone: ${tone}\n\n${prompt}` : prompt;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[generate-email] GEMINI_API_KEY is not set");
    return NextResponse.json(
      { ok: false, error: "Email generation is not configured" },
      { status: 500 }
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: fullPrompt }] }],
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          generationConfig: {
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            temperature: TEMPERATURE,
          },
        }),
        signal: controller.signal,
      }
    );

    if (!geminiResponse.ok) {
      // Logged server-side only for diagnosis — never returned to the
      // client, which only ever sees the sanitized messages below. Gemini
      // error bodies don't carry our key (it's a request header, not
      // response content), but the raw text may carry other detail we
      // don't want to promise as a stable client-facing contract.
      const rawText = await geminiResponse.text().catch(() => "");
      console.error(`[generate-email] Gemini API returned ${geminiResponse.status}: ${rawText}`);

      if (geminiResponse.status === 429) {
        return NextResponse.json(
          { ok: false, error: "Email generation is rate-limited upstream. Try again shortly." },
          { status: 429 }
        );
      }
      if (geminiResponse.status >= 500) {
        return NextResponse.json(
          { ok: false, error: "Email generation service is temporarily unavailable." },
          { status: 502 }
        );
      }
      return NextResponse.json({ ok: false, error: "Email generation failed" }, { status: 500 });
    }

    const data = await geminiResponse.json();
    const email = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof email !== "string" || !email) {
      console.error("[generate-email] Unexpected Gemini response shape:", JSON.stringify(data));
      return NextResponse.json(
        { ok: false, error: "Email generation failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, email });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      console.error(`[generate-email] Gemini request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      return NextResponse.json(
        { ok: false, error: "Email generation timed out. Try again." },
        { status: 504 }
      );
    }
    console.error("[generate-email] Gemini request failed:", e);
    return NextResponse.json({ ok: false, error: "Email generation failed" }, { status: 500 });
  } finally {
    clearTimeout(timeout);
  }
}
