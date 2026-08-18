import { NextResponse } from "next/server";
import { getDepotRows } from "@/lib/sheets/googleSheetsDepot";
import { toErrorResponse } from "@/lib/http/apiError";

export async function GET() {
  try {
    const rows = await getDepotRows();
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return toErrorResponse(e, "Failed to read DEPOT sheet");
  }
}
