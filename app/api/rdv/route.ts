import { NextResponse } from "next/server";
import { getRdvRows } from "@/lib/googleSheetsRdv";

export async function GET() {
  try {
    const rows = await getRdvRows();
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to read RDV sheet" },
      { status: 500 }
    );
  }
}
