// app/api/sheet/route.ts
import { NextResponse } from "next/server";

const SPREADSHEET_ID = "1XEUMAqqm0JmA7GPCLHBP4aFKtCYpEEAU0C18i6pNf9Y";

const SHEET_GIDS: Record<string, string> = {
  bdd:    "693758150",
  import: "1699780918",
  rl:     "1827846977",
};

const RL_COLUMNS = new Set([
  "Reference",
  "Date",
  "Client",
  "Immatriculation_a_remplacer",
  "Modèle_a_remplacer",
  "Immatriculation_remplacement",
  "Modèle_remplacement",
  "Date début",
  "Motif",
  "Téléphone",
]);

function parseGviz(text: string): Record<string, string>[] {
  const start = text.indexOf("{");
  const end   = text.lastIndexOf("}");
  if (start === -1 || end === -1) return [];
  const json  = JSON.parse(text.slice(start, end + 1));
  const table = json.table;
  if (!table?.cols || !table?.rows) return [];
  const headers: string[] = table.cols.map((c: { label: string }) => c.label?.trim() || "");
  return table.rows
    .map((row: { c: ({ v: unknown; f?: string } | null)[] }) => {
      const obj: Record<string, string> = {};
      row.c?.forEach((cell, i) => {
        if (!headers[i]) return;
        const val = cell?.f ?? cell?.v;
        obj[headers[i]] = val != null ? String(val) : "";
      });
      return obj;
    })
    .filter((row: Record<string, string>) => Object.values(row).some(v => v !== ""));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sheet = searchParams.get("sheet") ?? "bdd";
  const imm   = searchParams.get("imm")?.trim();

  const gid = SHEET_GIDS[sheet];
  if (!gid) {
    return NextResponse.json({ ok: false, error: "Unknown sheet" }, { status: 400 });
  }

  const buildVariants = (val: string): string[] => {
    const q = val.trim().toUpperCase();
    const variants = [q];
    if (q.endsWith("WW")) { const n = q.slice(0, -2); variants.push("WW" + n, n); }
    if (q.startsWith("WW")) { const n = q.slice(2); variants.push(n + "WW", n); }
    return variants;
  };

  let tqParam = "";
  if (imm && sheet === "import") {
    const variants = buildVariants(imm);
    const conditions = variants.map(v => `H='${v}'`).join(" or ");
    tqParam = `&tq=${encodeURIComponent(`select * where ${conditions}`)}`;
  }

  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&gid=${gid}${tqParam}`;

  try {
    const res  = await fetch(url, { cache: "no-store" });
    const text = await res.text();
    let rows = parseGviz(text);

    if (imm && sheet === "bdd") {
      const variants = new Set(buildVariants(imm));
      rows = rows.filter(r => variants.has(r["IMM"]?.trim().toUpperCase() ?? ""));
    }

    if (imm && sheet === "rl") {
      const variants = new Set(buildVariants(imm));
      rows = rows
        .filter(r =>
          variants.has(r["Immatriculation_a_remplacer"]?.trim().toUpperCase() ?? "") ||
          variants.has(r["Immatriculation_remplacement"]?.trim().toUpperCase() ?? "")
        )
        .map(r => {
          const filtered: Record<string, string> = {};
          RL_COLUMNS.forEach(col => { filtered[col] = r[col] ?? ""; });
          return filtered;
        });
    }

    return NextResponse.json({ ok: true, count: rows.length, items: rows });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Fetch error" },
      { status: 500 }
    );
  }
}
