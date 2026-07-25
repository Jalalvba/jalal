import { NextResponse } from "next/server";
import { clearDepotAll } from "@/lib/googleSheetsDepot";

export async function POST() {
  try {
    await clearDepotAll();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to clear DEPOT sheet" },
      { status: 500 }
    );
  }
}
