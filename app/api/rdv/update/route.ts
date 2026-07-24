import { NextResponse } from "next/server";
import { updateRdvField } from "@/lib/googleSheetsRdv";
import { RDV_EDITABLE_FIELDS, type RdvEditableField } from "@/lib/types";

function isEditableField(v: unknown): v is RdvEditableField {
  return typeof v === "string" && (RDV_EDITABLE_FIELDS as readonly string[]).includes(v);
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  const { rowIndex, field, value } = body as { rowIndex?: unknown; field?: unknown; value?: unknown };

  if (typeof rowIndex !== "number" || !Number.isInteger(rowIndex) || rowIndex < 2) {
    return NextResponse.json(
      { ok: false, error: "Missing or invalid 'rowIndex' (must be an integer >= 2 — row 1 is the header row)" },
      { status: 400 }
    );
  }
  if (!isEditableField(field)) {
    return NextResponse.json(
      { ok: false, error: `Missing or invalid 'field'. Editable fields are: ${RDV_EDITABLE_FIELDS.join(", ")}.` },
      { status: 400 }
    );
  }
  if (typeof value !== "string") {
    return NextResponse.json({ ok: false, error: "Missing or invalid 'value' (must be a string)" }, { status: 400 });
  }

  try {
    const result = await updateRdvField(rowIndex, field, value);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to update field" },
      { status: 500 }
    );
  }
}
