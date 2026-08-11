import { NextResponse } from "next/server";
import { invalidateDepotRowsCache } from "@/lib/googleSheetsDepot";
import { rateLimitOrNull } from "@/lib/rateLimit";
import { toErrorResponse } from "@/lib/apiError";

// User-triggered hard refresh (ListPageHeader's "Actualiser" button) — busts
// the 15s server-side rows cache so the client's subsequent refetch is
// guaranteed to hit Sheets live instead of possibly serving a stale read.
export async function POST(req: Request) {
  const limited = await rateLimitOrNull(req, "depot-refresh", 30, 60_000);
  if (limited) return limited;

  try {
    invalidateDepotRowsCache();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e, "Failed to refresh DEPOT cache");
  }
}
