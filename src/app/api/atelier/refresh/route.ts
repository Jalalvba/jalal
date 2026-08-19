export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { invalidateAtelierRowsCache } from "@/lib/sheets/googleSheetsAtelier";
import { rateLimitOrNull } from "@/lib/http/rateLimit";
import { toErrorResponse } from "@/lib/http/apiError";

// User-triggered hard refresh (ListPageHeader's "Actualiser" button) — busts
// the 15s server-side rows cache so the client's subsequent refetch is
// guaranteed to hit Sheets live instead of possibly serving a stale read.
export async function POST(req: Request) {
  const limited = await rateLimitOrNull(req, "atelier-refresh", 30, 60_000);
  if (limited) return limited;

  try {
    invalidateAtelierRowsCache();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e, "Failed to refresh ATELIER cache");
  }
}
