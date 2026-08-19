export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getCombinedVehicleSuggestionList } from "@/lib/mongo/vehicleSuggestions";

export async function GET() {
  try {
    const vehicles = await getCombinedVehicleSuggestionList();
    return NextResponse.json({ ok: true, vehicles });
  } catch (e) {
    console.error("[vehicle-suggestions] Mongo lookup failed:", e);
    return NextResponse.json({ ok: true, vehicles: [] });
  }
}
