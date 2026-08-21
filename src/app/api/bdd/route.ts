export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getSheetRows } from "@/lib/sheets/googleSheetsBdd";
import { toErrorResponse } from "@/lib/http/apiError";

// `?fresh=1` bypasses the 15s server-side cache. The client sends it on the
// single refetch that follows its own mutation, because revalidateTag is
// stale-while-revalidate and would otherwise serve the pre-write rows back —
// see invalidateCache() in src/lib/sheets/googleSheetsClient.ts.
export async function GET(request: Request) {
  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  try {
    const rows = await getSheetRows(undefined, fresh);
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return toErrorResponse(e, "Failed to read BDD sheet");
  }
}
