import { NextResponse } from "next/server";
import { clearRdvRow } from "@/lib/sheets/googleSheetsRdv";
import type { RdvAddInput } from "@/types";
import { rateLimitOrNull } from "@/lib/http/rateLimit";
import { toErrorResponse } from "@/lib/http/apiError";

// Renamed from /api/rdv/delete — "delete" was always a misnomer here (this
// clears cell values, it never removes a row) and doubly so now that the
// monthly tab gets the same clear-not-delete treatment (see
// src/lib/sheets/googleSheetsRdv.ts's clearRdvRow()). Body IS the full identity
// snapshot (no separate rowIndex) — every clear re-resolves its target row
// fresh, in both tabs, rather than trusting a row number from an earlier read.

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

function isValidIdentity(v: unknown): v is RdvAddInput {
  if (!v || typeof v !== "object") return false;
  const rec = v as Record<string, unknown>;
  return REQUIRED_IDENTITY_FIELDS.every((f) => typeof rec[f] === "string");
}

export async function POST(req: Request) {
  const limited = await rateLimitOrNull(req, "rdv-clear", 30, 60_000);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isValidIdentity(body)) {
    return NextResponse.json(
      { ok: false, error: `Missing or invalid identity fields (must include: ${REQUIRED_IDENTITY_FIELDS.join(", ")})` },
      { status: 400 }
    );
  }

  try {
    const result = await clearRdvRow(body);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e) {
    return toErrorResponse(e, "Failed to clear appointment");
  }
}
