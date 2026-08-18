import { NextResponse } from "next/server";
import { getParkingRows } from "@/lib/googleSheetsParking";
import { toErrorResponse } from "@/lib/apiError";

export async function GET() {
  try {
    const rows = await getParkingRows();
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return toErrorResponse(e, "Failed to read PARKING sheet");
  }
}
