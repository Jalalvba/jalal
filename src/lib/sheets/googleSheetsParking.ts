import { type sheets_v4 } from "googleapis";
import { getCollection } from "@/lib/mongo/client";
import type { ParkingRow, ParkingAddResponse, ParkingAddResultItem } from "@/types";
import type { ZoneGeminiResult } from "@/lib/sheets/googleSheetsAtelier";
import { getParcOwners } from "@/lib/sheets/googleSheetsParc";
import {
  ROWS_CACHE_TTL_MS,
  columnIndexToLetter,
  fmtDateOnlyDash,
  fmtDateTime,
  getSheetsClient,
  invalidateCache,
  nowToSerial,
  requireCol,
  serialToUTCDate,
  verifyRowIdentity,
  withCache,
} from "@/lib/sheets/googleSheetsClient";

const ROWS_CACHE_KEY = "rows:PARKING";
const HEADERS_CACHE_KEY = "headers:PARKING";
const IMM_LIST_CACHE_KEY = "imm-list:parc";

// Ported from the AVIS Maroc GAS "Parking" system (code.gs + Parking.gs).
// Tab name, column layout and XLOOKUP formulas confirmed by a live read of
// the real spreadsheet (gid=1215781154) — not a guess.

const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEETS_ID in .env.local");

const PARKING_TAB = "PARKING";

// Must cover the LAST real column — see the note on ATELIER's
// HEADER_RANGE_WIDTH. An earlier version of the ranges below stopped at O,
// which made the `gemini` column invisible to this module entirely.
// The live header row is 19 columns, A..S, ending on PRESTATAIRE (read
// 2026-08-31): IMM, TIMESTAMP, KM, ACTION, ZONING, MARQUE, MODEL, gemini,
// CLIENT, RL_REUNION, MOTIF, ETAT VÉHICULE, BDD, DATE_DS, DS, PARTS,
// TECHNICEIN, FOUNISSEUR, PRESTATAIRE. PRESTATAIRE was added 2026-08-31 as a
// NEW column S — it does not replace FOUNISSEUR (R), which still exists and is
// empty on every row. `KM` was added to the live sheet 2026-08-29 and has
// since been moved to column C — which cost nothing here, because every column
// is resolved by header name. Margin to T.
const RANGE_WIDTH = "T";
const DATA_START_ROW = 2;

/** Live header row → column-name lookup, never hardcoded indices. Cached 5min — headers essentially never change. */
async function getHeaderRow(sheets: sheets_v4.Sheets, fresh = false): Promise<string[]> {
  return withCache(HEADERS_CACHE_KEY, 5 * 60_000, async () => {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId!,
      range: `'${PARKING_TAB}'!A1:${RANGE_WIDTH}1`,
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
/**
 * `fresh` bypasses the 15s cache and reads Sheets live. Used only for the one
 * refetch that follows the user's own mutation — see invalidateCache() in
 * googleSheetsClient.ts for why invalidating the tag is not enough to make
 * that read see the write.
 */
export async function getParkingRows(fresh = false): Promise<ParkingRow[]> {
  // `fresh` is threaded into fetchParkingRows so the parc-tab ownership read
  // is refreshed too: "Actualiser" that returned refreshed rows carrying
  // stale owners would be a half-refresh, and the difference is invisible.
  return withCache(ROWS_CACHE_KEY, ROWS_CACHE_TTL_MS, () => fetchParkingRows(fresh), { bypass: fresh });
}

/** Called by src/app/api/parking/refresh/route.ts — the user-triggered "Actualiser" button's hard refresh, so the next read is guaranteed live instead of waiting out the 15s TTL. */
export function invalidateParkingRowsCache(): void {
  invalidateCache(ROWS_CACHE_KEY);
}

async function fetchParkingRows(fresh = false): Promise<ParkingRow[]> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId!,
    range: `'${PARKING_TAB}'!A1:${RANGE_WIDTH}`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const values = res.data.values ?? [];
  if (values.length === 0) return [];

  const headers = values[0].map((h) => String(h ?? "").trim().toUpperCase());
  const colMap = buildColMap(headers);
  const immCol = requireCol(colMap, "IMM", PARKING_TAB);
  const actionCol = requireCol(colMap, "ACTION", PARKING_TAB);
  const marqueCol = requireCol(colMap, "MARQUE", PARKING_TAB);
  const modelCol = requireCol(colMap, "MODEL", PARKING_TAB);
  const clientCol = requireCol(colMap, "CLIENT", PARKING_TAB);
  const tsCol = requireCol(colMap, "TIMESTAMP", PARKING_TAB);
  const rlReunionCol = colMap["RL_REUNION"];
  const motifCol = colMap["MOTIF"];
  const etatVehiculeCol = colMap["ETAT VÉHICULE"];
  const bddCol = colMap["BDD"];
  const dateDsCol = colMap["DATE_DS"];
  const dsCol = colMap["DS"];
  const partsCol = colMap["PARTS"];
  const techniceinCol = colMap["TECHNICEIN"];
  const founisseurCol = colMap["FOUNISSEUR"];
  const prestataireCol = colMap["PRESTATAIRE"];
  const geminiCol = colMap["GEMINI"];
  const zoningCol = colMap["ZONING"];
  const kmCol = colMap["KM"];

  // Ownership comes from the `parc` TAB, not from this one: the CLIENT column
  // here is an XLOOKUP into that tab's Client column, which is empty for every
  // AVIS-owned vehicle — the owner is in its Société column. One cached read
  // for the whole tab, not one per row.
  const owners = await getParcOwners(fresh);

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
      // Falls back to the parc tab's Société when this row's CLIENT lookup is
      // empty — which it is for every AVIS-owned vehicle.
      client: strOrEmpty(clientCol) || (owners.get(imm)?.societe ?? ""),
      rlReunion: strOrEmpty(rlReunionCol),
      motif: strOrEmpty(motifCol),
      etatVehicule: strOrEmpty(etatVehiculeCol),
      bdd: strOrEmpty(bddCol),
      dateDs: dateOrEmpty(dateDsCol),
      ds: strOrEmpty(dsCol),
      parts: strOrEmpty(partsCol),
      technicein: strOrEmpty(techniceinCol),
      founisseur: strOrEmpty(founisseurCol),
      prestataire: strOrEmpty(prestataireCol),
      gemini: strOrEmpty(geminiCol),
      zoning: strOrEmpty(zoningCol),
      ...(() => {
        // Blank is the normal state, so an unparseable or empty cell yields NO
        // key at all rather than 0 — `manualKm: 0` would read downstream as a
        // real reading of zero. Same String()-then-Number coercion the rest of
        // this module uses: UNFORMATTED_VALUE gives a number for a numeric
        // cell, but a hand-typed "142 500" arrives as a string.
        const km = kmNumberOrUndefined(kmCol ? row[kmCol - 1] : undefined);
        return km === undefined ? {} : { manualKm: km };
      })(),
      societe: owners.get(imm)?.societe ?? "",
      isAvis: owners.get(imm)?.isAvis ?? false,
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
 * src/app/api/trigger-import/route.ts calls invalidateIMMListCache() the moment
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

/** Called by src/app/api/trigger-import/route.ts right after a successful parc pipeline run. */
export function invalidateIMMListCache(): void {
  invalidateCache(IMM_LIST_CACHE_KEY);
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
  // Société fallback, matching the live rows byte-for-byte (spaces included):
  // parc!C:C is empty for every AVIS-owned vehicle, whose owner sits in
  // parc!B:B instead. fetchParkingRows() patches this over at read time via
  // getParcOwners(), but the cell itself is read directly in the sheet too.
  CLIENT:
    '=IF(XLOOKUP(A{ROW}; parc!F:F; parc!C:C; ""; 0; 1)=""; XLOOKUP(A{ROW}; parc!F:F; parc!B:B; ""; 0; 1); XLOOKUP(A{ROW}; parc!F:F; parc!C:C; ""; 0; 1))',
  RL_REUNION: '=XLOOKUP(A{ROW};RL_reunion!A:A;RL_reunion!B:B;"";0;1)',
  MOTIF: '=XLOOKUP(A{ROW};RL!D:D;RL!S:S;"sans RL";0;1)',
  "ETAT VÉHICULE": '=XLOOKUP(A{ROW};parc!F:F;parc!I:I;"";0;1)',
  // BDD!I:I is the commentaire column; the live PARKING rows all point there
  // (confirmed by a FORMULA read of the tab, 2026-08-31). ATELIER/DEPOT still
  // legitimately point at H — only PARKING was migrated.
  BDD: '=XLOOKUP(A{ROW};BDD!A:A;BDD!I:I;"";0;1)',
  DATE_DS: '=XLOOKUP(A{ROW};ds!D:D;ds!A:A;"";0;-1)',
  DS: '=XLOOKUP(A{ROW};ds!D:D;ds!C:C;"";0;-1)',
  PARTS: '=XLOOKUP(A{ROW};ds!D:D;ds!G:G;"";0;-1)',
  TECHNICEIN: '=XLOOKUP(A{ROW};ds!D:D;ds!E:E;"";0;-1)',
  FOUNISSEUR: '=XLOOKUP(A{ROW};ds!D:D;ds!F:F;"";0;-1)',
  // Column S, added to the live sheet 2026-08-31 — reads the provider out of
  // BDD!F:F (prestataire). Missing from this map until now, so every plate
  // added through the API had a permanently blank PRESTATAIRE cell.
  PRESTATAIRE: '=XLOOKUP(A{ROW};BDD!A:A;BDD!F:F;"";0;1)',
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
  const immCol = requireCol(colMap, "IMM", PARKING_TAB);
  const tsCol = requireCol(colMap, "TIMESTAMP", PARKING_TAB);

  const dataRes = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId!,
    range: `'${PARKING_TAB}'!A2:${RANGE_WIDTH}`,
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

/**
 * Writes one row's ACTION cell (and stamps TIMESTAMP).
 *
 * `action` may be MULTI-LINE — the AI work order is one operation per line —
 * so this also sets the cell's wrap strategy to WRAP. Without it Sheets keeps
 * the newlines in the value but renders the cell on a single clipped line, and
 * the advisor sees "1. Remplacer le filtre à gasoil (jamais enre…" with the
 * rest invisible until they click into it. The value is unchanged either way;
 * this is purely how the cell displays.
 */
export async function updateAction(rowIndex: number, action: string, expectedImm: string): Promise<void> {
  const sheets = getSheetsClient();
  const headers = await getHeaderRow(sheets);
  const colMap = buildColMap(headers);
  const immCol = requireCol(colMap, "IMM", PARKING_TAB);
  const actionCol = requireCol(colMap, "ACTION", PARKING_TAB);
  const tsCol = requireCol(colMap, "TIMESTAMP", PARKING_TAB);

  await verifyRowIdentity(
    sheets,
    spreadsheetId!,
    `'${PARKING_TAB}'!${columnIndexToLetter(immCol)}${rowIndex}`,
    expectedImm
  );

  const text = action.trim();

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: spreadsheetId!,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        { range: `'${PARKING_TAB}'!${columnIndexToLetter(actionCol)}${rowIndex}`, values: [[text]] },
        { range: `'${PARKING_TAB}'!${columnIndexToLetter(tsCol)}${rowIndex}`, values: [[nowToSerial()]] },
      ],
    },
  });

  // Only for a multi-line value, and never fatal: the text IS written by the
  // call above, so a formatting failure must not report the write as failed
  // and make a caller retry it.
  if (text.includes("\n")) {
    try {
      const { sheetId } = await getParkingSheetProps(sheets);
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: spreadsheetId!,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: rowIndex - 1, // API rows are 0-based, half-open
                  endRowIndex: rowIndex,
                  startColumnIndex: actionCol - 1,
                  endColumnIndex: actionCol,
                },
                cell: { userEnteredFormat: { wrapStrategy: "WRAP", verticalAlignment: "TOP" } },
                fields: "userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment",
              },
            },
          ],
        },
      });
    } catch (e) {
      console.warn(`[parking] ACTION written but cell wrap could not be set (row ${rowIndex}):`, e);
    }
  }

  invalidateCache(ROWS_CACHE_KEY);
}

/**
 * Writes one row's ZONING cell.
 *
 * Same shape as updateAction(): verifyRowIdentity() first, so a row that
 * shifted under the client's feet is refused rather than mis-targeted
 * (AGENTS.md rule 3). No TIMESTAMP stamp — that column tracks the ACTION
 * workflow, and touching it here would make a zone change look like workshop
 * activity in every view that sorts or reads by it.
 */
export async function updateZoning(rowIndex: number, zoning: string, expectedImm: string): Promise<void> {
  const sheets = getSheetsClient();
  const colMap = buildColMap(await getHeaderRow(sheets));
  const immCol = requireCol(colMap, "IMM", PARKING_TAB);
  const zoningCol = colMap["ZONING"];
  if (!zoningCol) throw new Error("Colonne ZONING introuvable sur l'onglet PARKING");

  await verifyRowIdentity(
    sheets,
    spreadsheetId!,
    `'${PARKING_TAB}'!${columnIndexToLetter(immCol)}${rowIndex}`,
    expectedImm
  );

  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId!,
    range: `'${PARKING_TAB}'!${columnIndexToLetter(zoningCol)}${rowIndex}`,
    // RAW, not USER_ENTERED: these are literal labels ("depot-ATV"), and
    // USER_ENTERED reinterprets what it is given.
    valueInputOption: "RAW",
    requestBody: { values: [[zoning.trim()]] },
  });
  invalidateCache(ROWS_CACHE_KEY);
}

/**
 * Parses one KM cell. Accepts what a human actually types — "142500",
 * "142 500", "142,500" — and rejects everything else to `undefined`.
 *
 * The bounds mirror toKm() in prompts/maintenanceIntervals.ts on purpose: a
 * value this function lets through but the resolver then rejects would show in
 * the UI as an accepted override while silently doing nothing to the checks,
 * which is the worst of both.
 */
function kmNumberOrUndefined(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(String(v).replace(/[\s,]/g, ""));
  return Number.isFinite(n) && n > 0 && n <= 1_000_000 ? n : undefined;
}

/**
 * Writes one row's KM cell — the hand-entered odometer that overrides the
 * DS-derived one (see resolveVehicleKm() in prompts/maintenanceIntervals.ts).
 *
 * Same shape as updateZoning(), deliberately: verifyRowIdentity() first, so a
 * client-supplied rowIndex that shifted under the user's feet is refused rather
 * than writing a mileage onto the wrong vehicle (AGENTS.md rule 3 — and the
 * consequence here is worse than a mislabelled zone, since this number decides
 * whether a timing belt gets flagged).
 *
 * No TIMESTAMP stamp, for the same reason as updateZoning: reading a dashboard
 * is not workshop activity, and stamping it would make every km entry look like
 * one in every view that sorts by that column.
 *
 * An empty string CLEARS the override and falls the vehicle back to its DS
 * history — a real operation, not a no-op, so it is allowed through.
 */
export async function updateManualKm(
  rowIndex: number,
  km: string,
  expectedImm: string
): Promise<void> {
  const sheets = getSheetsClient();
  const colMap = buildColMap(await getHeaderRow(sheets));
  const immCol = requireCol(colMap, "IMM", PARKING_TAB);
  const kmCol = colMap["KM"];
  if (!kmCol) throw new Error("Colonne KM introuvable sur l'onglet PARKING");

  await verifyRowIdentity(
    sheets,
    spreadsheetId!,
    `'${PARKING_TAB}'!${columnIndexToLetter(immCol)}${rowIndex}`,
    expectedImm
  );

  const raw = km.trim();
  const parsed = kmNumberOrUndefined(raw);
  if (raw && parsed === undefined) {
    throw new Error("Kilométrage invalide : saisir un nombre entre 1 et 1 000 000");
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId!,
    range: `'${PARKING_TAB}'!${columnIndexToLetter(kmCol)}${rowIndex}`,
    // RAW, per AGENTS/CLAUDE.md: USER_ENTERED reinterprets what it is given,
    // and this cell is read back with Number() — a locale-reformatted value is
    // a value this module then has to un-format.
    valueInputOption: "RAW",
    requestBody: { values: [[parsed ?? ""]] },
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
  const immCol = requireCol(colMap, "IMM", PARKING_TAB);

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
  const immCol = requireCol(colMap, "IMM", PARKING_TAB);
  const actionCol = requireCol(colMap, "ACTION", PARKING_TAB);
  const tsCol = requireCol(colMap, "TIMESTAMP", PARKING_TAB);

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

// ─── AI summary ────────────────────────────────────────────────────────────

/**
 * Writes an AI analysis summary into this tab's own `gemini` column, matched
 * on immatriculation. Mirror of writeAtelierGeminiSummary() — see that
 * function for why the zone tabs write their own copy instead of relying on
 * BDD having a row, and why TIMESTAMP is deliberately left alone.
 */
export async function writeParkingGeminiSummary(
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

  const rows = await getParkingRows();
  const match = rows.find((r) => r.imm.trim() === plate);
  if (!match) return { ok: false, reason: "no-row" };

  const immCol = requireCol(colMap, "IMM", PARKING_TAB);
  try {
    await verifyRowIdentity(
      sheets,
      spreadsheetId!,
      `'${PARKING_TAB}'!${columnIndexToLetter(immCol)}${match.rowIndex}`,
      plate
    );
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId!,
      range: `'${PARKING_TAB}'!${columnIndexToLetter(geminiCol)}${match.rowIndex}`,
      valueInputOption: "RAW",
      requestBody: { values: [[summary]] },
    });
  } catch (e) {
    return { ok: false, reason: "write-failed", error: e instanceof Error ? e.message : "write refused" };
  }
  invalidateCache(ROWS_CACHE_KEY);
  return { ok: true, row: match.rowIndex };
}
