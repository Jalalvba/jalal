// Saves a DS-History AI analysis summary into the `gemini` column of every
// tab that both has one and has a row for the plate — BDD, ATELIER, PARKING.
//
// It fans out rather than writing to BDD alone because BDD is an
// immobilisation tracker (~101 rows against ~11,169 analysable plates), so a
// vehicle sitting in the workshop routinely has NO BDD row. Running the
// analysis from Atelier therefore burned a real Gemini call and then discarded
// the result with a "pas de ligne BDD" warning. The ATELIER and PARKING tabs
// have carried a `gemini` column of their own all along (verified against the
// live header row, 2026-08-21), so the summary now lands where the user was
// standing when they asked for it.
//
// DEPOT has no such column, so a Depot-only plate still falls back to BDD —
// adding the column to that tab is a live-sheet change, not something this
// route should do on its own.
//
// The route path stays /api/bdd/gemini: renaming it would break the three
// client call sites for no behavioural gain, and BDD is still the primary
// target.
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
import { writeAtelierGeminiSummary } from "@/lib/sheets/googleSheetsAtelier";
import { writeParkingGeminiSummary } from "@/lib/sheets/googleSheetsParking";
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
    // All three in parallel, and none is allowed to sink the others: the
    // analysis is already paid for, so a plate present in Atelier but not in
    // BDD must still get its summary stored. Promise.allSettled, not all().
    const [bdd, atelier, parking] = await Promise.allSettled([
      writeGeminiSummary(imm, summary),
      writeAtelierGeminiSummary(imm, summary),
      writeParkingGeminiSummary(imm, summary),
    ]);

    const written: string[] = [];
    const failures: string[] = [];

    for (const [tab, settled] of [
      ["BDD", bdd],
      ["ATELIER", atelier],
      ["PARKING", parking],
    ] as const) {
      if (settled.status === "rejected") {
        log("warn", "bdd-gemini", "Write threw", { imm, tab, error: String(settled.reason) });
        failures.push(tab);
        continue;
      }
      const r = settled.value;
      if (r.ok) {
        written.push(tab);
      } else if (r.reason === "write-failed") {
        log("warn", "bdd-gemini", "Write refused", { imm, tab, error: r.error });
        failures.push(tab);
      }
      // "no-row"/"no-column" are the ordinary outcome for a tab this vehicle
      // is simply not in — not a failure, and not reported as one.
    }

    // Still a 200 when nothing matched: the vehicle is in none of the three
    // tabs, which is a fact about the data, not a fault. The client says so
    // plainly instead of showing an error for something that worked.
    return NextResponse.json({
      ok: true,
      saved: written.length > 0,
      tabs: written,
      failures,
      reason: written.length > 0 ? undefined : "no-row",
      imm,
    });
  } catch (e) {
    return toErrorResponse(e, "Échec de l'enregistrement du résumé");
  }
}
