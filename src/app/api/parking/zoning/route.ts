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
    return NextResponse.json({ ok: true, rowIndex, zoning });
  } catch (e) {
    return toErrorResponse(e, "Échec de la mise à jour du zoning");
  }
}
