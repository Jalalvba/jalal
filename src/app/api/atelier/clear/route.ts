export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { clearAtelierAll } from "@/lib/sheets/googleSheetsAtelier";
import { rateLimitOrNull } from "@/lib/http/rateLimit";
import { toErrorResponse } from "@/lib/http/apiError";

export async function POST(req: Request) {
  const limited = await rateLimitOrNull(req, "atelier-clear", 30, 60_000);
  if (limited) return limited;

  try {
    await clearAtelierAll();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e, "Failed to clear ATELIER sheet");
  }
}
