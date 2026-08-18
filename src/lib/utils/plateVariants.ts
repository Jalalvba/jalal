/**
 * Generates alternate forms of a plate/WW token for matching against sheet
 * data that may store the "WW" variant with or without the WW prefix/suffix
 * (e.g. "980874WW" vs "WW980874" vs "980874"). Ported verbatim from the
 * buildVariants() helper originally inline in app/api/sheet/route.ts —
 * extracted here so lib/googleSheetsBdd.ts, lib/googleSheetsRl.ts, and the
 * route itself can all share it instead of duplicating it.
 */
export function buildPlateVariants(val: string): string[] {
  const q = val.trim().toUpperCase();
  const variants = [q];
  if (q.endsWith("WW")) {
    const n = q.slice(0, -2);
    variants.push("WW" + n, n);
  }
  if (q.startsWith("WW")) {
    const n = q.slice(2);
    variants.push(n + "WW", n);
  }
  return variants;
}
