import { type sheets_v4 } from "googleapis";
import {
  BDD_EDITABLE_FIELDS,
  type BddRow,
  type BddUpdateResult,
  type ParkingAddResponse,
} from "@/lib/types";
import { buildPlateVariants } from "@/lib/plateVariants";
import { getIMMListSafe, resolveIMM } from "@/lib/googleSheetsParking";
import {
  getSheetsClient,
  serialToUTCDate,
  fmtDateOnlySlash,
  withCache,
  invalidateCache,
  verifyRowIdentity,
  columnIndexToLetter,
} from "@/lib/googleSheetsClient";

const ROWS_CACHE_KEY = "rows:BDD";
const HEADERS_CACHE_KEY = "headers:BDD";

const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEETS_ID in .env.local");

// Confirmed by a live spreadsheets.get() call against gid=868042157 — not a guess.
// DELIBERATE (2026-08-09): the "Suivi RL" page (app/suivi-rl/page.tsx) reads/writes
// this BDD tab, not a separate "RL" tab — no such tab exists. "RL" is a business/UI
// name for a filtered view over BDD's RL-related columns, not a distinct data source.
// Reconsider only if the sheet owner ever splits RL data into its own tab.
const BDD_TAB_NAME = "BDD";
const editableFieldSet = new Set<string>(BDD_EDITABLE_FIELDS);

// Wide enough that a realistic header row can never be truncated (verified up
// to column BZ during discovery), without hardcoding the sheet's real width.
const HEADER_SCAN_WIDTH = "CZ";

/** Fetches the real row-1 header list, cached 5min — headers essentially never change. */
async function getHeaderRow(sheets: sheets_v4.Sheets): Promise<string[]> {
  return withCache(HEADERS_CACHE_KEY, 5 * 60_000, async () => {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId!,
      range: `'${BDD_TAB_NAME}'!A1:${HEADER_SCAN_WIDTH}1`,
    });
    const row = res.data.values?.[0] ?? [];
    return row.map((h) => String(h ?? "").trim());
  });
}

/**
 * Same pattern as googleSheetsParking.ts's getParkingSheetProps() — the
 * numeric sheetId a deleteDimension request needs (distinct from the
 * spreadsheet-wide spreadsheetId), plus rowCount (needed by addBddRow() to
 * know whether the grid needs growing before appending a new row).
 */
async function getBddSheetProps(sheets: sheets_v4.Sheets): Promise<{ sheetId: number; rowCount: number }> {
  const res = await sheets.spreadsheets.get({
    spreadsheetId: spreadsheetId!,
    fields: "sheets.properties",
  });
  const props = res.data.sheets?.find((s) => s.properties?.title === BDD_TAB_NAME)?.properties;
  if (!props || props.sheetId == null) {
    throw new Error(`Sheet tab '${BDD_TAB_NAME}' not found`);
  }
  return { sheetId: props.sheetId, rowCount: props.gridProperties?.rowCount ?? 0 };
}

function buildColMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((h, i) => {
    if (h) map[h] = i + 1; // 1-based
  });
  return map;
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
// "date_ds" restored (the sheet owner fixed its mislabeled header back —
// see BDD_HEADERS comment in lib/types.ts); "RDV" added — its XLOOKUP
// formula returns RDV!A:A (the RDV tab's Date column), confirmed live to
// be a date serial too.
const DATE_LIKE_HEADERS = new Set(["date", "date_fin_contrat", "date_ds", "RDV"]);

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
  const rows = await withCache(ROWS_CACHE_KEY, 15_000, () => fetchSheetRows());
  if (!immFilter) return rows;

  const variants = new Set(buildPlateVariants(immFilter));
  return rows.filter((r) => variants.has(String(r.IMM ?? "").trim().toUpperCase()));
}

/** Called by app/api/bdd/refresh/route.ts — Suivi RL's and DS History's user-triggered "Actualiser"/re-search hard refresh, so the next read is guaranteed live instead of waiting out the 15s TTL. */
export function invalidateBddRowsCache(): void {
  invalidateCache(ROWS_CACHE_KEY);
}

async function fetchSheetRows(): Promise<BddRow[]> {
  const sheets = getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId!,
    range: `'${BDD_TAB_NAME}'!A1:${HEADER_SCAN_WIDTH}`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const values = res.data.values ?? [];
  if (values.length === 0) return [];

  const headers = values[0].map((h) => String(h ?? "").trim());
  const rows: BddRow[] = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const firstCell = row[0];
    if (firstCell == null || String(firstCell).trim() === "") continue;

    const record: Record<string, string | number> = {};
    headers.forEach((header, colIdx) => {
      if (!header) return; // unnamed trailing columns (e.g. W-AB on this sheet)
      // Live sheet has a duplicate header ("Technicien" appears at both the
      // real editable column and a mislabeled DATE_DS-formula column further
      // right) — keep the first occurrence so reads agree with
      // updateSheetRow()'s headers.indexOf(), which already resolves to the
      // first match.
      if (header in record) return;
      record[header] = formatCellValue(header, row[colIdx]);
    });
    record._row = i + 1; // absolute 1-based sheet row, for writeback targeting

    rows.push(record as unknown as BddRow);
  }

  return rows;
}

// ─── addBddRow ──────────────────────────────────────────────────────────────

// XLOOKUP/DATEDIF formulas, verbatim from a live spreadsheets.values.get()
// read of the BDD tab (valueRenderOption: FORMULA) — every column other than
// IMM and BDD_EDITABLE_FIELDS is a per-row formula referencing that row's own
// A{ROW} cell, not a whole-column ARRAYFORMULA. A newly appended row must get
// these written in explicitly (same reason Parking/Atelier/Depot's own
// FORMULAS maps exist) or these columns stay permanently blank -- Sheets
// doesn't auto-fill a formula into a row the API appends.
//
// "mois_restant"'s template hardcodes "N{ROW}" (not looked up via colMap)
// because that's what the live formula itself hardcodes -- N is
// date_fin_contrat's column letter in the sheet's current layout. This stays
// correct as long as the column order isn't restructured; if it ever is,
// every existing row's formula breaks too, not just newly-added ones.
const BDD_FORMULAS: Record<string, string> = {
  date: '=XLOOKUP(A{ROW};RL!D:D;RL!B:B;46422;0;1)',
  client: '=XLOOKUP(A{ROW};RL!D:D;RL!C:C;"INCONNU";0;1)',
  modele: '=XLOOKUP(A{ROW};parc!F:F;parc!E:E;"INCONNU";0;1)',
  "Reunion N-1": '=XLOOKUP(A{ROW};RL_reunion!A:A;RL_reunion!B:B;"";0;1)',
  mois_restant: '=IFERROR(DATEDIF(TODAY();N{ROW};"m");0)',
  date_fin_contrat: '=XLOOKUP(A{ROW};CP!G:G;CP!Q:Q;"";0;1)',
  lieu_Reparation: '=XLOOKUP(A{ROW};RL!D:D;RL!U:U;"";0;1)',
  Motif: '=XLOOKUP(A{ROW};RL!D:D;RL!S:S;"";0;1)',
  station_départ: '=XLOOKUP(A{ROW};RL!D:D;RL!N:N;"";0;1)',
  ds: '=XLOOKUP(A{ROW};ds!D:D;ds!C:C;"";0;-1)',
  date_ds: '=XLOOKUP(A{ROW};ds!D:D;ds!A:A;"";0;-1)',
  Parts: '=XLOOKUP(A{ROW};ds!D:D;ds!G:G;"";0;-1)',
  Technicein_ds: '=XLOOKUP(A{ROW};ds!D:D;ds!E:E;"";0;-1)',
  Founisseur: '=XLOOKUP(A{ROW};ds!D:D;ds!F:F;"";0;-1)',
  RDV: '=XLOOKUP(A{ROW};RDV!E:E;RDV!A:A;"";0;1)',
  CONVOYEUR: '=XLOOKUP(A{ROW};RDV!E:E;RDV!H:H;"";0;1)',
  Intervention: '=XLOOKUP(A{ROW};RDV!E:E;RDV!F:F;"";0;1)',
  ATELIER: '=XLOOKUP(A{ROW};ATELIER!A:A;ATELIER!A:A;"";0;1)',
  DEPOT: '=XLOOKUP(A{ROW};DEPOT!A:A;DEPOT!A:A;"";0;1)',
  PARKING: '=XLOOKUP(A{ROW};PARKING!A:A;PARKING!A:A;"";0;1)',
};

/**
 * Adds one genuinely new plate to BDD -- IMM + ETAT (both required; ETAT is
 * required because app/suivi-rl/page.tsx's default Flotte filter only shows
 * rows where ETAT is INTERNE or EXTERNE, so a blank-ETAT row would be
 * invisible even under "TOUS"), everything else left blank for later via the
 * existing inline-edit UI. All 20 XLOOKUP/DATEDIF formula columns are seeded
 * so they self-populate once matching DS/RL/RDV/CP/parc/etc. data exists,
 * same as Parking/Atelier/Depot's addPlates()/addAtelierPlates()/addDepotPlates().
 *
 * Unlike those three tabs, a plate already present in BDD is rejected
 * outright rather than "updated" (bumping some timestamp) -- BDD has no
 * TIMESTAMP-like column whose bump would mean anything, and silently
 * no-op'ing into an existing row would risk masking that the user meant to
 * add a genuinely different plate but mistyped.
 */
export async function addBddRow(imm: string, etat: string): Promise<ParkingAddResponse> {
  const token = (imm ?? "").trim();
  if (!token) {
    return { ok: false, error: "Aucune immatriculation saisie." };
  }
  const etatTrim = (etat ?? "").trim();
  if (!etatTrim) {
    return { ok: false, error: "ETAT est obligatoire." };
  }

  const sheets = getSheetsClient();
  const headers = await getHeaderRow(sheets);
  const colMap = buildColMap(headers);
  const immCol = colMap["IMM"];
  const etatCol = colMap["ETAT"];
  if (!immCol) throw new Error(`Column 'IMM' not found in the live '${BDD_TAB_NAME}' header row`);
  if (!etatCol) throw new Error(`Column 'ETAT' not found in the live '${BDD_TAB_NAME}' header row`);

  const dataRes = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId!,
    range: `'${BDD_TAB_NAME}'!A2:${HEADER_SCAN_WIDTH}`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const dataRows = dataRes.data.values ?? [];

  const existingSet = new Set<string>();
  dataRows.forEach((row) => {
    const raw = row[immCol - 1];
    const val = raw != null ? String(raw).trim().toUpperCase() : "";
    if (val) existingSet.add(val);
  });

  // Resolved before any grid mutation below: if Mongo is unavailable,
  // getIMMListSafe() degrades to [] instead of throwing mid-mutation and
  // leaving the sheet grown with no data written into the new row.
  const immList = await getIMMListSafe();
  const resolved = resolveIMM(token, immList) || token.trim().toUpperCase();
  const inParc = immList.includes(resolved);

  if (existingSet.has(resolved)) {
    return { ok: false, error: `${resolved} existe déjà dans BDD.` };
  }

  const targetRow = dataRows.length + 2; // row 1 is the header row, data starts at row 2
  const props = await getBddSheetProps(sheets);
  const gridShortfall = targetRow - props.rowCount;
  if (gridShortfall > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: spreadsheetId!,
      requestBody: {
        requests: [{ appendDimension: { sheetId: props.sheetId, dimension: "ROWS", length: gridShortfall } }],
      },
    });
  }

  const writes: { range: string; values: (string | number)[][] }[] = [
    { range: `'${BDD_TAB_NAME}'!${columnIndexToLetter(immCol)}${targetRow}`, values: [[resolved]] },
    { range: `'${BDD_TAB_NAME}'!${columnIndexToLetter(etatCol)}${targetRow}`, values: [[etatTrim]] },
  ];

  for (const [field, template] of Object.entries(BDD_FORMULAS)) {
    const col = colMap[field];
    if (!col) continue;
    writes.push({
      range: `'${BDD_TAB_NAME}'!${columnIndexToLetter(col)}${targetRow}`,
      values: [[template.replace(/\{ROW\}/g, String(targetRow))]],
    });
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: spreadsheetId!,
    requestBody: { valueInputOption: "USER_ENTERED", data: writes },
  });
  invalidateCache(ROWS_CACHE_KEY);

  return { ok: true, results: [{ imm: resolved, status: "added", inParc }] };
}

/**
 * Writes `updates` to the given sheet row. Only fields in BDD_EDITABLE_FIELDS
 * are ever accepted — anything else is rejected outright (the whole call
 * fails, nothing partial-writes), and the rejected field names are returned
 * so the caller gets an honest answer instead of a silent no-op.
 *
 * `expectedImm` is required and checked via verifyRowIdentity() before the
 * write — same guard every other write path in this app already has
 * (Parking/Atelier/Depot's update+delete, this file's own deleteBddRow).
 * Without it, a client-held `row` that's gone stale (another delete
 * renumbered the sheet since this browser tab last loaded, and TanStack
 * Query's persisted cache + refetchOnWindowFocus:false means that can
 * survive a tab switch or reload) would silently write into a different
 * vehicle's row.
 */
export async function updateSheetRow(
  row: number,
  updates: Record<string, string>,
  expectedImm: string
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

  const immColIdx = headers.indexOf("IMM"); // 0-based
  if (immColIdx === -1) {
    throw new Error("Column 'IMM' not found in the live BDD sheet header row");
  }

  await verifyRowIdentity(
    sheets,
    spreadsheetId!,
    `'${BDD_TAB_NAME}'!${columnIndexToLetter(immColIdx + 1)}${row}`,
    expectedImm
  );

  // One atomic batchUpdate covering every field, not N independent
  // values.update() calls — matches Parking/Atelier/Depot/RDV's pattern.
  // Previously this was a Promise.all of separate requests, which could
  // partially succeed (e.g. field 2 of 3 written, field 3 failing on a
  // transient error) and leave the row in a mixed state; a single request
  // either fully succeeds or fully fails.
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: spreadsheetId!,
    requestBody: {
      valueInputOption: "RAW",
      data: requestedFields.map((field) => {
        const colIdx = headers.indexOf(field); // 0-based
        const colLetter = columnIndexToLetter(colIdx + 1);
        return {
          range: `'${BDD_TAB_NAME}'!${colLetter}${row}`,
          values: [[updates[field]]],
        };
      }),
    },
  });
  invalidateCache(ROWS_CACHE_KEY);

  return { ok: true, written: requestedFields };
}

/**
 * Genuinely deletes the row (Sheets "delete row" — DeleteDimensionRequest),
 * shifting every row below it up by one — same mechanism as
 * googleSheetsParking.ts's deletePlate()/Atelier's/Depot's equivalents.
 * verifyRowIdentity() runs first so a client-held `row` that's gone stale
 * (another delete renumbered the sheet since the client last loaded) is
 * refused with a 409 rather than deleting the wrong vehicle's row.
 */
export async function deleteBddRow(row: number, expectedImm: string): Promise<void> {
  const sheets = getSheetsClient();
  const headers = await getHeaderRow(sheets);
  const immColIdx = headers.indexOf("IMM"); // 0-based
  if (immColIdx === -1) {
    throw new Error("Column 'IMM' not found in the live BDD sheet header row");
  }

  await verifyRowIdentity(
    sheets,
    spreadsheetId!,
    `'${BDD_TAB_NAME}'!${columnIndexToLetter(immColIdx + 1)}${row}`,
    expectedImm
  );

  const { sheetId } = await getBddSheetProps(sheets);

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: spreadsheetId!,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: { sheetId, dimension: "ROWS", startIndex: row - 1, endIndex: row },
          },
        },
      ],
    },
  });
  invalidateCache(ROWS_CACHE_KEY);
}
