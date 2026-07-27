import { NextResponse } from "next/server";
import { addAtelierPlates } from "@/lib/googleSheetsAtelier";
import { rateLimitOrNull } from "@/lib/rateLimit";
import { toErrorResponse } from "@/lib/apiError";

export async function POST(req: Request) {
  const limited = await rateLimitOrNull(req, "atelier-add", 30, 60_000);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  const { raw } = body as { raw?: unknown };
  if (typeof raw !== "string") {
    return NextResponse.json({ ok: false, error: "Missing or invalid 'raw' (must be a string)" }, { status: 400 });
  }

  try {
    const result = await addAtelierPlates(raw);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e) {
    return toErrorResponse(e, "Failed to add plates");
  }
}
