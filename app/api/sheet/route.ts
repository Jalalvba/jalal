// app/api/sheet/route.ts
import { NextResponse } from "next/server";

const SPREADSHEET_ID = "1XEUMAqqm0JmA7GPCLHBP4aFKtCYpEEAU0C18i6pNf9Y";

const SHEET_GIDS: Record<string, string> = {
  bdd:    "693758150",
  import: "1699780918",
};

function parseGviz(text: string): Record<string, string>[] {
  // Google wraps response in: google.visualization.Query.setResponse({...});
  const start = text.indexOf("{");
  const end   = text.lastIndexOf("}");
  if (start === -1 || end === -1) return [];

  const json = JSON.parse(text.slice(start, end + 1));
  const table = json.table;
  if (!table?.cols || !table?.rows) return [];

  // Extract header labels
  const headers: string[] = table.cols.map((c: { label: string }) => c.label?.trim() || "");

  // Map each row to an object
  return table.rows
    .map((row: { c: ({ v: unknown; f?: string } | null)[] }) => {
      const obj: Record<string, string> = {};
      row.c?.forEach((cell, i) => {
        if (!headers[i]) return;
        // Use formatted value (f) if available, else raw value (v)
        // gviz returns dates as Date(yyyy,m,d) — prefer f which is the formatted string
        const val = cell?.f ?? cell?.v;
        obj[headers[i]] = val != null ? String(val) : "";
      });
      return obj;
    })
    .filter((row: Record<string, string>) => Object.values(row).some(v => v !== ""));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sheet = searchParams.get("sheet") ?? "bdd";   // bdd | import
  const imm   = searchParams.get("imm")?.trim();

  const gid = SHEET_GIDS[sheet];
  if (!gid) {
    return NextResponse.json({ ok: false, error: "Unknown sheet" }, { status: 400 });
  }

  // Build WW variants for matching
  const buildVariants = (val: string): string[] => {
    const q = val.trim().toUpperCase();
    const variants = [q];
    if (q.endsWith("WW")) { const n = q.slice(0, -2); variants.push("WW" + n, n); }
    if (q.startsWith("WW")) { const n = q.slice(2); variants.push(n + "WW", n); }
    return variants;
  };

  // For Import sheet: push filter to Google via tq param to avoid downloading 8MB
  const immKey = sheet === "bdd" ? "IMM" : "Immatricule";
  // Find column letter for the imm key by fetching headers first — use tq WHERE for Import
  let tqParam = "";
  if (imm && sheet === "import") {
    // Column H is Immatricule (0-indexed col 7)
    const variants = buildVariants(imm);
    const conditions = variants.map(v => `H='${v}'`).join(" or ");
    tqParam = `&tq=${encodeURIComponent(`select * where ${conditions}`)}`;
  }

  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&gid=${gid}${tqParam}`;

  try {
    const res  = await fetch(url, { cache: "no-store" });
    const text = await res.text();
    let rows = parseGviz(text);

    // For BDD sheet: filter client-side (small sheet, 90 rows)
    if (imm && sheet === "bdd") {
      const variants = new Set(buildVariants(imm));
      rows = rows.filter(r => variants.has(r[immKey]?.trim().toUpperCase() ?? ""));
    }

    return NextResponse.json({ ok: true, count: rows.length, items: rows });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Fetch error" },
      { status: 500 }
    );
  }
}
