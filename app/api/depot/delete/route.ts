import { NextResponse } from "next/server";
import { deleteDepotRow } from "@/lib/googleSheetsDepot";
import { rateLimitOrNull } from "@/lib/rateLimit";
import { toErrorResponse } from "@/lib/apiError";

export async function POST(req: Request) {
  const limited = await rateLimitOrNull(req, "depot-delete", 30, 60_000);
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

  const { rowIndex, imm } = body as { rowIndex?: unknown; imm?: unknown };

  if (typeof rowIndex !== "number" || !Number.isInteger(rowIndex) || rowIndex < 2) {
    return NextResponse.json(
      { ok: false, error: "Missing or invalid 'rowIndex' (must be an integer >= 2 — row 1 is the header row)" },
      { status: 400 }
    );
  }
  if (typeof imm !== "string" || !imm.trim()) {
    return NextResponse.json({ ok: false, error: "Missing or invalid 'imm' (must be a non-empty string)" }, { status: 400 });
  }

  try {
    await deleteDepotRow(rowIndex, imm);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e, "Failed to delete row");
  }
}
