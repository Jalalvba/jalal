import { google, type sheets_v4 } from "googleapis";
import { unstable_cache, revalidateTag } from "next/cache";
import { ApiError } from "@/lib/http/apiError";

const keyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64;
if (!keyB64) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_KEY_B64 in .env.local");

declare global {
  // Needed to prevent creating a new client on every hot-reload in dev.
  // Shared by every src/lib/sheets/googleSheets*.ts file — same global slot, same
  // singleton, so they all reuse one authenticated client instead of each
  // opening their own.
  var _sheetsClient: sheets_v4.Sheets | undefined;
}

/**
 * Cached Sheets read, keyed by caller-chosen string (e.g. "rows:PARKING",
 * "headers:BDD"). Backed by Next's Data Cache (unstable_cache) rather than a
 * plain in-process Map: on Vercel this is shared across warm serverless
 * instances, so invalidateCache() below actually propagates everywhere
 * instead of only clearing whichever instance happened to handle the write.
 * Exists because the Sheets API has no server-side row filter — every
 * getXRows() already reads the full tab, and without this, four independent
 * tabs (useVehicleZone's Parking/Atelier/RDV/Depot fan-out) or a handful of
 * quick mutations (each of which also reads headers + a full data range
 * before writing) can burn through the 60 req/min per-service-account quota
 * fast for what a human perceives as one action.
 */
export async function withCache<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const cached = unstable_cache(fn, [key], { tags: [key], revalidate: Math.ceil(ttlMs / 1000) });
  return cached();
}

/**
 * Called by a tab's own mutation functions right after a successful write, so
 * the next read isn't served stale cached data for the rest of the TTL
 * window — propagates to every warm instance, not just the one handling the
 * write. `{ expire: 0 }` forces the same immediate full revalidation Next 16
 * would otherwise only apply when the (now-required) profile argument is
 * omitted entirely — passing it explicitly avoids the deprecation warning
 * while keeping the same "next read is guaranteed fresh" behavior.
 */
export function invalidateCache(key: string): void {
  revalidateTag(key, { expire: 0 });
}

// ─── Retry with exponential backoff + full jitter ─────────────────────────

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function getStatus(err: unknown): number | undefined {
  const e = err as { code?: number; response?: { status?: number } };
  return e.response?.status ?? e.code;
}

/**
 * Google's own API surface offers no built-in retry (gaxios only retries
 * when explicitly opted in per-request, which nothing here does), so a
 * transient 429/500/502/503/504 currently throws straight out to the
 * caller — a normal Google-side hiccup becomes a hard user-facing failure,
 * and worse, can abort a multi-step mutation (e.g. addPlates()'s
 * appendDimension-then-write sequence) partway through, leaving orphaned
 * blank rows. Full jitter (backoff * random(0,1), not backoff ± jitter)
 * avoids every retrying caller waking up in lockstep.
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 4, baseDelayMs = 300): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = getStatus(err);
      if (!status || !RETRYABLE_STATUS.has(status) || attempt >= maxRetries) throw err;
      const backoff = baseDelayMs * 2 ** attempt;
      const jitter = Math.random() * backoff;
      await new Promise((r) => setTimeout(r, jitter));
    }
  }
}

/**
 * Wraps the finite, known set of Sheets methods this codebase actually calls
 * (confirmed via grep across src/lib/sheets/googleSheets*.ts — nothing else is used)
 * with withRetry, once, here — so every existing call site in the 5 helper
 * files gets retry behavior for free, with zero changes to those files.
 *
 * googleapis' generated methods are heavily overloaded (params-based,
 * streaming, and callback-style call signatures on the same property), which
 * doesn't unify into a single generic function type — reassigning through an
 * `any` bridge is the pragmatic way to wrap them without fighting those
 * generated overloads; the actual runtime behavior (params in, Promise out)
 * is exactly what every call site here already uses.
 */
function wrapWithRetry(sheets: sheets_v4.Sheets): sheets_v4.Sheets {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- bridging past googleapis' overloaded generated types, see comment above
  const wrap = (fn: (...args: any[]) => Promise<unknown>, ctx: unknown) =>
    (...args: unknown[]) => withRetry(() => fn.apply(ctx, args));

  const s = sheets as unknown as {
    spreadsheets: { get: unknown; batchUpdate: unknown; values: { get: unknown; update: unknown; batchUpdate: unknown; batchClear: unknown } };
  };

  s.spreadsheets.get = wrap(sheets.spreadsheets.get, sheets.spreadsheets);
  s.spreadsheets.batchUpdate = wrap(sheets.spreadsheets.batchUpdate, sheets.spreadsheets);
  s.spreadsheets.values.get = wrap(sheets.spreadsheets.values.get, sheets.spreadsheets.values);
  s.spreadsheets.values.update = wrap(sheets.spreadsheets.values.update, sheets.spreadsheets.values);
  s.spreadsheets.values.batchUpdate = wrap(sheets.spreadsheets.values.batchUpdate, sheets.spreadsheets.values);
  s.spreadsheets.values.batchClear = wrap(sheets.spreadsheets.values.batchClear, sheets.spreadsheets.values);
  return sheets;
}

// ─── Row-identity guard ────────────────────────────────────────────────────

/**
 * Thrown by verifyRowIdentity() below. Extends ApiError (status 409) rather
 * than plain Error so route handlers using src/lib/http/apiError.ts's
 * toErrorResponse() automatically show its message and 409 status with no
 * per-route special-casing — previously every route calling
 * verifyRowIdentity()'s callers had their own `instanceof RowIdentityError`
 * check duplicated inline.
 */
export class RowIdentityError extends ApiError {
  constructor(message: string) {
    super(message, 409);
  }
}

/**
 * Parking/Atelier/Depot's delete functions issue a real Sheets row deletion
 * (deleteDimension), which shifts every row below it up by one. Nothing
 * previously re-checked that a client-supplied `rowIndex` still refers to
 * the same logical row (by plate) at write time — if a delete elsewhere
 * shifted rows between the moment a browser tab loaded its data and the
 * moment it submits an edit/delete against a `rowIndex` it captured earlier,
 * that write would silently land on a different vehicle's row. This does a
 * cheap single-cell read of the row's key column (IMM, or Matricule for RDV)
 * and throws RowIdentityError on any mismatch, rather than writing blind.
 */
export async function verifyRowIdentity(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  cellRange: string,
  expected: string
): Promise<void> {
  const expectedNorm = expected.trim().toUpperCase();
  if (!expectedNorm) throw new RowIdentityError("Missing or invalid expected row-identity value.");

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: cellRange,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const actual = String(res.data.values?.[0]?.[0] ?? "").trim().toUpperCase();

  if (actual !== expectedNorm) {
    throw new RowIdentityError(
      `This row has changed since you loaded it (expected "${expected}", found "${actual || "(empty)"}"). Refresh the page and try again.`
    );
  }
}

/**
 * Extracted from 5 near-identical copies (src/lib/sheets/googleSheetsBdd.ts,
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

  global._sheetsClient = wrapWithRetry(google.sheets({ version: "v4", auth }));
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

/** Any UTC moment as a Sheets serial number, for writing a date/timestamp. */
export function dateToSerial(d: Date): number {
  return (d.getTime() - SHEETS_EPOCH_MS) / 86400000;
}

/** Current moment as a Sheets serial number, for writing a "now" timestamp. */
export function nowToSerial(): number {
  return dateToSerial(new Date());
}

/**
 * Parses a "yyyy-mm-dd" date-only string (the value shape an HTML
 * `<input type="date">` produces) into a whole-day Sheets serial number, for
 * writing a real date value (not text) into a date column — e.g. RDV's Date
 * field. Returns null if the string isn't that exact shape.
 */
export function isoDateToSerial(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  return dateToSerial(new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d))));
}

/**
 * 1-based column index to spreadsheet column letter(s), e.g. 1 → "A",
 * 27 → "AA". Moved here from src/lib/sheets/googleSheetsRdv.ts once
 * src/lib/sheets/googleSheetsRdvMonthly.ts needed the same conversion.
 */
export function columnIndexToLetter(oneBasedIndex: number): string {
  let n = oneBasedIndex;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
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
