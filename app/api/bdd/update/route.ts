import { NextResponse } from "next/server";
import { updateSheetRow } from "@/lib/googleSheetsBdd";

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

  const { row, updates } = body as { row?: unknown; updates?: unknown };

  if (typeof row !== "number" || !Number.isInteger(row) || row < 2) {
    return NextResponse.json(
      { ok: false, error: "Missing or invalid 'row' (must be an integer >= 2 — row 1 is the header row)" },
      { status: 400 }
    );
  }

  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    return NextResponse.json({ ok: false, error: "Missing or invalid 'updates' (must be an object)" }, { status: 400 });
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
    const result = await updateSheetRow(row, updatesObj as Record<string, string>);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to update BDD sheet" },
      { status: 500 }
    );
  }
}
