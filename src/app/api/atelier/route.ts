import { NextResponse } from "next/server";
import { getAtelierRows } from "@/lib/googleSheetsAtelier";
import { toErrorResponse } from "@/lib/apiError";

export async function GET() {
  try {
    const rows = await getAtelierRows();
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return toErrorResponse(e, "Failed to read ATELIER sheet");
  }
}
