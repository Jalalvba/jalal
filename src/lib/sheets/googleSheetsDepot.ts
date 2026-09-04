import { type sheets_v4 } from "googleapis";
import { getIMMListSafe, resolveIMM } from "@/lib/sheets/googleSheetsParking";
import type { DepotRow, ParkingAddResponse, ParkingAddResultItem } from "@/types";
import {
  ROWS_CACHE_TTL_MS,
  columnIndexToLetter,
  fmtDateOnlyDash,
  fmtDateTime,
  getSheetsClient,
  invalidateCache,
  isFormulaTriggerToken,
  nowToSerial,
  requireCol,
  serialToUTCDate,
  verifyRowIdentity,
  withCache,
} from "@/lib/sheets/googleSheetsClient";

const ROWS_CACHE_KEY = "rows:DEPOT";
const HEADERS_CACHE_KEY = "headers:DEPOT";

// Tab name, gid (1365327220), column layout and XLOOKUP formulas confirmed
// by a live spreadsheets.get()/values.get()/FORMULA-render read — not a
// guess, and not just inferred from resemblance to PARKING: this tab is a
// byte-for-byte structural clone (same 15 columns, same 12 XLOOKUP formulas
// verbatim, same manual/read-only split — only ACTION is editable). See
// src/types/index.ts's DepotRow comment for the full column list.
//
// This file originally had only a getDepotPlates() existence-check for the
// zone-badge feature, before this tab got its own full page. That function
// has been superseded by getDepotRows() below (which reads the same IMM
// column plus everything else) — useVehicleZone.ts now checks DEPOT via the
// full rows query, same as it already does for Parking/Atelier/RDV, rather
// than keeping two separate reads of the same tab.

const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEETS_ID in .env.local");

const DEPOT_TAB = "DEPOT";
const DATA_START_ROW = 2;
const HEADER_RANGE_WIDTH = "O"; // 15 real columns, confirmed live

/** Live header row → column-name lookup, never hardcoded indices. */
async function getHeaderRow(sheets: sheets_v4.Sheets): Promise<string[]> {
  return withCache(HEADERS_CACHE_KEY, 5 * 60_000, async () => {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId!,
      range: `'${DEPOT_TAB}'!A1:${HEADER_RANGE_WIDTH}1`,
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    const row = res.data.values?.[0] ?? [];
    return row.map((h) => String(h ?? "").trim().toUpperCase());
  });
}

function buildColMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((h, i) => {
    if (h) map[h] = i + 1; // 1-based
  });
  return map;
}

async function getDepotSheetProps(sheets: sheets_v4.Sheets): Promise<{ sheetId: number; rowCount: number }> {
  const res = await sheets.spreadsheets.get({
    spreadsheetId: spreadsheetId!,
    fields: "sheets.properties",
  });
  const props = res.data.sheets?.find((s) => s.properties?.title === DEPOT_TAB)?.properties;
  if (!props || props.sheetId == null) {
    throw new Error(`Sheet tab '${DEPOT_TAB}' not found`);
  }
  return { sheetId: props.sheetId, rowCount: props.gridProperties?.rowCount ?? 0 };
}

// ─── getDepotRows ──────────────────────────────────────────────────────────

/**
 * Reads every non-empty row (IMM non-blank) from the DEPOT tab, sorted
 * ascending by timestamp (oldest first) — same convention as
 * getParkingRows(), which this is a straight port of given the confirmed
 * identical schema.
 */
/**
 * `fresh` bypasses the 15s cache and reads Sheets live. Used only for the one
 * refetch that follows the user's own mutation — see invalidateCache() in
 * googleSheetsClient.ts for why invalidating the tag is not enough to make
 * that read see the write.
 */
export async function getDepotRows(fresh = false): Promise<DepotRow[]> {
  return withCache(ROWS_CACHE_KEY, ROWS_CACHE_TTL_MS, () => fetchDepotRows(), { bypass: fresh });
}

/** Called by src/app/api/depot/refresh/route.ts — the user-triggered "Actualiser" button's hard refresh, so the next read is guaranteed live instead of waiting out the 15s TTL. */
export function invalidateDepotRowsCache(): void {
  invalidateCache(ROWS_CACHE_KEY);
}

async function fetchDepotRows(): Promise<DepotRow[]> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId!,
    range: `'${DEPOT_TAB}'!A1:${HEADER_RANGE_WIDTH}`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const values = res.data.values ?? [];
  if (values.length === 0) return [];

  const headers = values[0].map((h) => String(h ?? "").trim().toUpperCase());
  const colMap = buildColMap(headers);
  const immCol = requireCol(colMap, "IMM", DEPOT_TAB);
  const actionCol = requireCol(colMap, "ACTION", DEPOT_TAB);
  const marqueCol = requireCol(colMap, "MARQUE", DEPOT_TAB);
  const modelCol = requireCol(colMap, "MODEL", DEPOT_TAB);
  const clientCol = requireCol(colMap, "CLIENT", DEPOT_TAB);
  const tsCol = requireCol(colMap, "TIMESTAMP", DEPOT_TAB);
  const rlReunionCol = colMap["RL_REUNION"];
  const motifCol = colMap["MOTIF"];
  const etatVehiculeCol = colMap["ETAT VÉHICULE"];
  const bddCol = colMap["BDD"];
  const dateDsCol = colMap["DATE_DS"];
  const dsCol = colMap["DS"];
  const partsCol = colMap["PARTS"];
  const techniceinCol = colMap["TECHNICEIN"];
  const founisseurCol = colMap["FOUNISSEUR"];

  const rows: DepotRow[] = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const immRaw = row[immCol - 1];
    const imm = immRaw != null ? String(immRaw).trim().toUpperCase() : "";
    if (!imm) continue;

    const tsRaw = row[tsCol - 1];
    let timestamp = "";
    let rawDate = 0;
    if (typeof tsRaw === "number") {
      const d = serialToUTCDate(tsRaw);
      timestamp = fmtDateTime(d);
      rawDate = d.getTime();
    }

    const strOrEmpty = (col: number | undefined) => {
      if (!col) return "";
      const v = row[col - 1];
      return v != null ? String(v).trim() : "";
    };

    const dateOrEmpty = (col: number | undefined) => {
      if (!col) return "";
      const v = row[col - 1];
      if (v == null || v === "") return "";
      return typeof v === "number" ? fmtDateOnlyDash(serialToUTCDate(v)) : String(v).trim();
    };

    rows.push({
      rowIndex: i + 1,
      imm,
      timestamp,
      rawDate,
      action: strOrEmpty(actionCol),
      marque: strOrEmpty(marqueCol),
      model: strOrEmpty(modelCol),
      client: strOrEmpty(clientCol),
      rlReunion: strOrEmpty(rlReunionCol),
      motif: strOrEmpty(motifCol),
      etatVehicule: strOrEmpty(etatVehiculeCol),
      bdd: strOrEmpty(bddCol),
      dateDs: dateOrEmpty(dateDsCol),
      ds: strOrEmpty(dsCol),
      parts: strOrEmpty(partsCol),
      technicein: strOrEmpty(techniceinCol),
      founisseur: strOrEmpty(founisseurCol),
    });
  }

  rows.sort((a, b) => a.rawDate - b.rawDate);
  return rows;
}

// ─── addDepotPlates ────────────────────────────────────────────────────────

// XLOOKUP formulas, verbatim from a live FORMULA-render read of DEPOT —
// identical to Parking's CFG_PARKING_SHEET.FORMULAS, confirmed not assumed.
const FORMULAS: Record<string, string> = {
  MARQUE: '=XLOOKUP(A{ROW};parc!F:F;parc!D:D;"";0;1)',
  MODEL: '=XLOOKUP(A{ROW};parc!F:F;parc!E:E;"";0;1)',
  CLIENT: '=XLOOKUP(A{ROW};parc!F:F;parc!C:C;"";0;1)',
  RL_REUNION: '=XLOOKUP(A{ROW};RL_reunion!A:A;RL_reunion!B:B;"";0;1)',
  MOTIF: '=XLOOKUP(A{ROW};RL!D:D;RL!S:S;"sans RL";0;1)',
  "ETAT VÉHICULE": '=XLOOKUP(A{ROW};parc!F:F;parc!I:I;"";0;1)',
  BDD: '=XLOOKUP(A{ROW};BDD!A:A;BDD!H:H;"";0;1)',
  DATE_DS: '=XLOOKUP(A{ROW};ds!D:D;ds!A:A;"";0;-1)',
  DS: '=XLOOKUP(A{ROW};ds!D:D;ds!C:C;"";0;-1)',
  PARTS: '=XLOOKUP(A{ROW};ds!D:D;ds!G:G;"";0;-1)',
  TECHNICEIN: '=XLOOKUP(A{ROW};ds!D:D;ds!E:E;"";0;-1)',
  FOUNISSEUR: '=XLOOKUP(A{ROW};ds!D:D;ds!F:F;"";0;-1)',
};

/**
 * Exact same shape/behavior as Parking's addPlates(): resolveIMM() against
 * the Mongo parc plate list, duplicate → bump TIMESTAMP only, new → appended
 * right after the last existing data row (growing the sheet if needed) —
 * empty rows are never reused, since deleteDepotRow() now removes rows
 * outright instead of clearing them, so none exist to reuse. Seeds the new
 * row's formula columns so it isn't blank until some other process
 * re-touches it.
 */
export async function addDepotPlates(rawInput: string): Promise<ParkingAddResponse> {
  const tokens = (rawInput ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "");

  if (tokens.length === 0) {
    return { ok: false, error: "Aucune immatriculation saisie." };
  }

  const sheets = getSheetsClient();
  const headers = await getHeaderRow(sheets);
  const colMap = buildColMap(headers);
  const immCol = requireCol(colMap, "IMM", DEPOT_TAB);
  const tsCol = requireCol(colMap, "TIMESTAMP", DEPOT_TAB);

  const dataRes = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId!,
    range: `'${DEPOT_TAB}'!A2:${HEADER_RANGE_WIDTH}`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const dataRows = dataRes.data.values ?? [];

  const existingSet = new Set<string>();
  const plateToRow = new Map<string, number>();

  dataRows.forEach((row, i) => {
    const rowNum = DATA_START_ROW + i;
    const raw = row[immCol - 1];
    const val = raw != null ? String(raw).trim().toUpperCase() : "";
    if (val) {
      existingSet.add(val);
      plateToRow.set(val, rowNum);
    }
  });

  // Resolved before any grid mutation below: if Mongo is unavailable,
  // getIMMListSafe() degrades to [] instead of throwing mid-mutation and
  // leaving the sheet grown with no data written into the new rows.
  const immList = await getIMMListSafe();

  const needed = tokens.length;
  const nextRows: number[] = [];
  const startNewRow = DATA_START_ROW + dataRows.length;
  const props = await getDepotSheetProps(sheets);
  const gridShortfall = startNewRow + needed - 1 - props.rowCount;
  if (gridShortfall > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: spreadsheetId!,
      requestBody: {
        requests: [{ appendDimension: { sheetId: props.sheetId, dimension: "ROWS", length: gridShortfall } }],
      },
    });
  }
  for (let r = startNewRow; r < startNewRow + needed; r++) nextRows.push(r);

  const results: ParkingAddResultItem[] = [];
  const nowSerial = nowToSerial();
  const writes: { range: string; values: (string | number)[][] }[] = [];
  let nextIdx = 0;

  for (const token of tokens) {
    const resolved = resolveIMM(token, immList) || token.trim().toUpperCase();
    const inParc = immList.includes(resolved);

    // See googleSheetsParking.ts's addPlates() for why this check exists —
    // resolveIMM()'s no-match fallback returns the raw uppercased token
    // verbatim, and the batch write below is USER_ENTERED.
    if (isFormulaTriggerToken(resolved)) {
      results.push({ imm: resolved, status: "rejected", inParc, error: "Caractère de formule non autorisé en première position" });
      continue;
    }

    const duplicate = existingSet.has(resolved);

    if (duplicate) {
      const targetRow = plateToRow.get(resolved)!;
      writes.push({
        range: `'${DEPOT_TAB}'!${columnIndexToLetter(tsCol)}${targetRow}`,
        values: [[nowSerial]],
      });
      results.push({ imm: resolved, status: "updated", inParc });
      continue;
    }

    const targetRow = nextRows[nextIdx++];
    if (targetRow == null) break; // shouldn't happen given the expansion above

    writes.push({
      range: `'${DEPOT_TAB}'!${columnIndexToLetter(immCol)}${targetRow}`,
      values: [[resolved]],
    });
    writes.push({
      range: `'${DEPOT_TAB}'!${columnIndexToLetter(tsCol)}${targetRow}`,
      values: [[nowSerial]],
    });

    for (const [field, template] of Object.entries(FORMULAS)) {
      const col = colMap[field];
      if (!col) continue;
      writes.push({
        range: `'${DEPOT_TAB}'!${columnIndexToLetter(col)}${targetRow}`,
        values: [[template.replace(/\{ROW\}/g, String(targetRow))]],
      });
    }

    existingSet.add(resolved);
    plateToRow.set(resolved, targetRow);
    results.push({ imm: resolved, status: "added", inParc });
  }

  if (writes.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: spreadsheetId!,
      requestBody: { valueInputOption: "USER_ENTERED", data: writes },
    });
    invalidateCache(ROWS_CACHE_KEY);
  }

  return { ok: true, results };
}

// ─── updateDepotAction ─────────────────────────────────────────────────────

export async function updateDepotAction(rowIndex: number, action: string, expectedImm: string): Promise<void> {
  const sheets = getSheetsClient();
  const headers = await getHeaderRow(sheets);
  const colMap = buildColMap(headers);
  const immCol = requireCol(colMap, "IMM", DEPOT_TAB);
  const actionCol = requireCol(colMap, "ACTION", DEPOT_TAB);
  const tsCol = requireCol(colMap, "TIMESTAMP", DEPOT_TAB);

  await verifyRowIdentity(
    sheets,
    spreadsheetId!,
    `'${DEPOT_TAB}'!${columnIndexToLetter(immCol)}${rowIndex}`,
    expectedImm
  );

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: spreadsheetId!,
    requestBody: {
      // RAW, not USER_ENTERED: ACTION is free text and must land exactly as
      // written — see googleSheetsAtelier.ts's writeAtelierGeminiSummary()
      // for the same reasoning on the same class of write.
      valueInputOption: "RAW",
      data: [
        { range: `'${DEPOT_TAB}'!${columnIndexToLetter(actionCol)}${rowIndex}`, values: [[action.trim()]] },
        { range: `'${DEPOT_TAB}'!${columnIndexToLetter(tsCol)}${rowIndex}`, values: [[nowToSerial()]] },
      ],
    },
  });
  invalidateCache(ROWS_CACHE_KEY);
}

// ─── deleteDepotRow ────────────────────────────────────────────────────────

/** Genuinely deletes the row (Sheets "delete row" — DeleteDimensionRequest),
 *  shifting every row below it up by one. Replaces the original's
 *  clear-cells behavior: empty rows are no longer reused by
 *  addDepotPlates(), so there's no reason to leave a hollowed-out row in
 *  place. */
export async function deleteDepotRow(rowIndex: number, expectedImm: string): Promise<void> {
  const sheets = getSheetsClient();
  const headers = await getHeaderRow(sheets);
  const colMap = buildColMap(headers);
  const immCol = requireCol(colMap, "IMM", DEPOT_TAB);

  await verifyRowIdentity(
    sheets,
    spreadsheetId!,
    `'${DEPOT_TAB}'!${columnIndexToLetter(immCol)}${rowIndex}`,
    expectedImm
  );

  const { sheetId } = await getDepotSheetProps(sheets);

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: spreadsheetId!,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: { sheetId, dimension: "ROWS", startIndex: rowIndex - 1, endIndex: rowIndex },
          },
        },
      ],
    },
  });
  invalidateCache(ROWS_CACHE_KEY);
}

// ─── clearDepotAll ─────────────────────────────────────────────────────────

export async function clearDepotAll(): Promise<void> {
  const sheets = getSheetsClient();
  const headers = await getHeaderRow(sheets);
  const colMap = buildColMap(headers);
  const immCol = requireCol(colMap, "IMM", DEPOT_TAB);
  const actionCol = requireCol(colMap, "ACTION", DEPOT_TAB);
  const tsCol = requireCol(colMap, "TIMESTAMP", DEPOT_TAB);

  const props = await getDepotSheetProps(sheets);
  const lastRow = props.rowCount;
  if (lastRow < DATA_START_ROW) return;

  const colRange = (col: number) =>
    `'${DEPOT_TAB}'!${columnIndexToLetter(col)}${DATA_START_ROW}:${columnIndexToLetter(col)}${lastRow}`;

  await sheets.spreadsheets.values.batchClear({
    spreadsheetId: spreadsheetId!,
    requestBody: { ranges: [colRange(immCol), colRange(tsCol), colRange(actionCol)] },
  });
  invalidateCache(ROWS_CACHE_KEY);
}
