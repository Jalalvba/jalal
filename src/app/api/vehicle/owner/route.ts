// One plate's owner, from the spreadsheet's `parc` tab.
//
// Exists because Société lives ONLY there: the Mongo `parc` collection does not
// carry it (~/import maps the column but its COLUMNS_NEEDED keep-list drops it
// before the write), and `locataire` is not a stand-in — it reads "Locafinance"
// for the very plates whose Société is "AVIS". So DS History gets `client` from
// cp/parc through mergeVehicleIdentity() as it always has, and asks this route
// for the one field neither collection can answer.
//
// Read-only, and cheap: googleSheetsParc caches the whole tab, so this is a map
// lookup rather than a Sheets call per request.

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getVehicleOwner } from "@/lib/sheets/googleSheetsParc";
import { toErrorResponse } from "@/lib/http/apiError";

export async function GET(request: Request) {
  const imm = new URL(request.url).searchParams.get("imm")?.trim();
  if (!imm) {
    return NextResponse.json({ ok: false, error: "imm est requis" }, { status: 400 });
  }
  try {
    // null is a fact, not an error: the plate is simply not on the parc tab.
    return NextResponse.json({ ok: true, owner: await getVehicleOwner(imm) });
  } catch (e) {
    return toErrorResponse(e, "Lecture du propriétaire impossible");
  }
}
