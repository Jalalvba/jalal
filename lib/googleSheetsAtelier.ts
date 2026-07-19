import { google, type sheets_v4 } from "googleapis";
import { getIMMList, resolveIMM } from "@/lib/googleSheetsParking";
import type {
  AtelierRow,
  AtelierEditableField,
  ParkingAddResponse,
  ParkingAddResultItem,
} from "@/lib/types";
import { ATELIER_EDITABLE_FIELDS } from "@/lib/types";

// Ported from the AVIS Maroc GAS "Atelier" system (code.gs + RebuildAtelier.gs).
// Same spreadsheet as PARKING/BDD (TARGET_SHEET_ID in the source matches this
// app's GOOGLE_SHEETS_ID — confirmed, not a guess). Tab name and the fact that
// its live column *order* drifts from the reference source are both confirmed
// by a live spreadsheets.values.get() read.

const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEETS_ID in .env.local");

const keyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64;
if (!keyB64) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_KEY_B64 in .env.local");

const ATELIER_TAB = "ATELIER";
const DATA_START_ROW = 2;
const HEADER_RANGE_WIDTH = "S"; // 18 real columns, generous margin

declare global {
  // Shared with lib/googleSheetsBdd.ts and lib/googleSheetsParking.ts — same
  // global slot, same singleton.
  var _sheetsClient: sheets_v4.Sheets | undefined;
}

function getSheetsClient(): sheets_v4.Sheets {
  if (global._sheetsClient) return global._sheetsClient;

  const key = JSON.parse(Buffer.from(keyB64!, "base64").toString("utf8"));
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  global._sheetsClient = google.sheets({ version: "v4", auth });
  return global._sheetsClient;
}

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

async function getHeaderRow(sheets: sheets_v4.Sheets): Promise<string[]> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId!,
    range: `'${ATELIER_TAB}'!A1:${HEADER_RANGE_WIDTH}1`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const row = res.data.values?.[0] ?? [];
  return row.map((h) => String(h ?? "").trim().toUpperCase());
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

// ─── Sheets serial date/time helpers (UTC-based, same as the other lib/googleSheets*.ts) ─

const SHEETS_EPOCH_MS = Date.UTC(1899, 11, 30);

function serialToUTCDate(serial: number): Date {
  const wholeDays = Math.floor(serial);
  const fractionalMs = Math.round((serial - wholeDays) * 86400000);
  return new Date(SHEETS_EPOCH_MS + wholeDays * 86400000 + fractionalMs);
}

function nowToSerial(): number {
  return (Date.now() - SHEETS_EPOCH_MS) / 86400000;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function fmtDateTime(d: Date): string {
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad2(
    d.getUTCHours()
  )}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

// ─── getParkingList (ported as getAtelierRows) ────────────────────────────

/**
 * Named fields only — no catch-all "meta" string. The original Atelier
 * getParkingList() reads the DS/BDD/RL_REUNION/MOTIF/ETAT VÉHICULE/DATE_DS/
 * PARTS/TECHNICEIN_DS/FOUNISSEUR formula columns into its row array but never
 * includes them in the object it returns, and its own UI never displays
 * them — ported as-is, not "improved" with a meta field Parking has and this
 * source doesn't.
 *
 * Also drops the original's `suivi` field: it reads from colMap['SUIVI'],
 * but no "SUIVI" column exists anywhere in CFG_PARKING_SHEET.COLUMNS or the
 * live header row, so it's always ''. Dead code in the source, not ported.
 */
export async function getAtelierRows(): Promise<AtelierRow[]> {
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

  const strOrEmpty = (row: unknown[], col: number | undefined) => {
    if (!col) return "";
    const v = row[col - 1];
    return v != null ? String(v).trim() : "";
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
 * the Mongo parc plate list, duplicate → bump TIMESTAMP only, new → first
 * empty IMM row (growing the sheet by the exact shortfall if none remain),
 * seeding that row's formula columns so it isn't blank until some other
 * process re-touches it.
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
  const emptyRows: number[] = [];

  dataRows.forEach((row, i) => {
    const rowNum = DATA_START_ROW + i;
    const raw = row[immCol - 1];
    const val = raw != null ? String(raw).trim().toUpperCase() : "";
    if (val) {
      existingSet.add(val);
      plateToRow.set(val, rowNum);
    } else {
      emptyRows.push(rowNum);
    }
  });

  const needed = tokens.length;
  if (emptyRows.length < needed) {
    const props = await getAtelierSheetProps(sheets);
    const lastKnownRow = DATA_START_ROW + dataRows.length - 1;
    const shortfall = needed - emptyRows.length;
    const startNewRow = Math.max(props.rowCount, lastKnownRow) + 1;
    const gridShortfall = startNewRow + shortfall - 1 - props.rowCount;
    if (gridShortfall > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: spreadsheetId!,
        requestBody: {
          requests: [{ appendDimension: { sheetId: props.sheetId, dimension: "ROWS", length: gridShortfall } }],
        },
      });
    }
    for (let r = startNewRow; r < startNewRow + shortfall; r++) emptyRows.push(r);
  }

  const immList = await getIMMList();
  const results: ParkingAddResultItem[] = [];
  const nowSerial = nowToSerial();
  const writes: { range: string; values: (string | number)[][] }[] = [];
  let emptyIdx = 0;

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

    const targetRow = emptyRows[emptyIdx++];
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
  }

  return { ok: true, results };
}

// ─── updateCellFromWeb (ported as updateAtelierField) ─────────────────────

/**
 * Unlike the original (which accepts any column name, including the
 * read-only XLOOKUP columns), this only accepts ATELIER_EDITABLE_FIELDS —
 * see the allowlist note in lib/types.ts.
 */
export async function updateAtelierField(
  rowIndex: number,
  field: AtelierEditableField,
  value: string
): Promise<void> {
  if (!ATELIER_EDITABLE_FIELDS.includes(field)) {
    throw new Error(`Field not editable: ${field}. Editable fields are: ${ATELIER_EDITABLE_FIELDS.join(", ")}.`);
  }

  const sheets = getSheetsClient();
  const headers = await getHeaderRow(sheets);
  const colMap = buildColMap(headers);
  const fieldCol = colMap[field];
  const tsCol = colMap["TIMESTAMP"];
  if (!fieldCol) throw new Error(`Column '${field}' not found in the live '${ATELIER_TAB}' header row`);
  if (!tsCol) throw new Error(`Column 'TIMESTAMP' not found in the live '${ATELIER_TAB}' header row`);

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
}

// ─── deleteIMMFromWeb ──────────────────────────────────────────────────────

/** Clears IMM, TIMESTAMP and the 4 editable manual fields — formula columns
 *  are left in place, same reasoning as Parking's deletePlate(). */
export async function deleteAtelierRow(rowIndex: number): Promise<void> {
  const sheets = getSheetsClient();
  const headers = await getHeaderRow(sheets);
  const colMap = buildColMap(headers);
  const immCol = colMap["IMM"] ?? 1;
  const tsCol = colMap["TIMESTAMP"];

  const ranges = [`'${ATELIER_TAB}'!${columnIndexToLetter(immCol)}${rowIndex}`];
  if (tsCol) ranges.push(`'${ATELIER_TAB}'!${columnIndexToLetter(tsCol)}${rowIndex}`);
  for (const field of ATELIER_EDITABLE_FIELDS) {
    const col = colMap[field];
    if (col) ranges.push(`'${ATELIER_TAB}'!${columnIndexToLetter(col)}${rowIndex}`);
  }

  await sheets.spreadsheets.values.batchClear({
    spreadsheetId: spreadsheetId!,
    requestBody: { ranges },
  });
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
}
