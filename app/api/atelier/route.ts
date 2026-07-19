import { NextResponse } from "next/server";
import { getAtelierRows } from "@/lib/googleSheetsAtelier";

export async function GET() {
  try {
    const rows = await getAtelierRows();
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to read ATELIER sheet" },
      { status: 500 }
    );
  }
}
