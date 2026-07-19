import { NextResponse } from "next/server";
import { addPlates } from "@/lib/googleSheetsParking";

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

  const { raw } = body as { raw?: unknown };
  if (typeof raw !== "string") {
    return NextResponse.json({ ok: false, error: "Missing or invalid 'raw' (must be a string)" }, { status: 400 });
  }

  try {
    const result = await addPlates(raw);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to add plates" },
      { status: 500 }
    );
  }
}
