// Sets one PARKING row's ZONING cell.
//
// Its own route rather than a field on /api/parking/action: the two columns
// mean different things (where the vehicle goes vs what to do to it), and
// ACTION's write also stamps TIMESTAMP, which a zone change must not.

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { rateLimitOrNull } from "@/lib/http/rateLimit";
import { updateZoning } from "@/lib/sheets/googleSheetsParking";
import { toErrorResponse } from "@/lib/http/apiError";
import { getAllSheetFieldOptions } from "@/lib/mongo/sheetFieldOptions";
import { ZONING_OPTIONS_FALLBACK } from "@/types";
// The work-order route itself, called in-process rather than over HTTP — the
// same shape as /api/parking/analyse calling the DS-history GET handler. Its
// per-plate logic (payload, reuse, guards, ACTION + ZONING writes) stays in one
// place; duplicating any of it here is how the two would drift.
import { POST as runParkingActions } from "@/app/api/parking/actions/route";
import { isFixedRoutingZone } from "@/lib/ai/dsAnalysis/prompt-parking";

/**
 * The caller's headers, minus the ones that describe its body.
 *
 * The rate limiter reads the client IP headers, so an internal call has to
 * carry them or every re-analysis is keyed to the same anonymous bucket.
 */
function forwardedHeaders(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of request.headers) {
    const key = k.toLowerCase();
    if (key === "content-length" || key === "content-type") continue;
    out[key] = v;
  }
  out["content-type"] = "application/json";
  return out;
}

// Matches the other Sheets mutation routes.
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 1000;

export async function POST(request: Request) {
  const limited = await rateLimitOrNull(request, "parking-zoning", RATE_LIMIT, RATE_WINDOW_MS);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const rowIndex = typeof b.rowIndex === "number" ? b.rowIndex : NaN;
  const imm = typeof b.imm === "string" ? b.imm.trim() : "";
  const zoning = typeof b.zoning === "string" ? b.zoning.trim() : "";

  if (!Number.isInteger(rowIndex) || rowIndex < 2) {
    return NextResponse.json({ ok: false, error: "rowIndex invalide" }, { status: 400 });
  }
  if (!imm) return NextResponse.json({ ok: false, error: "imm est requis" }, { status: 400 });

  // Only a value from the configured list, or empty to clear. The dropdown
  // already restricts this, but the column feeds a filter and the work-order
  // rules — a free-text zone would create a bucket nothing else recognises.
  // `?? FALLBACK` is not paranoia: the options payload is cached, and an entry
  // written before ZONING_OPTIONS existed has no such key — which is exactly
  // what happened on the first run of this route (TypeError: cannot read
  // 'includes' of undefined). A newly added option key is absent from every
  // payload already in a cache, server-side or in a browser.
  const allowed = (await getAllSheetFieldOptions()).ZONING_OPTIONS ?? ZONING_OPTIONS_FALLBACK;
  if (zoning && !allowed.includes(zoning)) {
    return NextResponse.json(
      { ok: false, error: `Zoning inconnu : ${zoning}` },
      { status: 400 }
    );
  }

  try {
    await updateZoning(rowIndex, zoning, imm);
  } catch (e) {
    return toErrorResponse(e, "Échec de la mise à jour du zoning");
  }

  // The zone the operator just set decides the work order on its own (prompt
  // rule A0.0), so leaving the old ACTION text beside it is a stale answer to a
  // question that has changed. Nothing else re-triggers analysis — this route
  // used to write the cell and return, and the operator had to remember to
  // click "Générer les actions" again. Measured 2026-08-30: five rows on
  // «visite technique» still carried work orders routing them to
  // DISPONIBLE-A-LIVRER / DEPOT-DISPONIBLE / DEPOT-REMPLACEMENT, produced
  // before the zone was set and never refreshed.
  //
  // ONLY for the fixed-routing zones. Setting DEPOT-DISPONIBLE,
  // DISPONIBLE-A-LIVRER or AVIS-PIERRE-PARENT does not change what the model
  // should conclude — A0.0 explicitly sends those through the full analysis —
  // so a re-run there would spend a model call to reproduce the same answer.
  // Clearing the cell is not a trigger either.
  const reanalyse = isFixedRoutingZone(zoning);
  if (!reanalyse) return NextResponse.json({ ok: true, rowIndex, zoning });

  // Awaited, not detached: there is no waitUntil() here, and a promise left
  // running after the response is not guaranteed to finish on a serverless
  // instance — a re-analysis that silently may or may not happen is worse than
  // one the caller waits for.
  //
  // NEVER fatal. The ZONING write has already succeeded and is the thing the
  // operator asked for; a throttled or failing re-analysis must not report that
  // write as failed. The outcome is reported alongside so the client can say
  // the work order was not refreshed, rather than implying it was.
  let analysis: { ok: boolean; outcome?: string; error?: string };
  try {
    const res = await runParkingActions(
      new Request("http://internal/api/parking/actions", {
        method: "POST",
        // The caller's headers travel with it so the rate limiter keys on the
        // real client, not on an anonymous internal request — minus the entity
        // headers, which describe the ORIGINAL body and would misdescribe this
        // one (a copied content-length truncates the JSON below).
        headers: forwardedHeaders(request),
        body: JSON.stringify({ imms: [imm] }),
      })
    );
    const body = (await res.json()) as { results?: { outcome?: string; error?: string }[] };
    const result = body.results?.[0];
    analysis = res.ok && result?.outcome !== "failed"
      ? { ok: true, outcome: result?.outcome }
      : { ok: false, outcome: result?.outcome, error: result?.error };
  } catch (e) {
    analysis = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json({ ok: true, rowIndex, zoning, analysis });
}
