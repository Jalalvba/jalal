export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { clearAll } from "@/lib/sheets/googleSheetsParking";
import { rateLimitOrNull } from "@/lib/http/rateLimit";
import { toErrorResponse } from "@/lib/http/apiError";

export async function POST(req: Request) {
  const limited = await rateLimitOrNull(req, "parking-clear", 30, 60_000);
  if (limited) return limited;

  try {
    await clearAll();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e, "Failed to clear PARKING sheet");
  }
}
