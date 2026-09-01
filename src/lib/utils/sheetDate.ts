/**
 * dd/mm/yyyy ⇄ yyyy-mm-dd.
 *
 * The BDD reader renders every DATE_LIKE_HEADERS column as dd/mm/yyyy
 * (fmtDateOnlySlash — this feature's spec, matching the old GAS output), but
 * `<input type="date">` only accepts and emits yyyy-mm-dd. These two sit
 * between them. Kept out of src/lib/utils/format.ts on purpose: that file's
 * fmtDate is the app-wide yyyy-mm-dd formatter, and conflating the two shapes
 * is exactly the confusion this pair exists to prevent.
 */

/** dd/mm/yyyy → yyyy-mm-dd. Returns "" for anything not that exact shape —
 *  including a blank cell, and including a value that is already ISO. */
export function displayDateToIso(display: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((display ?? "").trim());
  if (!m) return /^\d{4}-\d{2}-\d{2}$/.test((display ?? "").trim()) ? display.trim() : "";
  const [, d, mo, y] = m;
  return `${y}-${mo}-${d}`;
}
