export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { invalidateBddRowsCache } from "@/lib/sheets/googleSheetsBdd";
import { invalidateRlReunionRowsCache } from "@/lib/sheets/googleSheetsRl";
import { rateLimitOrNull } from "@/lib/http/rateLimit";
import { toErrorResponse } from "@/lib/http/apiError";

// Shared by Suivi RL's "Actualiser" button and DS History's search/
// re-search — both read the BDD tab, and DS History additionally reads
// RL_reunion alongside it, so both caches are busted together here. getRlRows()
// (the main RL tab) is deliberately never cached — nothing to bust there.
export async function POST(req: Request) {
  const limited = await rateLimitOrNull(req, "bdd-refresh", 30, 60_000);
  if (limited) return limited;

  try {
    invalidateBddRowsCache();
    invalidateRlReunionRowsCache();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e, "Failed to refresh BDD cache");
  }
}
