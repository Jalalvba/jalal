import { NextResponse } from "next/server";
import { addRdvRow } from "@/lib/googleSheetsRdv";
import type { RdvAddInput } from "@/lib/types";

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
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to add RDV row" },
      { status: 500 }
    );
  }
}
