// Reformulates a Suivi RL row's Commentaire via the Gemini API — same
// provider/model/pattern as app/api/generate-email/route.ts (see that
// file's header comment for the DEFAULT_MODEL rationale), just a shorter,
// lower-temperature prompt suited to polishing an existing short comment
// rather than drafting one from scratch. Never writes to the Sheet itself —
// the caller reviews the suggestion and saves it via the existing
// /api/bdd/update path (same as any other manual Commentaire edit).

import { NextResponse } from "next/server";
import { rateLimitOrNull } from "@/lib/rateLimit";
import type { ReformulateCommentRequest } from "@/lib/types";

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_COMMENT_LENGTH = 1000;
const DEFAULT_MODEL = "gemini-flash-lite-latest";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_TOKENS = 150;
const TEMPERATURE = 0.3;
const SYSTEM_INSTRUCTION =
  "Reformulate this French vehicle-fleet comment to be clear, professional, and grammatically correct. Keep it concise. Do not add information not present in the original. Return only the reformulated text, nothing else.";

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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[bdd/reformulate-comment] GEMINI_API_KEY is not set");
    return NextResponse.json(
      { ok: false, error: "Comment reformulation is not configured" },
      { status: 500 }
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: comment }] }],
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
      // See generate-email/route.ts's identical comment: logged server-side
      // only, never returned to the client as-is.
      const rawText = await geminiResponse.text().catch(() => "");
      console.error(`[bdd/reformulate-comment] Gemini API returned ${geminiResponse.status}: ${rawText}`);

      if (geminiResponse.status === 429) {
        return NextResponse.json(
          { ok: false, error: "Reformulation rate-limited en amont. Réessayez dans un instant." },
          { status: 429 }
        );
      }
      if (geminiResponse.status >= 500) {
        return NextResponse.json(
          { ok: false, error: "Service de reformulation temporairement indisponible." },
          { status: 502 }
        );
      }
      return NextResponse.json({ ok: false, error: "Échec de la reformulation" }, { status: 500 });
    }

    const data = await geminiResponse.json();
    const reformulated = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof reformulated !== "string" || !reformulated.trim()) {
      console.error("[bdd/reformulate-comment] Unexpected Gemini response shape:", JSON.stringify(data));
      return NextResponse.json({ ok: false, error: "Échec de la reformulation" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, reformulated: reformulated.trim() });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      console.error(`[bdd/reformulate-comment] Gemini request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      return NextResponse.json({ ok: false, error: "La reformulation a expiré. Réessayez." }, { status: 504 });
    }
    console.error("[bdd/reformulate-comment] Gemini request failed:", e);
    return NextResponse.json({ ok: false, error: "Échec de la reformulation" }, { status: 500 });
  } finally {
    clearTimeout(timeout);
  }
}
