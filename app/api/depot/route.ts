import { NextResponse } from "next/server";
import { getDepotRows } from "@/lib/googleSheetsDepot";

export async function GET() {
  try {
    const rows = await getDepotRows();
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to read DEPOT sheet" },
      { status: 500 }
    );
  }
}
