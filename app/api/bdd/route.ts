import { NextResponse } from "next/server";
import { getSheetRows } from "@/lib/googleSheetsBdd";

export async function GET() {
  try {
    const rows = await getSheetRows();
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to read BDD sheet" },
      { status: 500 }
    );
  }
}
