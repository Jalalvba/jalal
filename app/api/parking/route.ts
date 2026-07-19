import { NextResponse } from "next/server";
import { getParkingRows } from "@/lib/googleSheetsParking";

export async function GET() {
  try {
    const rows = await getParkingRows();
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to read PARKING sheet" },
      { status: 500 }
    );
  }
}
