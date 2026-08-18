import { NextResponse } from "next/server";
import { clearDepotAll } from "@/lib/sheets/googleSheetsDepot";
import { rateLimitOrNull } from "@/lib/http/rateLimit";
import { toErrorResponse } from "@/lib/http/apiError";

export async function POST(req: Request) {
  const limited = await rateLimitOrNull(req, "depot-clear", 30, 60_000);
  if (limited) return limited;

  try {
    await clearDepotAll();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e, "Failed to clear DEPOT sheet");
  }
}
