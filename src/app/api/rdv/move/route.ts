export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { moveRdvRow } from "@/lib/sheets/googleSheetsRdv";
import type { RdvAddInput } from "@/types";
import { rateLimitOrNull } from "@/lib/http/rateLimit";
import { toErrorResponse } from "@/lib/http/apiError";

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
  const limited = await rateLimitOrNull(req, "rdv-move", 30, 60_000);
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

  const { identity, newDate } = body as { identity?: unknown; newDate?: unknown };

  if (!isValidIdentity(identity)) {
    return NextResponse.json(
      { ok: false, error: `Missing or invalid 'identity' (must include: ${REQUIRED_IDENTITY_FIELDS.join(", ")})` },
      { status: 400 }
    );
  }
  if (typeof newDate !== "string" || !newDate.trim()) {
    return NextResponse.json({ ok: false, error: "Missing or invalid 'newDate' (must be a yyyy-mm-dd string)" }, { status: 400 });
  }

  try {
    const result = await moveRdvRow(identity, newDate);
    // The duplicate outcome is a partial server-side failure (the write
    // landed, the clear didn't), not a bad request — 500, not 400, so it's
    // distinguishable from an ordinary validation/business-rule rejection.
    const status = result.ok ? 200 : result.duplicate ? 500 : 400;
    return NextResponse.json(result, { status });
  } catch (e) {
    return toErrorResponse(e, "Failed to move appointment");
  }
}
