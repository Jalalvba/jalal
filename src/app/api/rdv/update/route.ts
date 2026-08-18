import { NextResponse } from "next/server";
import { updateRdvField } from "@/lib/googleSheetsRdv";
import { RDV_EDITABLE_FIELDS, type RdvEditableField, type RdvAddInput } from "@/lib/types";
import { rateLimitOrNull } from "@/lib/rateLimit";
import { toErrorResponse } from "@/lib/apiError";

const REQUIRED_IDENTITY_FIELDS: (keyof RdvAddInput)[] = [
  "date",
  "heure",
  "clients",
  "vehicule",
  "matricule",
  "intervention",
  "contact",
  "convoyeur",
];

function isEditableField(v: unknown): v is RdvEditableField {
  return typeof v === "string" && (RDV_EDITABLE_FIELDS as readonly string[]).includes(v);
}

function isValidIdentity(v: unknown): v is RdvAddInput {
  if (!v || typeof v !== "object") return false;
  const rec = v as Record<string, unknown>;
  return REQUIRED_IDENTITY_FIELDS.every((f) => typeof rec[f] === "string");
}

export async function POST(req: Request) {
  const limited = await rateLimitOrNull(req, "rdv-update", 30, 60_000);
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

  const { identity, field, value } = body as { identity?: unknown; field?: unknown; value?: unknown };

  if (!isValidIdentity(identity)) {
    return NextResponse.json(
      { ok: false, error: `Missing or invalid 'identity' (must include: ${REQUIRED_IDENTITY_FIELDS.join(", ")})` },
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
    const result = await updateRdvField(identity, field, value);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e) {
    return toErrorResponse(e, "Failed to update field");
  }
}
