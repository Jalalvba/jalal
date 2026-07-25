import { NextResponse } from "next/server";
import { getDepotPlates } from "@/lib/googleSheetsDepot";

export async function GET() {
  try {
    const plates = await getDepotPlates();
    return NextResponse.json({ ok: true, plates });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to read DEPOT plate list" },
      { status: 500 }
    );
  }
}
