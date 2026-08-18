import { NextResponse } from "next/server";
import { addRdvRow } from "@/lib/sheets/googleSheetsRdv";
import type { RdvAddInput } from "@/types";
import { rateLimitOrNull } from "@/lib/http/rateLimit";
import { toErrorResponse } from "@/lib/http/apiError";

const REQUIRED_STRING_FIELDS: (keyof RdvAddInput)[] = [
  "date",
  "heure",
  "clients",
  "vehicule",
  "matricule",
  "intervention",
  "contact",
  "convoyeur",
];

export async function POST(req: Request) {
  const limited = await rateLimitOrNull(req, "rdv-add", 30, 60_000);
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

  const record = body as Record<string, unknown>;
  const missing = REQUIRED_STRING_FIELDS.filter((f) => typeof record[f] !== "string");
  if (missing.length > 0) {
    return NextResponse.json(
      { ok: false, error: `Missing or invalid field(s) (must be strings): ${missing.join(", ")}` },
      { status: 400 }
    );
  }

  const input = record as unknown as RdvAddInput;

  try {
    const result = await addRdvRow(input);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e) {
    return toErrorResponse(e, "Failed to add RDV row");
  }
}
