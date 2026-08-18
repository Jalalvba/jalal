import { NextResponse } from "next/server";
import { addBddRow } from "@/lib/sheets/googleSheetsBdd";
import { rateLimitOrNull } from "@/lib/http/rateLimit";
import { toErrorResponse } from "@/lib/http/apiError";

export async function POST(req: Request) {
  const limited = await rateLimitOrNull(req, "bdd-add", 30, 60_000);
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

  const { imm, etat } = body as { imm?: unknown; etat?: unknown };
  if (typeof imm !== "string" || !imm.trim()) {
    return NextResponse.json({ ok: false, error: "Missing or invalid 'imm' (must be a non-empty string)" }, { status: 400 });
  }
  if (typeof etat !== "string" || !etat.trim()) {
    return NextResponse.json({ ok: false, error: "Missing or invalid 'etat' (must be a non-empty string)" }, { status: 400 });
  }

  try {
    const result = await addBddRow(imm, etat);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e) {
    return toErrorResponse(e, "Failed to add BDD row");
  }
}
