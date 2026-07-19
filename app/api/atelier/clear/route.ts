import { NextResponse } from "next/server";
import { clearAtelierAll } from "@/lib/googleSheetsAtelier";

export async function POST() {
  try {
    await clearAtelierAll();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to clear ATELIER sheet" },
      { status: 500 }
    );
  }
}
