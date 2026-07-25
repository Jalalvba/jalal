import { getSheetsClient } from "@/lib/googleSheetsClient";

// Tab name, gid (1365327220) and header row confirmed by a live
// spreadsheets.get()/values.get() read — not a guess. Same spreadsheet as
// PARKING/ATELIER/BDD/RDV. Structurally near-identical to PARKING (IMM,
// TIMESTAMP, ACTION, plus the same 9 read-only XLOOKUP columns), but only
// existence-checked here — no other feature is needed for this tab, so
// this file deliberately stays a single function instead of a full
// read/write module like Parking/Atelier/RDV got.

const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEETS_ID in .env.local");

const DEPOT_TAB = "DEPOT";
const HEADER_RANGE_WIDTH = "O"; // 15 real columns, confirmed live

function buildColMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((h, i) => {
    if (h) map[h] = i + 1; // 1-based
  });
  return map;
}

/**
 * Every non-blank IMM value currently in the DEPOT tab, uppercased —
 * existence-check only for the zone-badge feature, no other column is read.
 */
export async function getDepotPlates(): Promise<string[]> {
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
  const immCol = colMap["IMM"] ?? 1;

  const plates: string[] = [];
  for (let i = 1; i < values.length; i++) {
    const raw = values[i][immCol - 1];
    const imm = raw != null ? String(raw).trim().toUpperCase() : "";
    if (imm) plates.push(imm);
  }
  return plates;
}
