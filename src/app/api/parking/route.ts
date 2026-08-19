export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getParkingRows } from "@/lib/sheets/googleSheetsParking";
import { toErrorResponse } from "@/lib/http/apiError";

export async function GET() {
  try {
    const rows = await getParkingRows();
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return toErrorResponse(e, "Failed to read PARKING sheet");
  }
}
