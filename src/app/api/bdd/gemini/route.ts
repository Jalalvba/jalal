// Saves a DS-History AI analysis summary into the BDD tab's `gemini` column,
// matched on immatriculation.
//
// Split from /api/bdd/update rather than folded into it: that route edits a
// row the user is looking at and takes a client-held `row` index, while this
// one is fired from DS History and from the Parking/Atelier/Depot lists, which
// know a plate and nothing about BDD's layout. The row is resolved server-side
// from the plate, so there is no stale index to guard against — though the
// write still goes through updateSheetRow(), so verifyRowIdentity() runs
// exactly as it does for a manual edit (AGENTS.md rule 3).

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { rateLimitOrNull } from "@/lib/http/rateLimit";
import { writeGeminiSummary } from "@/lib/sheets/googleSheetsBdd";
import { toErrorResponse } from "@/lib/http/apiError";
import { log } from "@/lib/http/logger";

// Matches the other 17 Sheets mutation routes.
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 1000;

// A summary is one short paragraph; the model is capped well below this. The
// limit exists so a malformed client cannot push an unbounded string into a
// spreadsheet cell, not to trim legitimate output.
const MAX_SUMMARY = 4000;

export async function POST(request: Request) {
  const limited = await rateLimitOrNull(request, "bdd-gemini", RATE_LIMIT, RATE_WINDOW_MS);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const imm = typeof b.imm === "string" ? b.imm.trim() : "";
  const summary = typeof b.summary === "string" ? b.summary.trim() : "";

  if (!imm) return NextResponse.json({ ok: false, error: "imm est requis" }, { status: 400 });
  if (!summary) return NextResponse.json({ ok: false, error: "summary est requis" }, { status: 400 });
  if (summary.length > MAX_SUMMARY) {
    return NextResponse.json(
      { ok: false, error: `Résumé trop long (max ${MAX_SUMMARY} caractères)` },
      { status: 400 }
    );
  }

  try {
    const result = await writeGeminiSummary(imm, summary);

    // Not an error: BDD tracks ~101 immobilised vehicles out of ~11,169
    // analysable plates, so "no row" is the common outcome. 200 with a typed
    // reason lets the client say so plainly instead of showing a failure for
    // something that worked exactly as intended.
    if (!result.ok && result.reason === "no-row") {
      return NextResponse.json({ ok: true, saved: false, reason: "no-row", imm });
    }
    if (!result.ok) {
      log("warn", "bdd-gemini", "Write refused", { imm, error: result.error });
      return NextResponse.json({ ok: false, error: result.error }, { status: 409 });
    }

    return NextResponse.json({ ok: true, saved: true, imm, row: result.row });
  } catch (e) {
    return toErrorResponse(e, "Échec de l'enregistrement du résumé");
  }
}
