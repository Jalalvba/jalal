import { type sheets_v4 } from "googleapis";
import { BDD_EDITABLE_FIELDS, type BddRow, type BddUpdateResult } from "@/lib/types";
import { buildPlateVariants } from "@/lib/plateVariants";
import { getSheetsClient, serialToUTCDate, fmtDateOnlySlash } from "@/lib/googleSheetsClient";

const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEETS_ID in .env.local");

// Confirmed by a live spreadsheets.get() call against gid=868042157 — not a guess.
const BDD_TAB_NAME = "BDD";
const editableFieldSet = new Set<string>(BDD_EDITABLE_FIELDS);

// Wide enough that a realistic header row can never be truncated (verified up
// to column BZ during discovery), without hardcoding the sheet's real width.
const HEADER_SCAN_WIDTH = "CZ";

function columnIndexToLetter(oneBasedIndex: number): string {
  let n = oneBasedIndex;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Fetches the real row-1 header list live — never hardcoded, never cached across calls. */
async function getHeaderRow(sheets: sheets_v4.Sheets): Promise<string[]> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId!,
    range: `'${BDD_TAB_NAME}'!A1:${HEADER_SCAN_WIDTH}1`,
  });
  const row = res.data.values?.[0] ?? [];
  return row.map((h) => String(h ?? "").trim());
}

/**
 * A Sheets serial-date number (UNFORMATTED_VALUE render) converted to
 * dd/mm/yyyy — deliberately NOT lib/format.ts's fmtDate, which produces
 * yyyy-mm-dd for the rest of the app; this feature's spec calls for the same
 * dd/mm/yyyy shape the old GAS Date-formatting logic produced. Only applied to
 * columns known to hold dates — mois_restant is also numeric but is a count,
 * not a date, so this is intentionally column-aware rather than "any number
 * looks like a date."
 */
const DATE_LIKE_HEADERS = new Set(["date", "date_ds", "date_fin_contrat"]);

function formatCellValue(header: string, raw: unknown): string | number {
  if (raw == null) return "";
  if (DATE_LIKE_HEADERS.has(header) && typeof raw === "number") {
    return fmtDateOnlySlash(serialToUTCDate(raw));
  }
  // Everything else (including mois_restant's real number, and dates that are
  // already plain dd/mm/yyyy text in the sheet) passes through as-is.
  return raw as string | number;
}

/**
 * Reads every non-empty row (first column non-blank) from the BDD tab, keyed
 * by whatever the live header row actually says — not a hardcoded field list.
 *
 * `immFilter`, when given, restricts the result to rows whose IMM column
 * matches any WW-prefix/suffix variant of the given value (see
 * lib/plateVariants.ts) — pushed down here so callers that only need one
 * plate's rows (e.g. app/api/sheet's bdd branch) don't fetch the whole tab
 * and filter redundantly on top.
 */
export async function getSheetRows(immFilter?: string): Promise<BddRow[]> {
  const sheets = getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId!,
    range: `'${BDD_TAB_NAME}'!A1:${HEADER_SCAN_WIDTH}`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const values = res.data.values ?? [];
  if (values.length === 0) return [];

  const headers = values[0].map((h) => String(h ?? "").trim());
  const variants = immFilter ? new Set(buildPlateVariants(immFilter)) : null;
  const rows: BddRow[] = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const firstCell = row[0];
    if (firstCell == null || String(firstCell).trim() === "") continue;
    if (variants && !variants.has(String(firstCell).trim().toUpperCase())) continue;

    const record: Record<string, string | number> = {};
    headers.forEach((header, colIdx) => {
      if (!header) return; // unnamed trailing columns (e.g. W-AB on this sheet)
      record[header] = formatCellValue(header, row[colIdx]);
    });
    record._row = i + 1; // absolute 1-based sheet row, for writeback targeting

    rows.push(record as unknown as BddRow);
  }

  return rows;
}

/**
 * Writes `updates` to the given sheet row. Only fields in BDD_EDITABLE_FIELDS
 * are ever accepted — anything else is rejected outright (the whole call
 * fails, nothing partial-writes), and the rejected field names are returned
 * so the caller gets an honest answer instead of a silent no-op.
 */
export async function updateSheetRow(
  row: number,
  updates: Record<string, string>
): Promise<BddUpdateResult> {
  const requestedFields = Object.keys(updates);

  if (requestedFields.length === 0) {
    return { ok: false, error: "No fields provided to update.", rejectedFields: [] };
  }

  const notEditable = requestedFields.filter((f) => !editableFieldSet.has(f));
  if (notEditable.length > 0) {
    return {
      ok: false,
      error: `Field(s) not editable: ${notEditable.join(", ")}. Editable fields are: ${BDD_EDITABLE_FIELDS.join(", ")}.`,
      rejectedFields: notEditable,
    };
  }

  const sheets = getSheetsClient();
  const headers = await getHeaderRow(sheets);

  // Belt-and-suspenders: even though these fields passed the allowlist check,
  // re-verify against the *live* header row in case the sheet's structure has
  // since drifted (column renamed/removed) since BDD_EDITABLE_FIELDS was set.
  const missingFromSheet = requestedFields.filter((f) => !headers.includes(f));
  if (missingFromSheet.length > 0) {
    return {
      ok: false,
      error: `Field(s) not found in the live sheet header row (sheet structure may have changed): ${missingFromSheet.join(", ")}.`,
      rejectedFields: missingFromSheet,
    };
  }

  await Promise.all(
    requestedFields.map((field) => {
      const colIdx = headers.indexOf(field); // 0-based
      const colLetter = columnIndexToLetter(colIdx + 1);
      return sheets.spreadsheets.values.update({
        spreadsheetId: spreadsheetId!,
        range: `'${BDD_TAB_NAME}'!${colLetter}${row}`,
        valueInputOption: "RAW",
        requestBody: { values: [[updates[field]]] },
      });
    })
  );

  return { ok: true, written: requestedFields };
}
