export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { updateSheetRow } from "@/lib/sheets/googleSheetsBdd";
import { rateLimitOrNull } from "@/lib/http/rateLimit";
import { toErrorResponse } from "@/lib/http/apiError";

export async function POST(req: Request) {
  const limited = await rateLimitOrNull(req, "bdd-update", 30, 60_000);
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

  const { row, updates, imm } = body as { row?: unknown; updates?: unknown; imm?: unknown };

  if (typeof row !== "number" || !Number.isInteger(row) || row < 2) {
    return NextResponse.json(
      { ok: false, error: "Missing or invalid 'row' (must be an integer >= 2 — row 1 is the header row)" },
      { status: 400 }
    );
  }

  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    return NextResponse.json({ ok: false, error: "Missing or invalid 'updates' (must be an object)" }, { status: 400 });
  }

  if (typeof imm !== "string" || !imm.trim()) {
    return NextResponse.json({ ok: false, error: "Missing or invalid 'imm' (must be a non-empty string)" }, { status: 400 });
  }

  const updatesObj = updates as Record<string, unknown>;
  const nonStringFields = Object.entries(updatesObj)
    .filter(([, v]) => typeof v !== "string")
    .map(([k]) => k);

  if (nonStringFields.length > 0) {
    return NextResponse.json(
      { ok: false, error: `Field value(s) must be strings: ${nonStringFields.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const result = await updateSheetRow(row, updatesObj as Record<string, string>, imm);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e) {
    return toErrorResponse(e, "Failed to update BDD sheet");
  }
}
