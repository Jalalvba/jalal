// Generates email drafts (complaint responses, supplier emails, routine
// notices) via the Gemini API — a second, parallel LLM provider alongside
// this app's Anthropic integration, not a replacement for it.
//
// Uses Gemini's free tier: only Flash / Flash-Lite models are supported
// without billing enabled (Pro models require a paid Google AI Studio
// account). The API key belongs to the "jalal" project in Google AI Studio.

import { NextResponse } from "next/server";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";
import type { GenerateEmailRequest, GenerateEmailResponse } from "@/lib/types";

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_PROMPT_LENGTH = 5000;
const DEFAULT_MODEL = "gemini-flash-lite-latest";

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
        }),
      }
    );

    if (!geminiResponse.ok) {
      console.error(
        `[generate-email] Gemini API returned ${geminiResponse.status}: ${await geminiResponse.text()}`
      );
      return NextResponse.json(
        { ok: false, error: "Email generation failed" },
        { status: 500 }
      );
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
    console.error("[generate-email] Gemini request failed:", e);
    return NextResponse.json({ ok: false, error: "Email generation failed" }, { status: 500 });
  }
}
