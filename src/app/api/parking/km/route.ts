// Sets one PARKING row's KM cell — the hand-entered odometer.
//
// Its own route rather than a field on /api/parking/action, for the same reason
// /api/parking/zoning is its own: ACTION's write also stamps TIMESTAMP, and
// reading a dashboard is not workshop activity.
//
// Why this column exists at all: the DS-derived odometer (currentKmOf() in
// lib/ai/prompts/maintenanceIntervals.ts) is only as fresh as the last BILLED
// intervention, so a vehicle that has run months without a DS line has a real
// mileage recorded nowhere. This is the escape hatch, and the value written
// here takes priority everywhere via resolveVehicleKm().

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { rateLimitOrNull } from "@/lib/http/rateLimit";
import { updateManualKm } from "@/lib/sheets/googleSheetsParking";
import { toErrorResponse } from "@/lib/http/apiError";

// Matches the other Sheets mutation routes.
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 1000;

export async function POST(request: Request) {
  const limited = await rateLimitOrNull(request, "parking-km", RATE_LIMIT, RATE_WINDOW_MS);
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
  // Accepted as a string because that is what the field sends, and because ""
  // is a meaningful value here — it clears the override rather than being a
  // missing parameter. A number is accepted too so a non-browser caller need
  // not stringify.
  const km =
    typeof b.km === "string" ? b.km.trim() : typeof b.km === "number" ? String(b.km) : null;

  if (!Number.isInteger(rowIndex) || rowIndex < 2) {
    return NextResponse.json({ ok: false, error: "rowIndex invalide" }, { status: 400 });
  }
  if (!imm) return NextResponse.json({ ok: false, error: "imm est requis" }, { status: 400 });
  if (km === null) return NextResponse.json({ ok: false, error: "km est requis" }, { status: 400 });

  // Range-checked here as well as in updateManualKm: this is the boundary that
  // faces the client, and a 400 naming the rule is more useful than a 500 from
  // the Sheets layer. The write still validates independently — it is also
  // reachable from other callers.
  if (km && !/^\d{1,3}(?:[\s,]?\d{3})*$/.test(km)) {
    return NextResponse.json(
      { ok: false, error: "Kilométrage invalide : saisir un nombre entier" },
      { status: 400 }
    );
  }

  try {
    await updateManualKm(rowIndex, km, imm);
    return NextResponse.json({ ok: true, rowIndex, km });
  } catch (e) {
    return toErrorResponse(e, "Échec de la mise à jour du kilométrage");
  }
}
