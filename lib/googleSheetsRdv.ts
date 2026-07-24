import { type sheets_v4 } from "googleapis";
import type { RdvRow, RdvEditableField, RdvAddInput, RdvAddResponse, RdvUpdateResult } from "@/lib/types";
import { RDV_EDITABLE_FIELDS } from "@/lib/types";
import { getSheetsClient, serialToUTCDate, fmtDateOnlySlash, isoDateToSerial } from "@/lib/googleSheetsClient";

// Tab name, gid (2066154497) and the real header row confirmed by a live
// spreadsheets.get()/values.get() read — not a guess. Same spreadsheet as
// PARKING/ATELIER/BDD. Unlike those, RDV has no formula/XLOOKUP columns at
// all: every field is manually typed (a call/appointment log), and rows are
// NOT deduped by plate — the same Matricule legitimately repeats across many
// appointments, so adding always appends a brand-new row.

const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEETS_ID in .env.local");

const RDV_TAB = "RDV";
const DATA_START_ROW = 2;
const HEADER_RANGE_WIDTH = "H"; // 8 real columns, confirmed live, no margin needed

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
    range: `'${RDV_TAB}'!A1:${HEADER_RANGE_WIDTH}1`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const row = res.data.values?.[0] ?? [];
  return row.map((h) => String(h ?? "").trim());
}

function buildColMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((h, i) => {
    if (h) map[h] = i + 1; // 1-based
  });
  return map;
}

async function getRdvSheetProps(sheets: sheets_v4.Sheets): Promise<{ sheetId: number; rowCount: number }> {
  const res = await sheets.spreadsheets.get({
    spreadsheetId: spreadsheetId!,
    fields: "sheets.properties",
  });
  const props = res.data.sheets?.find((s) => s.properties?.title === RDV_TAB)?.properties;
  if (!props || props.sheetId == null) {
    throw new Error(`Sheet tab '${RDV_TAB}' not found`);
  }
  return { sheetId: props.sheetId, rowCount: props.gridProperties?.rowCount ?? 0 };
}

/** Collapses embedded tabs/newlines/repeated spaces to one space — the live
 *  sheet has hand-typed free text with stray tab characters (e.g.
 *  "\tAUDI\tA6"), confirmed on discovery. Purely a display cleanup: it never
 *  writes the collapsed form back unless the field is actually edited. */
function strOrEmpty(row: unknown[], col: number | undefined): string {
  if (!col) return "";
  const v = row[col - 1];
  if (v == null) return "";
  return String(v).trim().replace(/\s+/g, " ");
}

// ─── getRdvRows ────────────────────────────────────────────────────────────

/**
 * Reads every non-empty row (Date column non-blank — this tab has no IMM-like
 * primary key, and Matricule itself can be blank on a real row) from the RDV
 * tab, sorted ascending by date (oldest first), matching Atelier/Parking's
 * sort convention.
 */
export async function getRdvRows(): Promise<RdvRow[]> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId!,
    range: `'${RDV_TAB}'!A1:${HEADER_RANGE_WIDTH}`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const values = res.data.values ?? [];
  if (values.length === 0) return [];

  const headers = values[0].map((h) => String(h ?? "").trim());
  const colMap = buildColMap(headers);
  const dateCol = colMap["Date"] ?? 1;
  const heureCol = colMap["Heure"];
  const clientsCol = colMap["Clients"];
  const vehiculeCol = colMap["Véhicule"];
  const matriculeCol = colMap["Matricule"];
  const interventionCol = colMap["Intervention"];
  const contactCol = colMap["Contact"];
  const convoyeurCol = colMap["CONVOYEUR"];

  const rows: RdvRow[] = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const dateRaw = row[dateCol - 1];
    if (dateRaw == null || dateRaw === "") continue;

    let date = "";
    let rawDate = 0;
    if (typeof dateRaw === "number") {
      const d = serialToUTCDate(dateRaw);
      date = fmtDateOnlySlash(d);
      rawDate = d.getTime();
    } else {
      date = String(dateRaw).trim();
    }

    rows.push({
      rowIndex: i + 1,
      date,
      rawDate,
      heure: strOrEmpty(row, heureCol),
      clients: strOrEmpty(row, clientsCol),
      vehicule: strOrEmpty(row, vehiculeCol),
      matricule: strOrEmpty(row, matriculeCol).toUpperCase(),
      intervention: strOrEmpty(row, interventionCol),
      contact: strOrEmpty(row, contactCol),
      convoyeur: strOrEmpty(row, convoyeurCol),
    });
  }

  rows.sort((a, b) => a.rawDate - b.rawDate);
  return rows;
}

// ─── addRdvRow ─────────────────────────────────────────────────────────────

/**
 * Appends one brand-new appointment row. Reuses the first row with a blank
 * Date column (e.g. one freed by deleteRdvRow()) before growing the sheet —
 * same empty-row-reuse convention as Atelier/Parking's addPlates(), just
 * without any plate-dedup logic since repeats are expected here.
 */
export async function addRdvRow(input: RdvAddInput): Promise<RdvAddResponse> {
  const sheets = getSheetsClient();
  const headers = await getHeaderRow(sheets);
  const colMap = buildColMap(headers);
  const dateCol = colMap["Date"] ?? 1;

  const dataRes = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId!,
    range: `'${RDV_TAB}'!A2:${HEADER_RANGE_WIDTH}`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const dataRows = dataRes.data.values ?? [];

  let targetRow: number | null = null;
  for (let i = 0; i < dataRows.length; i++) {
    const v = dataRows[i][dateCol - 1];
    if (v == null || v === "") {
      targetRow = DATA_START_ROW + i;
      break;
    }
  }

  if (targetRow == null) {
    const props = await getRdvSheetProps(sheets);
    const lastKnownRow = DATA_START_ROW + dataRows.length - 1;
    targetRow = Math.max(props.rowCount, lastKnownRow) + 1;
    if (targetRow > props.rowCount) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: spreadsheetId!,
        requestBody: {
          requests: [{ appendDimension: { sheetId: props.sheetId, dimension: "ROWS", length: targetRow - props.rowCount } }],
        },
      });
    }
  }

  const dateSerial = isoDateToSerial(input.date);
  if (dateSerial == null) {
    return { ok: false, error: `Date invalide: "${input.date}" (attendu yyyy-mm-dd).` };
  }

  const values: Record<string, string | number> = {
    Date: dateSerial,
    Heure: input.heure.trim(),
    Clients: input.clients.trim(),
    "Véhicule": input.vehicule.trim(),
    Matricule: input.matricule.trim().toUpperCase(),
    Intervention: input.intervention.trim(),
    Contact: input.contact.trim(),
    CONVOYEUR: input.convoyeur.trim(),
  };

  const writes: { range: string; values: (string | number)[][] }[] = [];
  for (const [field, value] of Object.entries(values)) {
    const col = colMap[field];
    if (!col) continue;
    writes.push({
      range: `'${RDV_TAB}'!${columnIndexToLetter(col)}${targetRow}`,
      values: [[value]],
    });
  }

  // RAW, not USER_ENTERED: this tab has no formulas to seed (unlike Atelier/
  // Parking), and USER_ENTERED lets Sheets auto-reinterpret pure-digit
  // strings as numbers — silently eating leading zeros on phone numbers in
  // Contact (confirmed live: "0000000000" round-tripped as "0"). Date is
  // written as an already-computed serial number, so RAW stores it correctly
  // too — same convention as lib/googleSheetsBdd.ts's updateSheetRow().
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: spreadsheetId!,
    requestBody: { valueInputOption: "RAW", data: writes },
  });

  return { ok: true, rowIndex: targetRow };
}

// ─── updateRdvField ────────────────────────────────────────────────────────

export async function updateRdvField(rowIndex: number, field: RdvEditableField, value: string): Promise<RdvUpdateResult> {
  if (!RDV_EDITABLE_FIELDS.includes(field)) {
    return { ok: false, error: `Field not editable: ${field}. Editable fields are: ${RDV_EDITABLE_FIELDS.join(", ")}.` };
  }

  const sheets = getSheetsClient();
  const headers = await getHeaderRow(sheets);
  const colMap = buildColMap(headers);
  const fieldCol = colMap[field];
  if (!fieldCol) {
    return { ok: false, error: `Column '${field}' not found in the live '${RDV_TAB}' header row.` };
  }

  let writeValue: string | number = value.trim();
  if (field === "Date") {
    const serial = isoDateToSerial(value);
    if (serial == null) return { ok: false, error: `Date invalide: "${value}" (attendu yyyy-mm-dd).` };
    writeValue = serial;
  } else if (field === "Matricule") {
    writeValue = writeValue.toUpperCase();
  }

  // RAW — see addRdvRow()'s comment: no formulas here, and RAW avoids Sheets
  // reinterpreting digit-only text (e.g. Contact) as a number.
  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId!,
    range: `'${RDV_TAB}'!${columnIndexToLetter(fieldCol)}${rowIndex}`,
    valueInputOption: "RAW",
    requestBody: { values: [[writeValue]] },
  });

  return { ok: true };
}

// ─── deleteRdvRow ──────────────────────────────────────────────────────────

/** Clears all 8 cells for the row, freeing it up for addRdvRow() reuse. */
export async function deleteRdvRow(rowIndex: number): Promise<void> {
  const sheets = getSheetsClient();
  const headers = await getHeaderRow(sheets);
  const colMap = buildColMap(headers);

  const ranges = RDV_EDITABLE_FIELDS.map((field) => colMap[field])
    .filter((col): col is number => Boolean(col))
    .map((col) => `'${RDV_TAB}'!${columnIndexToLetter(col)}${rowIndex}`);

  if (ranges.length === 0) return;

  await sheets.spreadsheets.values.batchClear({
    spreadsheetId: spreadsheetId!,
    requestBody: { ranges },
  });
}
