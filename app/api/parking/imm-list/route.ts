import { NextResponse } from "next/server";
import { getIMMList } from "@/lib/googleSheetsParking";

export async function GET() {
  try {
    const imms = await getIMMList();
    return NextResponse.json({ ok: true, imms });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to read parc plate list" },
      { status: 500 }
    );
  }
}
