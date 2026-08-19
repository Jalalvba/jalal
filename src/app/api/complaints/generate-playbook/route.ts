// POST /api/complaints/generate-playbook
//
// Phase 1 of the complaint handler: accepts the pasted/uploaded text of real
// complaint email threads, runs the Gemini analysis, stores the resulting
// playbook, and returns it.
//
// ── What is NOT stored ─────────────────────────────────────────────────────
// The raw complaint text never reaches MongoDB. Only derived, paraphrased
// findings plus file metadata (name, size, sha256) are persisted. That is a
// deliberate data-minimisation decision about personal client data, not an
// oversight — the analysis is the durable artefact, the source is not.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The analysis is a single long Gemini call; the platform default of 300s is
// not enough headroom for a large upload at effort "high".
export const maxDuration = 800;

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getCollection } from "@/lib/mongo/client";
import { rateLimitOrNull } from "@/lib/http/rateLimit";
import { toErrorResponse, ApiError } from "@/lib/http/apiError";
import { GeminiCallError } from "@/lib/gemini/costTracker";
import { generateComplaintPlaybook, PlaybookShapeError } from "@/lib/gemini/complaintPlaybook";
import { estimateThreadCount } from "@/lib/gemini/threadCount";
import type {
  GeneratePlaybookRequest,
  GeneratePlaybookResponse,
  StoredComplaintPlaybook,
} from "@/types";

// Far tighter than the app's other LLM routes (30/min on generate-email): one
// call here costs real money and runs for minutes, so the limit is per hour.
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;

const MIN_CONTENT_LENGTH = 200;
const MAX_CONTENT_LENGTH = 400_000; // ~100k tokens, well inside the model's window

/** Client-facing messages per failure kind — upstream detail stays server-side. */
const ERROR_MESSAGES: Record<GeminiCallError["kind"], string> = {
  unconfigured: "L'analyse des réclamations n'est pas configurée",
  "rate-limited": "Le service d'analyse est saturé. Réessayez dans un moment.",
  upstream: "L'analyse a échoué",
  timeout: "L'analyse a expiré. Réessayez avec un fichier plus court.",
  "bad-response": "L'analyse a produit une réponse inexploitable",
};

export async function POST(request: Request): Promise<NextResponse<GeneratePlaybookResponse>> {
  const limited = await rateLimitOrNull(
    request,
    "complaint-playbook",
    RATE_LIMIT,
    RATE_WINDOW_MS
  );
  if (limited) return limited as NextResponse<GeneratePlaybookResponse>;

  try {
    let body: GeneratePlaybookRequest;
    try {
      body = await request.json();
    } catch {
      throw new ApiError("Corps de requête invalide", 400);
    }

    const content = body.content?.trim();
    const filename = body.filename?.trim() || "sans-nom.txt";

    if (!content) throw new ApiError("Aucun contenu à analyser", 400);
    if (content.length < MIN_CONTENT_LENGTH) {
      throw new ApiError(
        `Le fichier est trop court pour être analysé (minimum ${MIN_CONTENT_LENGTH} caractères)`,
        400
      );
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      throw new ApiError(
        `Le fichier dépasse ${MAX_CONTENT_LENGTH.toLocaleString("fr-FR")} caractères. Découpez-le en plusieurs fichiers.`,
        400
      );
    }

    const { playbook, costInfo } = await generateComplaintPlaybook(content);

    const stored: StoredComplaintPlaybook = {
      ...playbook,
      generatedAt: new Date().toISOString(),
      model: costInfo.model,
      source: {
        filename,
        charCount: content.length,
        estimatedThreadCount: estimateThreadCount(content),
        // Identifies a re-run of the same file without retaining the file.
        contentHash: createHash("sha256").update(content).digest("hex"),
      },
    };

    // Storage failure must not lose the analysis the user just paid for: the
    // playbook is still returned, with the failure logged server-side.
    try {
      const col = await getCollection("complaint_playbooks");
      await col.insertOne({ ...stored, createdAt: new Date() });
    } catch (e) {
      console.error("[complaint-playbook] Failed to persist playbook", e);
    }

    return NextResponse.json({ ok: true, playbook: stored, costInfo });
  } catch (e) {
    if (e instanceof GeminiCallError) {
      return NextResponse.json(
        { ok: false, error: ERROR_MESSAGES[e.kind] },
        { status: e.status }
      );
    }
    // Distinct from GeminiCallError's "bad-response" (which is an unusable
    // envelope): here the call succeeded and the model simply did not respect
    // the schema. Gemini's responseSchema is a steer, not a grammar — see
    // src/lib/gemini/complaintPlaybook.ts.
    if (e instanceof PlaybookShapeError) {
      return NextResponse.json(
        { ok: false, error: "L'analyse a produit une réponse inexploitable" },
        { status: 500 }
      );
    }
    return toErrorResponse(e, "L'analyse a échoué", 500) as NextResponse<GeneratePlaybookResponse>;
  }
}
