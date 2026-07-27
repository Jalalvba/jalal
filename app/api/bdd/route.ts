import { NextResponse } from "next/server";
import { getSheetRows } from "@/lib/googleSheetsBdd";
import { toErrorResponse } from "@/lib/apiError";

export async function GET() {
  try {
    const rows = await getSheetRows();
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return toErrorResponse(e, "Failed to read BDD sheet");
  }
}
