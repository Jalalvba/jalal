import { buildPlateVariants } from "@/lib/utils/plateVariants";
import { getSheetsClient, serialToUTCDate, fmtDateOnlySlash, fmtDateTime } from "@/lib/googleSheetsClient";

// Reads the "Import" tab (Assistance import events) via the authenticated
// service-account Sheets API. Tab name, column layout, and the fact that
// column H really is "Immatricule" were all confirmed by a live
// spreadsheets.values.get() read (gid=1699780918, 26,381 rows x 12 cols).
//
// 26,381 rows is too large to read in full and filter in JS the way
// lib/googleSheetsBdd.ts / lib/googleSheetsRl.ts do for their much smaller
// tabs. The Sheets API v4 has no WHERE-clause equivalent for values.get (the
// gviz endpoint this route used to hit did, via its own query language) — so
// this does a two-step targeted read instead: (1) scan only column H across
// the whole tab (a single narrow column, ~26K cells) to find matching row
// numbers, then (2) fetch just those rows' full width via a single
// batchGet call. No immFilter, no query — a blanket read of this tab isn't
// supported here on purpose.

const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEETS_ID in .env.local");

const IMPORT_TAB_NAME = "Import";
const IMM_COL_LETTER = "H"; // "Immatricule" — confirmed live, not a guess

const IMPORT_COLUMNS = [
  "Reference dossier",
  "Date Ouverture",
  "Evénement",
  "Souscripteur",
  "Bénéficiaire",
  "N° de tel",
  "Marque Véhicule",
  "Immatricule",
  "Prestation",
  "DatePrestation",
  "Lieu de Destination",
  "Ville de sinistre",
] as const;

export type ImportRow = Record<(typeof IMPORT_COLUMNS)[number], string>;

// "Date Ouverture" is a date-only serial (no fractional part in the sample
// data); "DatePrestation" is a fractional datetime serial. The old gviz
// endpoint pre-formatted both via its "formatted value" field — the
// authenticated API's UNFORMATTED_VALUE doesn't, so both are converted
// explicitly here rather than left as raw numbers. Slash-separated to match
// the DD/MM/YYYY[ HH:mm:ss] shape app/ds-history/page.tsx's own parseDate()
// regex expects.
const DATE_ONLY_COLUMNS = new Set<(typeof IMPORT_COLUMNS)[number]>(["Date Ouverture"]);
const DATE_TIME_COLUMNS = new Set<(typeof IMPORT_COLUMNS)[number]>(["DatePrestation"]);

/**
 * Targeted lookup — requires a plate/WW value, matched via the same
 * WW-prefix/suffix variant rules as bdd/rl (lib/plateVariants.ts). Returns
 * every matching row (a vehicle can have several assistance events), not
 * just the first.
 */
export async function getImportRows(immFilter: string): Promise<ImportRow[]> {
  if (!immFilter.trim()) return [];

  const sheets = getSheetsClient();

  const colRes = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId!,
    range: `'${IMPORT_TAB_NAME}'!${IMM_COL_LETTER}2:${IMM_COL_LETTER}`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const colValues = colRes.data.values ?? [];

  const variants = new Set(buildPlateVariants(immFilter));
  const matchedRowNumbers: number[] = [];
  colValues.forEach((row, i) => {
    const v = row[0];
    if (v != null && variants.has(String(v).trim().toUpperCase())) {
      matchedRowNumbers.push(i + 2); // 0-based index -> 1-based row, +1 for the header row
    }
  });

  if (matchedRowNumbers.length === 0) return [];

  const ranges = matchedRowNumbers.map((r) => `'${IMPORT_TAB_NAME}'!A${r}:L${r}`);
  const batchRes = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: spreadsheetId!,
    ranges,
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const rows: ImportRow[] = [];
  for (const vr of batchRes.data.valueRanges ?? []) {
    const row = vr.values?.[0];
    if (!row) continue;

    const record = {} as ImportRow;
    IMPORT_COLUMNS.forEach((col, idx) => {
      const v = row[idx];
      if (v != null && typeof v === "number" && DATE_ONLY_COLUMNS.has(col)) {
        record[col] = fmtDateOnlySlash(serialToUTCDate(v));
      } else if (v != null && typeof v === "number" && DATE_TIME_COLUMNS.has(col)) {
        record[col] = fmtDateTime(serialToUTCDate(v));
      } else {
        record[col] = v != null ? String(v) : "";
      }
    });
    rows.push(record);
  }

  return rows;
}
