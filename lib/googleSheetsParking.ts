import { type sheets_v4 } from "googleapis";
import { getCollection } from "@/lib/mongo";
import type { ParkingRow, ParkingAddResponse, ParkingAddResultItem } from "@/lib/types";
import {
  getSheetsClient,
  serialToUTCDate,
  nowToSerial,
  fmtDateOnlyDash,
  fmtDateTime,
  withCache,
  invalidateCache,
  verifyRowIdentity,
  columnIndexToLetter,
} from "@/lib/googleSheetsClient";

const ROWS_CACHE_KEY = "rows:PARKING";
const HEADERS_CACHE_KEY = "headers:PARKING";
const IMM_LIST_CACHE_KEY = "imm-list:parc";
const VEHICLE_SUGGEST_CACHE_KEY = "vehicle-suggest-list:parc";

// Ported from the AVIS Maroc GAS "Parking" system (code.gs + Parking.gs).
// Tab name, column layout and XLOOKUP formulas confirmed by a live read of
// the real spreadsheet (gid=1215781154) — not a guess.

const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEETS_ID in .env.local");

const PARKING_TAB = "PARKING";
const DATA_START_ROW = 2;

/** Live header row → column-name lookup, never hardcoded indices. Cached 5min — headers essentially never change. */
async function getHeaderRow(sheets: sheets_v4.Sheets): Promise<string[]> {
  return withCache(HEADERS_CACHE_KEY, 5 * 60_000, async () => {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId!,
      range: `'${PARKING_TAB}'!A1:O1`,
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

async function getParkingSheetProps(
  sheets: sheets_v4.Sheets
): Promise<{ sheetId: number; rowCount: number }> {
  const res = await sheets.spreadsheets.get({
    spreadsheetId: spreadsheetId!,
    fields: "sheets.properties",
  });
  const props = res.data.sheets?.find((s) => s.properties?.title === PARKING_TAB)?.properties;
  if (!props || props.sheetId == null) {
    throw new Error(`Sheet tab '${PARKING_TAB}' not found`);
  }
  return { sheetId: props.sheetId, rowCount: props.gridProperties?.rowCount ?? 0 };
}


// ─── getParkingList ────────────────────────────────────────────────────────

/**
 * Reads every non-empty row (IMM non-blank) from the PARKING tab, sorted
 * ascending by timestamp (oldest first, newest at the bottom) — matches the
 * original getParkingList()'s sort direction exactly.
 *
 * The 9 read-only XLOOKUP columns (RL_REUNION, MOTIF, ETAT VÉHICULE, BDD,
 * DATE_DS, DS, PARTS, TECHNICEIN, FOUNISSEUR) are extracted as their own
 * named fields — same live column-map pattern getAtelierRows() uses — rather
 * than being collapsed into one opaque joined string. DATE_DS is the only one
 * that's ever a Sheets date serial; the rest are plain XLOOKUP text/numbers.
 */
export async function getParkingRows(): Promise<ParkingRow[]> {
  return withCache(ROWS_CACHE_KEY, 15_000, () => fetchParkingRows());
}

async function fetchParkingRows(): Promise<ParkingRow[]> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId!,
    range: `'${PARKING_TAB}'!A1:O`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const values = res.data.values ?? [];
  if (values.length === 0) return [];

  const headers = values[0].map((h) => String(h ?? "").trim().toUpperCase());
  const colMap = buildColMap(headers);
  const immCol = colMap["IMM"] ?? 1;
  const actionCol = colMap["ACTION"] ?? 2;
  const marqueCol = colMap["MARQUE"] ?? 3;
  const modelCol = colMap["MODEL"] ?? 4;
  const clientCol = colMap["CLIENT"] ?? 5;
  const tsCol = colMap["TIMESTAMP"] ?? 15;
  const rlReunionCol = colMap["RL_REUNION"];
  const motifCol = colMap["MOTIF"];
  const etatVehiculeCol = colMap["ETAT VÉHICULE"];
  const bddCol = colMap["BDD"];
  const dateDsCol = colMap["DATE_DS"];
  const dsCol = colMap["DS"];
  const partsCol = colMap["PARTS"];
  const techniceinCol = colMap["TECHNICEIN"];
  const founisseurCol = colMap["FOUNISSEUR"];

  const rows: ParkingRow[] = [];

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

// ─── getIMMList ────────────────────────────────────────────────────────────

/**
 * The original GAS system keeps a Sheets "IMM" tab that's just a mirror of
 * the Sheets "parc" tab's Immatriculation column (see syncIMMTab() in the
 * source code.gs — it literally copies parc → IMM). This app already has
 * "parc" migrated to MongoDB (the same collection /api/parc and DS History's
 * autocomplete already query), so this reads that directly instead of
 * maintaining a redundant Sheets mirror this app has no other use for.
 *
 * TTL is a full week (2026-08-09): confirmed with the person that parc only
 * actually changes on a roughly weekly cadence in practice — cross-checked
 * against `pipeline_runs`, whose parc entries show real "success" runs
 * ~5 days apart (2026-08-03, 2026-08-08) with everything between them
 * "skipped" (unchanged). A week-long default would otherwise risk serving
 * stale plates for up to 7 days after a genuine change, so
 * app/api/trigger-import/route.ts calls invalidateIMMListCache() the moment
 * it sees the parc pipeline report "success" (not "skipped_unchanged" /
 * "skipped_absent" / "failed"), so a real update is reflected immediately
 * instead of waiting out the TTL.
 */
export async function getIMMList(): Promise<string[]> {
  return withCache(IMM_LIST_CACHE_KEY, 7 * 24 * 60 * 60_000, async () => {
    const col = await getCollection("parc");
    // Real field is lowercase "immatriculation" (field_registry.json) — a
    // prior "Immatriculation" typo here always matched zero documents, so
    // this list silently returned [] since the day it was written. Index-
    // backed distinct() also skips the ~7.8k-doc full projection scan the
    // old find({}).toArray() did every cache miss.
    const values = await col.distinct("immatriculation");

    const set = new Set<string>();
    for (const v of values) {
      const s = String(v ?? "").trim().toUpperCase();
      if (s) set.add(s);
    }
    return [...set];
  });
}

/** Called by app/api/trigger-import/route.ts right after a successful parc pipeline run. */
export function invalidateIMMListCache(): void {
  invalidateCache(IMM_LIST_CACHE_KEY);
  invalidateCache(VEHICLE_SUGGEST_CACHE_KEY);
}

export type VehicleSuggestion = { imm: string; ww: string; marque: string; modele: string };

/**
 * Widened sibling of getIMMList(): same "parc" collection, same weekly TTL
 * and invalidation trigger (invalidateIMMListCache() above clears both keys
 * together), but returns {imm, ww, marque, modele} instead of a bare plate
 * string — used by useImmSuggestions() to populate DS History's suggestion
 * list without a per-keystroke Mongo round trip.
 */
export async function getVehicleSuggestionList(): Promise<VehicleSuggestion[]> {
  return withCache(VEHICLE_SUGGEST_CACHE_KEY, 7 * 24 * 60 * 60_000, async () => {
    const col = await getCollection("parc");
    const docs = await col
      .find({}, { projection: { immatriculation: 1, numero_ww: 1, marque: 1, modele: 1 } })
      .toArray();

    const seen = new Set<string>();
    const list: VehicleSuggestion[] = [];
    for (const d of docs) {
      const imm = String(d.immatriculation ?? "").trim().toUpperCase();
      if (!imm || seen.has(imm)) continue;
      seen.add(imm);
      list.push({
        imm,
        ww: String(d.numero_ww ?? "").trim(),
        marque: String(d.marque ?? "").trim(),
        modele: String(d.modele ?? "").trim(),
      });
    }
    // Sorted to match col.distinct("immatriculation")'s (getIMMList()) sort
    // order — otherwise the two lists' first-15 truncation in useImmSuggestions
    // vs usePlateAutocomplete diverges for any prefix matching >15 plates,
    // even though both are correct, complete matches underneath.
    list.sort((a, b) => (a.imm < b.imm ? -1 : a.imm > b.imm ? 1 : 0));
    return list;
  });
}

/**
 * Fail-soft wrapper: getIMMList() is a nice-to-have (typo-correction against
 * the known fleet list, plus the `inParc` flag), not a hard requirement for
 * writing a plate string into a Sheets cell. A MongoDB outage/timeout used
 * to throw uncaught out of addPlates()/addAtelierPlates()/addDepotPlates(),
 * blocking Sheets writes entirely over an unrelated system being down — and
 * risked leaving orphaned blank rows if the sheet's grid had already been
 * grown by the time it threw. This degrades to verbatim plate resolution
 * instead: resolveIMM() with an empty list just uppercases the token as-is.
 */
export async function getIMMListSafe(): Promise<string[]> {
  try {
    return await getIMMList();
  } catch (e) {
    console.error("[getIMMList] Mongo lookup failed, degrading to verbatim plate resolution:", e);
    return [];
  }
}

// ─── resolveIMM_ ───────────────────────────────────────────────────────────

/**
 * Exact port of resolveIMM_(): exact match first; otherwise strip
 * non-alphanumeric characters from both the token and every known plate and
 * auto-resolve only if the stripped token is a prefix of EXACTLY ONE
 * stripped known plate. Any other outcome (zero or multiple matches) leaves
 * the token as typed (uppercased).
 */
export function resolveIMM(token: string, immList: string[]): string {
  const t = (token ?? "").trim().toUpperCase();
  if (!t) return "";
  if (immList.includes(t)) return t;

  const stripped = t.replace(/[^A-Z0-9]/g, "");
  if (!stripped) return t;

  const matches = immList.filter((imm) => imm.replace(/[^A-Z0-9]/g, "").startsWith(stripped));
  return matches.length === 1 ? matches[0] : t;
}

// ─── addIMMsFromWeb ────────────────────────────────────────────────────────

// XLOOKUP formulas, verbatim from Parking.gs's CFG_PARKING_SHEET.FORMULAS —
// semicolon argument separators are this spreadsheet's locale, not a typo.
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
 * Comma-separated tokens, each resolved via resolveIMM(). A plate already
 * present in PARKING just gets its TIMESTAMP bumped to now (moves it to the
 * bottom of the sorted list) instead of inserting a new row. A genuinely new
 * plate is appended right after the last existing data row — empty rows are
 * never reused, since deletePlate() now removes rows outright instead of
 * clearing them, so none exist to reuse. The sheet is grown by exactly as
 * many rows as still needed (via appendDimension) if appending would run
 * past the grid's current row count.
 *
 * New rows also get the 12 XLOOKUP formulas seeded into their formula
 * columns, since a brand-new row created by growing the sheet has never had
 * a formula written into it.
 */
export async function addPlates(rawInput: string): Promise<ParkingAddResponse> {
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
  const tsCol = colMap["TIMESTAMP"] ?? 15;

  const dataRes = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId!,
    range: `'${PARKING_TAB}'!A2:O`,
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
  const props = await getParkingSheetProps(sheets);
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
        range: `'${PARKING_TAB}'!${columnIndexToLetter(tsCol)}${targetRow}`,
        values: [[nowSerial]],
      });
      results.push({ imm: resolved, status: "updated", inParc });
      continue;
    }

    const targetRow = nextRows[nextIdx++];
    if (targetRow == null) break; // shouldn't happen given the expansion above

    writes.push({
      range: `'${PARKING_TAB}'!${columnIndexToLetter(immCol)}${targetRow}`,
      values: [[resolved]],
    });
    writes.push({
      range: `'${PARKING_TAB}'!${columnIndexToLetter(tsCol)}${targetRow}`,
      values: [[nowSerial]],
    });

    for (const [field, template] of Object.entries(FORMULAS)) {
      const col = colMap[field];
      if (!col) continue;
      writes.push({
        range: `'${PARKING_TAB}'!${columnIndexToLetter(col)}${targetRow}`,
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

// ─── updateActionFromWeb ───────────────────────────────────────────────────

export async function updateAction(rowIndex: number, action: string, expectedImm: string): Promise<void> {
  const sheets = getSheetsClient();
  const headers = await getHeaderRow(sheets);
  const colMap = buildColMap(headers);
  const immCol = colMap["IMM"] ?? 1;
  const actionCol = colMap["ACTION"] ?? 2;
  const tsCol = colMap["TIMESTAMP"] ?? 15;

  await verifyRowIdentity(
    sheets,
    spreadsheetId!,
    `'${PARKING_TAB}'!${columnIndexToLetter(immCol)}${rowIndex}`,
    expectedImm
  );

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: spreadsheetId!,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        { range: `'${PARKING_TAB}'!${columnIndexToLetter(actionCol)}${rowIndex}`, values: [[action.trim()]] },
        { range: `'${PARKING_TAB}'!${columnIndexToLetter(tsCol)}${rowIndex}`, values: [[nowToSerial()]] },
      ],
    },
  });
  invalidateCache(ROWS_CACHE_KEY);
}

// ─── deleteIMMFromWeb ──────────────────────────────────────────────────────

/** Genuinely deletes the row (Sheets "delete row" — DeleteDimensionRequest),
 *  shifting every row below it up by one. Replaces the original's
 *  clear-cells behavior: empty rows are no longer reused by addPlates(), so
 *  there's no reason to leave a hollowed-out row in place. */
export async function deletePlate(rowIndex: number, expectedImm: string): Promise<void> {
  const sheets = getSheetsClient();
  const headers = await getHeaderRow(sheets);
  const colMap = buildColMap(headers);
  const immCol = colMap["IMM"] ?? 1;

  await verifyRowIdentity(
    sheets,
    spreadsheetId!,
    `'${PARKING_TAB}'!${columnIndexToLetter(immCol)}${rowIndex}`,
    expectedImm
  );

  const { sheetId } = await getParkingSheetProps(sheets);

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

// ─── clearParkingFromWeb ───────────────────────────────────────────────────

export async function clearAll(): Promise<void> {
  const sheets = getSheetsClient();
  const headers = await getHeaderRow(sheets);
  const colMap = buildColMap(headers);
  const immCol = colMap["IMM"] ?? 1;
  const actionCol = colMap["ACTION"] ?? 2;
  const tsCol = colMap["TIMESTAMP"] ?? 15;

  const props = await getParkingSheetProps(sheets);
  const lastRow = props.rowCount;
  if (lastRow < DATA_START_ROW) return;

  const colRange = (col: number) =>
    `'${PARKING_TAB}'!${columnIndexToLetter(col)}${DATA_START_ROW}:${columnIndexToLetter(col)}${lastRow}`;

  await sheets.spreadsheets.values.batchClear({
    spreadsheetId: spreadsheetId!,
    requestBody: { ranges: [colRange(immCol), colRange(tsCol), colRange(actionCol)] },
  });
  invalidateCache(ROWS_CACHE_KEY);
}
