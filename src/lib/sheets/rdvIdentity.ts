import type { RdvAddInput, RdvEditableField } from "@/types";

/**
 * Shared by both src/lib/sheets/googleSheetsRdv.ts (flat tab) and
 * src/lib/sheets/googleSheetsRdvMonthly.ts (monthly tab) — every edit/clear operation
 * re-resolves its target row fresh, by content match, never by trusting a
 * row number captured from an earlier read. The monthly tab's fallback
 * insertDimension path can shift rows at any time; a cached row number for
 * that tab can go stale between page-load and a later edit with no warning.
 */
export class RdvIdentityError extends Error {
  constructor(
    message: string,
    public readonly kind: "not_found" | "ambiguous"
  ) {
    super(message);
  }
}

/**
 * RdvAddInput's own field keys, in per-row comparison order. Date is
 * deliberately excluded here — it anchors which day's candidates get
 * considered (via findDayBlock in the monthly tab, or a same-serial filter
 * in the flat tab) rather than being part of the row-content comparison.
 */
export const IDENTITY_FIELD_ORDER = [
  "heure",
  "clients",
  "vehicule",
  "matricule",
  "intervention",
  "contact",
  "convoyeur",
] as const satisfies readonly (keyof RdvAddInput)[];

type IdentityField = (typeof IDENTITY_FIELD_ORDER)[number];

/** 0-based column index within an A:H row array. */
const COL_INDEX: Record<IdentityField, number> = {
  heure: 1,
  clients: 2,
  vehicule: 3,
  matricule: 4,
  intervention: 5,
  contact: 6,
  convoyeur: 7,
};

/** Maps the sheet-header-styled field name (RdvEditableField, e.g. "CONVOYEUR") to RdvAddInput's own lowercase key. */
export const EDITABLE_TO_INPUT_KEY: Record<RdvEditableField, keyof RdvAddInput> = {
  Date: "date",
  Heure: "heure",
  Clients: "clients",
  "Véhicule": "vehicule",
  Matricule: "matricule",
  Intervention: "intervention",
  Contact: "contact",
  CONVOYEUR: "convoyeur",
};

/**
 * Collapses tabs/newlines/repeated spaces to one space and trims — makes
 * the flat tab's existing read-time cleanup (strOrEmpty() in
 * src/lib/sheets/googleSheetsRdv.ts) and the monthly tab's raw, uncleaned cell content
 * comparable regardless of which one produced a given snapshot value.
 */
function normalizeText(v: unknown): string {
  return String(v ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizedInputValue(input: RdvAddInput, field: IdentityField): string {
  const norm = normalizeText(input[field]);
  return field === "matricule" ? norm.toUpperCase() : norm;
}

function normalizedRowValue(row: unknown[], field: IdentityField): string {
  const norm = normalizeText(row[COL_INDEX[field]]);
  return field === "matricule" ? norm.toUpperCase() : norm;
}

/**
 * True if every identity field matches — excludeField (the one an update
 * is about to overwrite) is skipped, since a field can't be part of its own
 * pre-write identity check.
 */
function rowMatchesIdentity(row: unknown[], snapshot: RdvAddInput, excludeField?: keyof RdvAddInput): boolean {
  for (const field of IDENTITY_FIELD_ORDER) {
    if (field === excludeField) continue;
    if (normalizedInputValue(snapshot, field) !== normalizedRowValue(row, field)) return false;
  }
  return true;
}

/**
 * Scans candidate rows (already narrowed to the right date/block by the
 * caller) for identity matches. Zero matches is a normal, expected outcome
 * for a pure lookup — the caller decides what "not found" means for its own
 * operation — so this returns null rather than throwing. More than one
 * match is never safe to guess between (never returns a "closest match"),
 * so that case still throws RdvIdentityError. `rowNumbers[i]` must be the
 * 1-based sheet row `candidateRows[i]` came from.
 */
export function resolveUniqueMatch(
  candidateRows: unknown[][],
  rowNumbers: number[],
  snapshot: RdvAddInput,
  excludeField: keyof RdvAddInput | undefined,
  tabLabel: string
): number | null {
  const matches = candidateRows
    .map((row, i) => ({ row, rowNum: rowNumbers[i] }))
    .filter(({ row }) => rowMatchesIdentity(row, snapshot, excludeField));

  if (matches.length === 0) {
    return null;
  }
  if (matches.length > 1) {
    throw new RdvIdentityError(
      `${matches.length} rendez-vous correspondent à ces critères dans "${tabLabel}" — impossible de déterminer lequel modifier en toute sécurité (cela arrive quand deux rendez-vous sont identiques à l'exception du champ modifié).`,
      "ambiguous"
    );
  }
  return matches[0].rowNum;
}
