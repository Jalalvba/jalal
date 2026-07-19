import { NextResponse } from "next/server";
import { clearAll } from "@/lib/googleSheetsParking";

export async function POST() {
  try {
    await clearAll();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to clear PARKING sheet" },
      { status: 500 }
    );
  }
}
