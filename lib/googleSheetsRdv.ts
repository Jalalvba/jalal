import { type sheets_v4 } from "googleapis";
import type { RdvRow, RdvEditableField, RdvAddInput, RdvAddResponse, RdvUpdateResult, RdvClearResult } from "@/lib/types";
import { RDV_EDITABLE_FIELDS } from "@/lib/types";
import {
  getSheetsClient,
  serialToUTCDate,
  fmtDateOnlySlash,
  isoDateToSerial,
  withCache,
  invalidateCache,
  columnIndexToLetter,
} from "@/lib/googleSheetsClient";
import { addAppointmentToMonthlyTab, updateAppointmentInMonthlyTab, clearAppointmentInMonthlyTab } from "@/lib/googleSheetsRdvMonthly";
import { resolveUniqueMatch, EDITABLE_TO_INPUT_KEY, RdvIdentityError } from "@/lib/rdvIdentity";

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

// ─── Identity-based edit/clear ─────────────────────────────────────────────
//
// Never trust a row number from an earlier read here either — even though
// this flat tab's own writes never shift rows (clear leaves a hollow row,
// never a real delete), keeping both tabs on the same "re-resolve fresh by
// content match" discipline is the whole point: a client holding a stale
// row number for one tab but not the other is exactly the bug this closes.

/** Re-resolves the current row for `snapshot`, scanning the whole flat tab (no day-block scoping — this tab has no blocks). */
async function findFlatRowByIdentity(snapshot: RdvAddInput, excludeField?: keyof RdvAddInput): Promise<number> {
  const dateSerial = isoDateToSerial(snapshot.date);
  if (dateSerial == null) throw new Error(`Date invalide: "${snapshot.date}" (attendu yyyy-mm-dd).`);

  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId!,
    range: `'${RDV_TAB}'!A2:${HEADER_RANGE_WIDTH}`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const rows = res.data.values ?? [];

  const candidateRows: unknown[][] = [];
  const rowNumbers: number[] = [];
  rows.forEach((row, i) => {
    if (typeof row[0] === "number" && row[0] === dateSerial) {
      candidateRows.push(row);
      rowNumbers.push(DATA_START_ROW + i);
    }
  });

  const rowNum = resolveUniqueMatch(candidateRows, rowNumbers, snapshot, excludeField, RDV_TAB);
  if (rowNum == null) {
    throw new RdvIdentityError(
      `Ce rendez-vous a changé depuis son chargement (aucune correspondance trouvée dans "${RDV_TAB}") — rechargez la page et réessayez.`,
      "not_found"
    );
  }
  return rowNum;
}

// ─── updateRdvField ────────────────────────────────────────────────────────

/**
 * Two-step write, same order and same partial-failure handling as
 * addRdvRow(): monthly tab (durable source) first — abort with a clean
 * error if it can't be resolved (not found or ambiguous), never touching
 * the flat tab, so the two tabs can't end up disagreeing about which
 * appointment got edited — then the flat mirror, retried once, degrading
 * to a warning rather than a hard failure if it still fails.
 */
export async function updateRdvField(oldSnapshot: RdvAddInput, field: RdvEditableField, value: string): Promise<RdvUpdateResult> {
  if (!RDV_EDITABLE_FIELDS.includes(field)) {
    return { ok: false, error: `Field not editable: ${field}. Editable fields are: ${RDV_EDITABLE_FIELDS.join(", ")}.` };
  }

  const monthlyTab = await updateAppointmentInMonthlyTab(oldSnapshot, field, value);
  if (!monthlyTab.written) {
    return { ok: false, error: monthlyTab.error };
  }

  let flatResult = await tryUpdateFlatTab(oldSnapshot, field, value);
  if ("error" in flatResult) {
    console.error(`[RDV] Flat-tab mirror update failed after monthly-tab update succeeded, retrying once: ${flatResult.error}`);
    flatResult = await tryUpdateFlatTab(oldSnapshot, field, value);
  }

  if ("error" in flatResult) {
    console.error(`[RDV] Flat-tab mirror update failed twice, giving up: ${flatResult.error}`);
    return {
      ok: true,
      monthlyTab,
      flatTab: { written: false },
      warning:
        "Rendez-vous modifié dans le calendrier mensuel, mais la mise à jour du miroir rapide a échoué — il sera synchronisé au prochain \"Synchroniser\" du classeur, ou rechargez la page dans quelques instants.",
    };
  }

  return { ok: true, monthlyTab, flatTab: { written: true } };
}

async function tryUpdateFlatTab(oldSnapshot: RdvAddInput, field: RdvEditableField, value: string): Promise<{ ok: true } | { error: string }> {
  try {
    const row = await findFlatRowByIdentity(oldSnapshot, EDITABLE_TO_INPUT_KEY[field]);

    const sheets = getSheetsClient();
    const headers = await getHeaderRow(sheets);
    const colMap = buildColMap(headers);
    const fieldCol = colMap[field];
    if (!fieldCol) return { error: `Column '${field}' not found in the live '${RDV_TAB}' header row.` };

    let writeValue: string | number = value.trim();
    if (field === "Date") {
      const serial = isoDateToSerial(value);
      if (serial == null) return { error: `Date invalide: "${value}" (attendu yyyy-mm-dd).` };
      writeValue = serial;
    } else if (field === "Matricule") {
      writeValue = writeValue.toUpperCase();
    }

    // RAW — see addRdvRow()'s comment: no formulas here, and RAW avoids Sheets
    // reinterpreting digit-only text (e.g. Contact) as a number.
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId!,
      range: `'${RDV_TAB}'!${columnIndexToLetter(fieldCol)}${row}`,
      valueInputOption: "RAW",
      requestBody: { values: [[writeValue]] },
    });
    invalidateCache(ROWS_CACHE_KEY);

    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── clearRdvRow ───────────────────────────────────────────────────────────

/**
 * Same two-step, monthly-first orchestration as updateRdvField()/addRdvRow().
 * "Clear" (not delete) on purpose in both tabs — this flat tab's clear
 * already wiped all 8 columns including Date/Heure (its own reuse scan in
 * writeToFlatTab() looks for a blank Date), unchanged here; the monthly
 * tab's clear (lib/googleSheetsRdvMonthly.ts) only wipes C:H, matching
 * *that* tab's own empty-slot convention (Date/Heure always pre-filled).
 * Two intentionally different clear behaviors, one per tab.
 */
export async function clearRdvRow(snapshot: RdvAddInput): Promise<RdvClearResult> {
  const monthlyTab = await clearAppointmentInMonthlyTab(snapshot);
  if (!monthlyTab.written) {
    return { ok: false, error: monthlyTab.error };
  }

  let flatResult = await tryClearFlatTab(snapshot);
  if ("error" in flatResult) {
    console.error(`[RDV] Flat-tab mirror clear failed after monthly-tab clear succeeded, retrying once: ${flatResult.error}`);
    flatResult = await tryClearFlatTab(snapshot);
  }

  if ("error" in flatResult) {
    console.error(`[RDV] Flat-tab mirror clear failed twice, giving up: ${flatResult.error}`);
    return {
      ok: true,
      monthlyTab,
      flatTab: { written: false },
      warning:
        "Rendez-vous effacé du calendrier mensuel, mais la mise à jour du miroir rapide a échoué — il sera synchronisé au prochain \"Synchroniser\" du classeur, ou rechargez la page dans quelques instants.",
    };
  }

  return { ok: true, monthlyTab, flatTab: { written: true } };
}

async function tryClearFlatTab(snapshot: RdvAddInput): Promise<{ ok: true } | { error: string }> {
  try {
    const row = await findFlatRowByIdentity(snapshot);

    const sheets = getSheetsClient();
    const headers = await getHeaderRow(sheets);
    const colMap = buildColMap(headers);

    const ranges = RDV_EDITABLE_FIELDS.map((field) => colMap[field])
      .filter((col): col is number => Boolean(col))
      .map((col) => `'${RDV_TAB}'!${columnIndexToLetter(col)}${row}`);

    if (ranges.length > 0) {
      await sheets.spreadsheets.values.batchClear({
        spreadsheetId: spreadsheetId!,
        requestBody: { ranges },
      });
    }
    invalidateCache(ROWS_CACHE_KEY);

    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
