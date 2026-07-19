import { NextResponse } from "next/server";
import { deleteAtelierRow } from "@/lib/googleSheetsAtelier";

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

  const { rowIndex } = body as { rowIndex?: unknown };

  if (typeof rowIndex !== "number" || !Number.isInteger(rowIndex) || rowIndex < 2) {
    return NextResponse.json(
      { ok: false, error: "Missing or invalid 'rowIndex' (must be an integer >= 2 — row 1 is the header row)" },
      { status: 400 }
    );
  }

  try {
    await deleteAtelierRow(rowIndex);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to delete row" },
      { status: 500 }
    );
  }
}
