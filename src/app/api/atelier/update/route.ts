import { NextResponse } from "next/server";
import { updateAtelierField } from "@/lib/googleSheetsAtelier";
import { ATELIER_EDITABLE_FIELDS, type AtelierEditableField } from "@/lib/types";
import { rateLimitOrNull } from "@/lib/rateLimit";
import { toErrorResponse } from "@/lib/apiError";

function isEditableField(v: unknown): v is AtelierEditableField {
  return typeof v === "string" && (ATELIER_EDITABLE_FIELDS as readonly string[]).includes(v);
}

export async function POST(req: Request) {
  const limited = await rateLimitOrNull(req, "atelier-update", 30, 60_000);
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

  const { rowIndex, field, value, imm } = body as { rowIndex?: unknown; field?: unknown; value?: unknown; imm?: unknown };

  if (typeof rowIndex !== "number" || !Number.isInteger(rowIndex) || rowIndex < 2) {
    return NextResponse.json(
      { ok: false, error: "Missing or invalid 'rowIndex' (must be an integer >= 2 — row 1 is the header row)" },
      { status: 400 }
    );
  }
  if (!isEditableField(field)) {
    return NextResponse.json(
      { ok: false, error: `Missing or invalid 'field'. Editable fields are: ${ATELIER_EDITABLE_FIELDS.join(", ")}.` },
      { status: 400 }
    );
  }
  if (typeof value !== "string") {
    return NextResponse.json({ ok: false, error: "Missing or invalid 'value' (must be a string)" }, { status: 400 });
  }
  if (typeof imm !== "string" || !imm.trim()) {
    return NextResponse.json({ ok: false, error: "Missing or invalid 'imm' (must be a non-empty string)" }, { status: 400 });
  }

  try {
    await updateAtelierField(rowIndex, field, value, imm);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e, "Failed to update field");
  }
}
