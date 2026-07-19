import { google, type sheets_v4 } from "googleapis";
import { buildPlateVariants } from "@/lib/plateVariants";

// Reads the "RL" tab (véhicule de remplacement / replacement-vehicle data)
// via the authenticated service-account Sheets API — replacing the
// gviz-based public fetch app/api/sheet/route.ts used to make directly.
// Tab name and column list confirmed by a live spreadsheets.values.get()
// read (gid=1827846977, 1000 rows x 26 cols) — not a guess.

const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
if (!spreadsheetId) throw new Error("Missing GOOGLE_SHEETS_ID in .env.local");

const keyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64;
if (!keyB64) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_KEY_B64 in .env.local");

const RL_TAB_NAME = "RL";

// The tab has 26 real columns but only these are surfaced — matches the
// original gviz-era RL_COLUMNS allowlist in app/api/sheet/route.ts exactly
// (all 10 names confirmed present verbatim in the live header row).
const RL_COLUMNS = [
  "Reference",
  "Date",
  "Client",
  "Immatriculation_a_remplacer",
  "Modèle_a_remplacer",
  "Immatriculation_remplacement",
  "Modèle_remplacement",
  "Date début",
  "Motif",
  "Téléphone",
] as const;

export type RlRow = Record<(typeof RL_COLUMNS)[number], string>;

// "Date" and "Date début" are Sheets date-serial numbers under
// UNFORMATTED_VALUE (confirmed live) — the old gviz endpoint pre-formatted
// these via its own "formatted value" field, which this render option
// doesn't provide, so they're converted explicitly here instead of being
// left as raw numbers like "46222".
const DATE_LIKE_COLUMNS = new Set<(typeof RL_COLUMNS)[number]>(["Date", "Date début"]);

function serialToDDMMYYYY(serial: number): string {
  const epochMs = Date.UTC(1899, 11, 30);
  const ms = epochMs + Math.round(serial) * 86400000;
  const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

declare global {
  // Shared with lib/googleSheetsBdd.ts, lib/googleSheetsParking.ts, and
  // lib/googleSheetsAtelier.ts — same global slot, same singleton.
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

/**
 * Reads every non-empty row from the RL tab, projected down to
 * RL_COLUMNS, optionally filtered to rows where either
 * Immatriculation_a_remplacer or Immatriculation_remplacement matches any
 * WW-prefix/suffix variant of `immFilter` — same OR-match behavior the
 * gviz-era route had. 1,000 rows is cheap enough to read in full and filter
 * server-side in JS, same pattern as lib/googleSheetsBdd.ts.
 */
export async function getRlRows(immFilter?: string): Promise<RlRow[]> {
  const sheets = getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId!,
    range: `'${RL_TAB_NAME}'!A1:Z`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const values = res.data.values ?? [];
  if (values.length === 0) return [];

  const headers = values[0].map((h) => String(h ?? "").trim());
  const colIndexByName = new Map<string, number>();
  headers.forEach((h, i) => {
    if (RL_COLUMNS.includes(h as (typeof RL_COLUMNS)[number])) colIndexByName.set(h, i);
  });

  const rows: RlRow[] = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const isBlank = row.every((c) => c == null || String(c).trim() === "");
    if (isBlank) continue;

    const record = {} as RlRow;
    for (const col of RL_COLUMNS) {
      const idx = colIndexByName.get(col);
      const v = idx != null ? row[idx] : undefined;
      if (v != null && DATE_LIKE_COLUMNS.has(col) && typeof v === "number") {
        record[col] = serialToDDMMYYYY(v);
      } else {
        record[col] = v != null ? String(v) : "";
      }
    }
    rows.push(record);
  }

  if (!immFilter) return rows;

  const variants = new Set(buildPlateVariants(immFilter));
  return rows.filter(
    (r) =>
      variants.has(r["Immatriculation_a_remplacer"]?.trim().toUpperCase() ?? "") ||
      variants.has(r["Immatriculation_remplacement"]?.trim().toUpperCase() ?? "")
  );
}
