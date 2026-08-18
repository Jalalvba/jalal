import { NextResponse } from "next/server";
import { getRdvRows } from "@/lib/sheets/googleSheetsRdv";
import { toErrorResponse } from "@/lib/http/apiError";

export async function GET() {
  try {
    const rows = await getRdvRows();
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return toErrorResponse(e, "Failed to read RDV sheet");
  }
}
