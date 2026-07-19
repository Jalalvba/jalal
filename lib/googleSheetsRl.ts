import { buildPlateVariants } from "@/lib/plateVariants";
import { getSheetsClient, serialToUTCDate, fmtDateOnlySlash } from "@/lib/googleSheetsClient";

// Reads the "RL" tab (véhicule de remplacement / replacement-vehicle data)
// via the authenticated service-account Sheets API — replacing the
// gviz-based public fetch app/api/sheet/route.ts used to make directly.
// Tab name and column list confirmed by a live spreadsheets.values.get()
// read (gid=1827846977, 1000 rows x 26 cols) — not a guess.

const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEETS_ID in .env.local");

const RL_TAB_NAME = "RL";

// The tab has 26 real columns but only these are surfaced — matches the
// original gviz-era RL_COLUMNS allowlist in app/api/sheet/route.ts exactly
// (all 10 names confirmed present verbatim in the live header row).
const RL_COLUMNS = [
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
] as const;

export type RlRow = Record<(typeof RL_COLUMNS)[number], string>;

// "Date" and "Date début" are Sheets date-serial numbers under
// UNFORMATTED_VALUE (confirmed live) — the old gviz endpoint pre-formatted
// these via its own "formatted value" field, which this render option
// doesn't provide, so they're converted explicitly here instead of being
// left as raw numbers like "46222".
const DATE_LIKE_COLUMNS = new Set<(typeof RL_COLUMNS)[number]>(["Date", "Date début"]);

/**
 * Reads every non-empty row from the RL tab, projected down to
 * RL_COLUMNS, optionally filtered to rows where either
 * Immatriculation_a_remplacer or Immatriculation_remplacement matches any
 * WW-prefix/suffix variant of `immFilter` — same OR-match behavior the
 * gviz-era route had. 1,000 rows is cheap enough to read in full and filter
 * server-side in JS, same pattern as lib/googleSheetsBdd.ts.
 */
export async function getRlRows(immFilter?: string): Promise<RlRow[]> {
  const sheets = getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId!,
    range: `'${RL_TAB_NAME}'!A1:Z`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const values = res.data.values ?? [];
  if (values.length === 0) return [];

  const headers = values[0].map((h) => String(h ?? "").trim());
  const colIndexByName = new Map<string, number>();
  headers.forEach((h, i) => {
    if (RL_COLUMNS.includes(h as (typeof RL_COLUMNS)[number])) colIndexByName.set(h, i);
  });

  const rows: RlRow[] = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const isBlank = row.every((c) => c == null || String(c).trim() === "");
    if (isBlank) continue;

    const record = {} as RlRow;
    for (const col of RL_COLUMNS) {
      const idx = colIndexByName.get(col);
      const v = idx != null ? row[idx] : undefined;
      if (v != null && DATE_LIKE_COLUMNS.has(col) && typeof v === "number") {
        record[col] = fmtDateOnlySlash(serialToUTCDate(v));
      } else {
        record[col] = v != null ? String(v) : "";
      }
    }
    rows.push(record);
  }

  if (!immFilter) return rows;

  const variants = new Set(buildPlateVariants(immFilter));
  return rows.filter(
    (r) =>
      variants.has(r["Immatriculation_a_remplacer"]?.trim().toUpperCase() ?? "") ||
      variants.has(r["Immatriculation_remplacement"]?.trim().toUpperCase() ?? "")
  );
}
