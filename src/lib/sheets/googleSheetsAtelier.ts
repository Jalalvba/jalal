import { type sheets_v4 } from "googleapis";
import { getIMMListSafe, resolveIMM } from "@/lib/sheets/googleSheetsParking";
import type {
  AtelierRow,
  AtelierEditableField,
  ParkingAddResponse,
  ParkingAddResultItem,
} from "@/types";
import { ATELIER_EDITABLE_FIELDS } from "@/types";
import {
  ROWS_CACHE_TTL_MS,
  columnIndexToLetter,
  fmtDateOnlyDash,
  fmtDateTime,
  getSheetsClient,
  invalidateCache,
  nowToSerial,
  serialToUTCDate,
  verifyRowIdentity,
  withCache,
} from "@/lib/sheets/googleSheetsClient";

const ROWS_CACHE_KEY = "rows:ATELIER";
const HEADERS_CACHE_KEY = "headers:ATELIER";

// Ported from the AVIS Maroc GAS "Atelier" system (code.gs + RebuildAtelier.gs).
// Same spreadsheet as PARKING/BDD (TARGET_SHEET_ID in the source matches this
// app's GOOGLE_SHEETS_ID — confirmed, not a guess). Tab name and the fact that
// its live column *order* drifts from the reference source are both confirmed
// by a live spreadsheets.values.get() read.

const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEETS_ID in .env.local");

const ATELIER_TAB = "ATELIER";
const DATA_START_ROW = 2;
// Must cover the LAST real column, not just the ones this module maps: a
// column outside this range is invisible to buildColMap(), and every lookup
// for it silently returns undefined rather than failing. That is exactly how
// the AI summary write went missing — the live header row is 21 columns
// (…PARKING=S, DEPOT=T, gemini=U, read 2026-08-21) while this said "S", so
// writeAtelierGeminiSummary() reported "no-column" and the route skipped it
// as an ordinary non-match. Widen this whenever a column is added to the tab.
const HEADER_RANGE_WIDTH = "X"; // 21 real columns through `gemini` (U), margin to X

async function getHeaderRow(sheets: sheets_v4.Sheets, fresh = false): Promise<string[]> {
  return withCache(HEADERS_CACHE_KEY, 5 * 60_000, async () => {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId!,
      range: `'${ATELIER_TAB}'!A1:${HEADER_RANGE_WIDTH}1`,
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    const row = res.data.values?.[0] ?? [];
    return row.map((h) => String(h ?? "").trim().toUpperCase());
  }, { bypass: fresh });
}

function buildColMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((h, i) => {
    if (h) map[h] = i + 1; // 1-based
  });
  return map;
}

async function getAtelierSheetProps(
  sheets: sheets_v4.Sheets
): Promise<{ sheetId: number; rowCount: number }> {
  const res = await sheets.spreadsheets.get({
    spreadsheetId: spreadsheetId!,
    fields: "sheets.properties",
  });
  const props = res.data.sheets?.find((s) => s.properties?.title === ATELIER_TAB)?.properties;
  if (!props || props.sheetId == null) {
    throw new Error(`Sheet tab '${ATELIER_TAB}' not found`);
  }
  return { sheetId: props.sheetId, rowCount: props.gridProperties?.rowCount ?? 0 };
}


// ─── getParkingList (ported as getAtelierRows) ────────────────────────────

/**
 * Named fields, same live column-map pattern as getParkingRows() — including
 * the 9 read-only XLOOKUP columns (DS, BDD, RL_REUNION, MOTIF, ETAT VÉHICULE,
 * DATE_DS, PARTS, TECHNICEIN_DS, FOUNISSEUR), which this originally left out
 * entirely (the source GAS getParkingList() read them into its row array but
 * never returned them, and its own UI never displayed them — now surfaced
 * here to match what Parking's card shows). DATE_DS is the only one that's
 * ever a Sheets date serial.
 *
 * Also drops the original's `suivi` field: it reads from colMap['SUIVI'],
 * but no "SUIVI" column exists anywhere in CFG_PARKING_SHEET.COLUMNS or the
 * live header row, so it's always ''. Dead code in the source, not ported.
 */
/**
 * `fresh` bypasses the 15s cache and reads Sheets live. Used only for the one
 * refetch that follows the user's own mutation — see invalidateCache() in
 * googleSheetsClient.ts for why invalidating the tag is not enough to make
 * that read see the write.
 */
export async function getAtelierRows(fresh = false): Promise<AtelierRow[]> {
  return withCache(ROWS_CACHE_KEY, ROWS_CACHE_TTL_MS, () => fetchAtelierRows(), { bypass: fresh });
}

/** Called by src/app/api/atelier/refresh/route.ts — the user-triggered "Actualiser" button's hard refresh, so the next read is guaranteed live instead of waiting out the 15s TTL. */
export function invalidateAtelierRowsCache(): void {
  invalidateCache(ROWS_CACHE_KEY);
}

async function fetchAtelierRows(): Promise<AtelierRow[]> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId!,
    range: `'${ATELIER_TAB}'!A1:${HEADER_RANGE_WIDTH}`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const values = res.data.values ?? [];
  if (values.length === 0) return [];

  const headers = values[0].map((h) => String(h ?? "").trim().toUpperCase());
  const colMap = buildColMap(headers);
  const immCol = colMap["IMM"] ?? 1;
  const marqueCol = colMap["MARQUE"];
  const modelCol = colMap["MODEL"];
  const clientCol = colMap["CLIENT"];
  const commentaireCol = colMap["COMMENTAIRE"];
  const categorieCol = colMap["CATÉGORIE"];
  const technicienCol = colMap["TECHNICIEN"];
  const besoinPieceCol = colMap["BESOIN PIÈCE"];
  const tsCol = colMap["TIMESTAMP"];
  const rlReunionCol = colMap["RL_REUNION"];
  const motifCol = colMap["MOTIF"];
  const etatVehiculeCol = colMap["ETAT VÉHICULE"];
  const bddCol = colMap["BDD"];
  const dateDsCol = colMap["DATE_DS"];
  const dsCol = colMap["DS"];
  const partsCol = colMap["PARTS"];
  const techniceinDsCol = colMap["TECHNICEIN_DS"];
  const founisseurCol = colMap["FOUNISSEUR"];
  const geminiCol = colMap["GEMINI"];

  const strOrEmpty = (row: unknown[], col: number | undefined) => {
    if (!col) return "";
    const v = row[col - 1];
    return v != null ? String(v).trim() : "";
  };

  const dateOrEmpty = (row: unknown[], col: number | undefined) => {
    if (!col) return "";
    const v = row[col - 1];
    if (v == null || v === "") return "";
    return typeof v === "number" ? fmtDateOnlyDash(serialToUTCDate(v)) : String(v).trim();
  };

  const rows: AtelierRow[] = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const immRaw = row[immCol - 1];
    const imm = immRaw != null ? String(immRaw).trim().toUpperCase() : "";
    if (!imm) continue;

    const tsRaw = tsCol ? row[tsCol - 1] : undefined;
    let timestamp = "";
    let rawDate = 0;
    if (typeof tsRaw === "number") {
      const d = serialToUTCDate(tsRaw);
      timestamp = fmtDateTime(d);
      rawDate = d.getTime();
    }

    rows.push({
      rowIndex: i + 1,
      imm,
      timestamp,
      rawDate,
      marque: strOrEmpty(row, marqueCol),
      model: strOrEmpty(row, modelCol),
      client: strOrEmpty(row, clientCol),
      commentaire: strOrEmpty(row, commentaireCol),
      categorie: strOrEmpty(row, categorieCol),
      technicien: strOrEmpty(row, technicienCol),
      besoinPiece: strOrEmpty(row, besoinPieceCol),
      rlReunion: strOrEmpty(row, rlReunionCol),
      motif: strOrEmpty(row, motifCol),
      etatVehicule: strOrEmpty(row, etatVehiculeCol),
      bdd: strOrEmpty(row, bddCol),
      dateDs: dateOrEmpty(row, dateDsCol),
      ds: strOrEmpty(row, dsCol),
      parts: strOrEmpty(row, partsCol),
      techniceinDs: strOrEmpty(row, techniceinDsCol),
      founisseur: strOrEmpty(row, founisseurCol),
      gemini: strOrEmpty(row, geminiCol),
    });
  }

  rows.sort((a, b) => a.rawDate - b.rawDate);
  return rows;
}

// ─── addIMMsFromWeb (ported as addAtelierPlates) ──────────────────────────

// XLOOKUP formulas, verbatim from the Atelier CFG_PARKING_SHEET.FORMULAS —
// semicolon argument separators are this spreadsheet's locale, not a typo.
// Only difference from Parking's set: TECHNICEIN_DS instead of TECHNICEIN
// (the manual TECHNICIEN field here is a different column entirely — the
// assigned atelier technician, not the DS record's technician).
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
  TECHNICEIN_DS: '=XLOOKUP(A{ROW};ds!D:D;ds!E:E;"";0;-1)',
  FOUNISSEUR: '=XLOOKUP(A{ROW};ds!D:D;ds!F:F;"";0;-1)',
};

/**
 * Exact same shape/behavior as Parking's addPlates(): resolveIMM() against
 * the Mongo parc plate list, duplicate → bump TIMESTAMP only, new → appended
 * right after the last existing data row (growing the sheet if needed) —
 * empty rows are never reused, since deleteAtelierRow() now removes rows
 * outright instead of clearing them, so none exist to reuse. Seeds the new
 * row's formula columns so it isn't blank until some other process
 * re-touches it.
 */
export async function addAtelierPlates(rawInput: string): Promise<ParkingAddResponse> {
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
  const immCol = colMap["IMM"] ?? 1;
  const tsCol = colMap["TIMESTAMP"];
  if (!tsCol) throw new Error(`Column 'TIMESTAMP' not found in the live '${ATELIER_TAB}' header row`);

  const dataRes = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId!,
    range: `'${ATELIER_TAB}'!A2:${HEADER_RANGE_WIDTH}`,
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
  const props = await getAtelierSheetProps(sheets);
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
    const duplicate = existingSet.has(resolved);

    if (duplicate) {
      const targetRow = plateToRow.get(resolved)!;
      writes.push({
        range: `'${ATELIER_TAB}'!${columnIndexToLetter(tsCol)}${targetRow}`,
        values: [[nowSerial]],
      });
      results.push({ imm: resolved, status: "updated", inParc });
      continue;
    }

    const targetRow = nextRows[nextIdx++];
    if (targetRow == null) break; // shouldn't happen given the expansion above

    writes.push({
      range: `'${ATELIER_TAB}'!${columnIndexToLetter(immCol)}${targetRow}`,
      values: [[resolved]],
    });
    writes.push({
      range: `'${ATELIER_TAB}'!${columnIndexToLetter(tsCol)}${targetRow}`,
      values: [[nowSerial]],
    });

    for (const [field, template] of Object.entries(FORMULAS)) {
      const col = colMap[field];
      if (!col) continue;
      writes.push({
        range: `'${ATELIER_TAB}'!${columnIndexToLetter(col)}${targetRow}`,
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

// ─── updateCellFromWeb (ported as updateAtelierField) ─────────────────────

/**
 * Unlike the original (which accepts any column name, including the
 * read-only XLOOKUP columns), this only accepts ATELIER_EDITABLE_FIELDS —
 * see the allowlist note in src/types/index.ts.
 */
export async function updateAtelierField(
  rowIndex: number,
  field: AtelierEditableField,
  value: string,
  expectedImm: string
): Promise<void> {
  if (!ATELIER_EDITABLE_FIELDS.includes(field)) {
    throw new Error(`Field not editable: ${field}. Editable fields are: ${ATELIER_EDITABLE_FIELDS.join(", ")}.`);
  }

  const sheets = getSheetsClient();
  const headers = await getHeaderRow(sheets);
  const colMap = buildColMap(headers);
  const immCol = colMap["IMM"] ?? 1;
  const fieldCol = colMap[field];
  const tsCol = colMap["TIMESTAMP"];
  if (!fieldCol) throw new Error(`Column '${field}' not found in the live '${ATELIER_TAB}' header row`);
  if (!tsCol) throw new Error(`Column 'TIMESTAMP' not found in the live '${ATELIER_TAB}' header row`);

  await verifyRowIdentity(
    sheets,
    spreadsheetId!,
    `'${ATELIER_TAB}'!${columnIndexToLetter(immCol)}${rowIndex}`,
    expectedImm
  );

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: spreadsheetId!,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        { range: `'${ATELIER_TAB}'!${columnIndexToLetter(fieldCol)}${rowIndex}`, values: [[value.trim()]] },
        { range: `'${ATELIER_TAB}'!${columnIndexToLetter(tsCol)}${rowIndex}`, values: [[nowToSerial()]] },
      ],
    },
  });
  invalidateCache(ROWS_CACHE_KEY);
}

// ─── deleteIMMFromWeb ──────────────────────────────────────────────────────

/** Genuinely deletes the row (Sheets "delete row" — DeleteDimensionRequest),
 *  shifting every row below it up by one. Replaces the original's
 *  clear-cells behavior: empty rows are no longer reused by
 *  addAtelierPlates(), so there's no reason to leave a hollowed-out row in
 *  place. */
export async function deleteAtelierRow(rowIndex: number, expectedImm: string): Promise<void> {
  const sheets = getSheetsClient();
  const headers = await getHeaderRow(sheets);
  const colMap = buildColMap(headers);
  const immCol = colMap["IMM"] ?? 1;

  await verifyRowIdentity(
    sheets,
    spreadsheetId!,
    `'${ATELIER_TAB}'!${columnIndexToLetter(immCol)}${rowIndex}`,
    expectedImm
  );

  const { sheetId } = await getAtelierSheetProps(sheets);

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

// ─── clearParkingFromWeb (ported as clearAtelierAll) ──────────────────────

export async function clearAtelierAll(): Promise<void> {
  const sheets = getSheetsClient();
  const headers = await getHeaderRow(sheets);
  const colMap = buildColMap(headers);
  const immCol = colMap["IMM"] ?? 1;
  const tsCol = colMap["TIMESTAMP"];

  const props = await getAtelierSheetProps(sheets);
  const lastRow = props.rowCount;
  if (lastRow < DATA_START_ROW) return;

  const colRange = (col: number) =>
    `'${ATELIER_TAB}'!${columnIndexToLetter(col)}${DATA_START_ROW}:${columnIndexToLetter(col)}${lastRow}`;

  const ranges = [colRange(immCol)];
  if (tsCol) ranges.push(colRange(tsCol));
  for (const field of ATELIER_EDITABLE_FIELDS) {
    const col = colMap[field];
    if (col) ranges.push(colRange(col));
  }

  await sheets.spreadsheets.values.batchClear({
    spreadsheetId: spreadsheetId!,
    requestBody: { ranges },
  });
  invalidateCache(ROWS_CACHE_KEY);
}

// ─── AI summary ────────────────────────────────────────────────────────────

/**
 * Writes an AI analysis summary into this tab's own `gemini` column, matched
 * on immatriculation.
 *
 * Exists because BDD is an immobilisation tracker (~101 rows against ~11,169
 * analysable plates), so a vehicle sitting in the workshop very often has NO
 * BDD row — and until this existed, running the analysis from Atelier produced
 * a real, paid-for summary that was then thrown away with a "pas de ligne BDD"
 * warning. The ATELIER tab has carried a `gemini` column of its own all along
 * (verified against the live header row, 2026-08-21); this writes to it.
 *
 * Deliberately does NOT bump TIMESTAMP, unlike updateAtelierField(): that
 * column drives the server-side sort, and an AI summary is not the user
 * touching the row — bumping it would jump the card to the other end of the
 * list for everyone, which is the exact behaviour useStableRowOrder() exists
 * to suppress.
 *
 * Returns "no-row" rather than throwing when the plate is not in Atelier: the
 * caller writes to several tabs and reports which ones took it.
 */
export type ZoneGeminiResult =
  | { ok: true; row: number }
  | { ok: false; reason: "no-row" | "no-column" }
  | { ok: false; reason: "write-failed"; error: string };

export async function writeAtelierGeminiSummary(
  imm: string,
  summary: string
): Promise<ZoneGeminiResult> {
  const plate = imm.trim();
  if (!plate) return { ok: false, reason: "write-failed", error: "imm is required" };

  const sheets = getSheetsClient();
  let colMap = buildColMap(await getHeaderRow(sheets));
  let geminiCol = colMap["GEMINI"];

  // A miss is far more often a STALE HEADER CACHE than a missing column, and
  // believing it costs a real, already-paid-for analysis. Same reasoning (and
  // the same bug) as updateSheetRow() in googleSheetsBdd.ts: re-read the header
  // row live before concluding anything. This exact case was observed — the
  // read range was widened to reach `gemini`, but the 5-minute header cache
  // kept serving the old, short header list, so the write went on being
  // skipped as "no column".
  if (!geminiCol) {
    colMap = buildColMap(await getHeaderRow(sheets, true));
    geminiCol = colMap["GEMINI"];
  }
  if (!geminiCol) return { ok: false, reason: "no-column" };

  // Read through the same accessor the UI uses, so a row this app cannot see
  // is not one it will write into either.
  const rows = await getAtelierRows();
  const match = rows.find((r) => r.imm.trim() === plate);
  if (!match) return { ok: false, reason: "no-row" };

  const immCol = colMap["IMM"] ?? 1;
  try {
    await verifyRowIdentity(
      sheets,
      spreadsheetId!,
      `'${ATELIER_TAB}'!${columnIndexToLetter(immCol)}${match.rowIndex}`,
      plate
    );
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId!,
      range: `'${ATELIER_TAB}'!${columnIndexToLetter(geminiCol)}${match.rowIndex}`,
      // RAW, not USER_ENTERED: a summary is free text and must land in the
      // cell exactly as written — a leading "=" or "+" would otherwise be
      // parsed as a formula.
      valueInputOption: "RAW",
      requestBody: { values: [[summary]] },
    });
  } catch (e) {
    return { ok: false, reason: "write-failed", error: e instanceof Error ? e.message : "write refused" };
  }
  invalidateCache(ROWS_CACHE_KEY);
  return { ok: true, row: match.rowIndex };
}
