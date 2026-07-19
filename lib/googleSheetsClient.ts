import { google, type sheets_v4 } from "googleapis";

const keyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64;
if (!keyB64) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_KEY_B64 in .env.local");

declare global {
  // Needed to prevent creating a new client on every hot-reload in dev.
  // Shared by every lib/googleSheets*.ts file — same global slot, same
  // singleton, so they all reuse one authenticated client instead of each
  // opening their own.
  var _sheetsClient: sheets_v4.Sheets | undefined;
}

/**
 * Extracted from 5 near-identical copies (lib/googleSheetsBdd.ts,
 * googleSheetsParking.ts, googleSheetsAtelier.ts, googleSheetsRl.ts,
 * googleSheetsImport.ts) — confirmed byte-identical before merging, not a
 * guess.
 *
 * Uses googleapis' own re-exported auth.JWT (not the standalone
 * google-auth-library package) so the auth client and google.sheets() agree
 * on the same class instance — googleapis bundles its own pinned version of
 * google-auth-library internally, which is structurally incompatible with
 * the separately-installed top-level package despite near-identical versions.
 */
export function getSheetsClient(): sheets_v4.Sheets {
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

// ─── Sheets serial date/time helpers (UTC-based) ──────────────────────────

const SHEETS_EPOCH_MS = Date.UTC(1899, 11, 30);

/**
 * Converts a Sheets serial-date number to a UTC Date, splitting whole days
 * from the fractional (time-of-day) component before converting — this
 * preserves sub-day precision for datetime values (e.g. Parking/Atelier's
 * TIMESTAMP, Import's DatePrestation). For genuine date-only columns
 * (BDD's date/date_ds/date_fin_contrat, RL's Date/Date début — confirmed
 * live to always be whole numbers, with RL's own gviz metadata declaring
 * them type "date" not datetime) this produces identical output to the
 * simpler "round the whole serial" approach those two files used before
 * this extraction, since floor(N) == round(N) for any whole number N.
 */
export function serialToUTCDate(serial: number): Date {
  const wholeDays = Math.floor(serial);
  const fractionalMs = Math.round((serial - wholeDays) * 86400000);
  return new Date(SHEETS_EPOCH_MS + wholeDays * 86400000 + fractionalMs);
}

/** Current moment as a Sheets serial number, for writing a "now" timestamp. */
export function nowToSerial(): number {
  return (Date.now() - SHEETS_EPOCH_MS) / 86400000;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** dd/MM/yyyy — date only, slash-separated. Used by BDD, RL, Import. */
export function fmtDateOnlySlash(d: Date): string {
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/**
 * dd-MM-yyyy — date only, dash-separated. Not interchangeable with
 * fmtDateOnlySlash: Parking's "meta" field specifically needs dashes,
 * matching the ported GAS system's own formatting.
 */
export function fmtDateOnlyDash(d: Date): string {
  return `${pad2(d.getUTCDate())}-${pad2(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
}

/** dd/MM/yyyy HH:mm:ss — full datetime, slash-separated. */
export function fmtDateTime(d: Date): string {
  return `${fmtDateOnlySlash(d)} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(
    d.getUTCSeconds()
  )}`;
}
