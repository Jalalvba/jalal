// app/api/sheet/route.ts
import { NextResponse } from "next/server";
import { getSheetRows as getBddRows } from "@/lib/googleSheetsBdd";
import { getRlRows, getRlReunionRows } from "@/lib/googleSheetsRl";
import { getImportRows } from "@/lib/googleSheetsImport";
import { toErrorResponse } from "@/lib/apiError";

// All three sheet targets are served via the authenticated service-account
// Sheets API now (lib/googleSheetsBdd.ts / googleSheetsRl.ts /
// googleSheetsImport.ts) — the spreadsheet's public link-sharing was locked
// down, which broke the gviz-based public fetch this route used to make.

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sheet = searchParams.get("sheet") ?? "bdd";
  const imm   = searchParams.get("imm")?.trim();

  try {
    if (sheet === "bdd") {
      const rows = await getBddRows(imm);
      return NextResponse.json({ ok: true, count: rows.length, items: rows });
    }

    if (sheet === "rl") {
      const rows = await getRlRows(imm);
      return NextResponse.json({ ok: true, count: rows.length, items: rows });
    }

    if (sheet === "rl_reunion") {
      const rows = await getRlReunionRows(imm);
      return NextResponse.json({ ok: true, count: rows.length, items: rows });
    }

    if (sheet === "import") {
      const rows = imm ? await getImportRows(imm) : [];
      return NextResponse.json({ ok: true, count: rows.length, items: rows });
    }

    return NextResponse.json({ ok: false, error: "Unknown sheet" }, { status: 400 });
  } catch (e) {
    return toErrorResponse(e, "Fetch error");
  }
}
