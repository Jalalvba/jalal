import { type sheets_v4 } from "googleapis";
import type { RdvRow, RdvEditableField, RdvAddInput, RdvAddResponse, RdvUpdateResult } from "@/lib/types";
import { RDV_EDITABLE_FIELDS } from "@/lib/types";
import {
  getSheetsClient,
  serialToUTCDate,
  fmtDateOnlySlash,
  isoDateToSerial,
  withCache,
  invalidateCache,
} from "@/lib/googleSheetsClient";
import { addAppointmentToMonthlyTab } from "@/lib/googleSheetsRdvMonthly";

const ROWS_CACHE_KEY = "rows:RDV";
const HEADERS_CACHE_KEY = "headers:RDV";

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

/** Fetches the real row-1 header list, cached 5min — headers essentially never change. */
async function getHeaderRow(sheets: sheets_v4.Sheets): Promise<string[]> {
  return withCache(HEADERS_CACHE_KEY, 5 * 60_000, async () => {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId!,
      range: `'${RDV_TAB}'!A1:${HEADER_RANGE_WIDTH}1`,
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    const row = res.data.values?.[0] ?? [];
    return row.map((h) => String(h ?? "").trim());
  });
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
  return withCache(ROWS_CACHE_KEY, 15_000, () => fetchRdvRows());
}

async function fetchRdvRows(): Promise<RdvRow[]> {
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
 * Two-step write, in this order:
 *  1. The monthly appointment-calendar tab (a SEPARATE spreadsheet,
 *     GOOGLE_RDV_SHEETS_ID) — the durable source. An external Apps Script
 *     periodically rebuilds this flat "RDV" tab FROM those monthly tabs, so
 *     anything written only here would be silently destroyed on the next
 *     sync (see lib/googleSheetsRdvMonthly.ts's file header for the full
 *     risk writeup).
 *  2. This flat "RDV" tab — a best-effort fast-read mirror for
 *     getRdvRows()/useVehicleZone. If step 1 fails, nothing is written
 *     anywhere and a clean error is returned. If step 1 succeeds but step 2
 *     fails (after one retry), the durable write is NOT rolled back — the
 *     appointment is safely saved in the calendar, just not yet reflected
 *     in the app's own fast-read cache — and a partial-success response
 *     with a warning is returned instead of a hard failure.
 */
/**
 * writeToFlatTab() can reject (a thrown Google API error), not just resolve
 * with `{ error }` — this normalizes both into the same shape so a Sheets
 * API failure doesn't crash past the partial-success handling below and
 * surface as a raw 500 instead.
 */
async function tryWriteToFlatTab(input: RdvAddInput): Promise<{ rowIndex: number } | { error: string }> {
  try {
    return await writeToFlatTab(input);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function addRdvRow(input: RdvAddInput): Promise<RdvAddResponse> {
  const monthlyTab = await addAppointmentToMonthlyTab(input);
  if (!monthlyTab.written) {
    return { ok: false, error: monthlyTab.error };
  }

  let flatTabResult = await tryWriteToFlatTab(input);
  if ("error" in flatTabResult) {
    console.error(`[RDV] Flat-tab mirror write failed after monthly-tab write succeeded, retrying once: ${flatTabResult.error}`);
    flatTabResult = await tryWriteToFlatTab(input);
  }

  if ("error" in flatTabResult) {
    console.error(`[RDV] Flat-tab mirror write failed twice, giving up: ${flatTabResult.error}`);
    return {
      ok: true,
      monthlyTab,
      flatTab: { written: false },
      warning:
        "Rendez-vous enregistré dans le calendrier mensuel, mais la mise à jour du miroir rapide a échoué — il sera synchronisé au prochain \"Synchroniser\" du classeur, ou rechargez la page dans quelques instants.",
    };
  }

  return { ok: true, rowIndex: flatTabResult.rowIndex, monthlyTab, flatTab: { written: true } };
}

/**
 * Appends one brand-new appointment row to the flat "RDV" tab. Reuses the
 * first row with a blank Date column (e.g. one freed by deleteRdvRow())
 * before growing the sheet — same empty-row-reuse convention as
 * Atelier/Parking's addPlates(), just without any plate-dedup logic since
 * repeats are expected here.
 */
async function writeToFlatTab(input: RdvAddInput): Promise<{ rowIndex: number } | { error: string }> {
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
    return { error: `Date invalide: "${input.date}" (attendu yyyy-mm-dd).` };
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
  invalidateCache(ROWS_CACHE_KEY);

  return { rowIndex: targetRow };
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
  invalidateCache(ROWS_CACHE_KEY);

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
  invalidateCache(ROWS_CACHE_KEY);
}
