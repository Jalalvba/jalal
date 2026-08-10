import { NextResponse } from "next/server";
import { getVehicleSuggestionList } from "@/lib/googleSheetsParking";

export async function GET() {
  try {
    const vehicles = await getVehicleSuggestionList();
    return NextResponse.json({ ok: true, vehicles });
  } catch (e) {
    console.error("[vehicle-suggestions] Mongo lookup failed:", e);
    return NextResponse.json({ ok: true, vehicles: [] });
  }
}
