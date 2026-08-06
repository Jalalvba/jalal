import { getCollection } from "@/lib/mongo";
import { withCache, invalidateCache } from "@/lib/googleSheetsClient";
import {
  OPTION_KEYS,
  COLORED_OPTION_KEYS,
  PALETTE_COLORS,
  EMPLACEMENT_OPTIONS_FALLBACK,
  ETAT_OPTIONS_FALLBACK,
  FLAG_OPTIONS_FALLBACK,
  CATEGORIE_OPTIONS_FALLBACK,
  TECHNICIEN_OPTIONS_FALLBACK,
  PRESTATAIRE_OPTIONS_FALLBACK,
  RDV_CONVOYEURS_FALLBACK,
  OPTION_LABELS,
  type OptionKey,
  type ColoredOption,
  type AllSheetFieldOptions,
} from "@/lib/types";

// Stage 1 of the config-driven sheet-structure proposal (config-proposal
// artifact, 2026-08-06): only dropdown OPTION VALUES move here. Headers,
// BddRow's TypeScript shape, and BDD_EDITABLE_FIELDS are untouched — still
// hardcoded in lib/types.ts, deliberately out of scope for this stage.

const COLLECTION = "sheetFieldOptions";
const CACHE_KEY = "sheetFieldOptions:all";
// Options change on the order of "once every few weeks", same reasoning
// lib/googleSheetsBdd.ts's 5min header cache already uses — this mirrors
// that TTL rather than inventing a different one.
const CACHE_TTL_MS = 5 * 60_000;

export { OPTION_LABELS };

type PlainOptionsDoc = {
  _id: OptionKey;
  key: OptionKey;
  label: string;
  type: "plain";
  options: string[];
  updatedAt: Date;
  updatedBy: string;
};

type ColoredOptionsDoc = {
  _id: OptionKey;
  key: OptionKey;
  label: string;
  type: "colored";
  options: ColoredOption[];
  updatedAt: Date;
  updatedBy: string;
};

export type SheetFieldOptionsDoc = PlainOptionsDoc | ColoredOptionsDoc;

function isColoredKey(key: OptionKey): boolean {
  return (COLORED_OPTION_KEYS as readonly OptionKey[]).includes(key);
}

// Exactly what was live in the app immediately before this migration —
// scripts/seed-sheet-field-options.ts inserts this same object's values as
// the initial Mongo documents, and getAllSheetFieldOptions() below degrades
// to it key-by-key if Mongo has no document yet (or is unreachable).
const FALLBACK: AllSheetFieldOptions = {
  EMPLACEMENT_OPTIONS: EMPLACEMENT_OPTIONS_FALLBACK,
  ETAT_OPTIONS: ETAT_OPTIONS_FALLBACK,
  FLAG_OPTIONS: FLAG_OPTIONS_FALLBACK,
  CATEGORIE_OPTIONS: CATEGORIE_OPTIONS_FALLBACK,
  TECHNICIEN_OPTIONS: TECHNICIEN_OPTIONS_FALLBACK,
  PRESTATAIRE_OPTIONS: PRESTATAIRE_OPTIONS_FALLBACK,
  RDV_CONVOYEURS: [...RDV_CONVOYEURS_FALLBACK],
};

export function getFallbackOptions(): AllSheetFieldOptions {
  return FALLBACK;
}

/**
 * Reads every option-set from Mongo in one query, cached via the same
 * withCache/invalidateCache primitive lib/googleSheetsClient.ts already
 * exports for Sheets header caching — it's a generic Next unstable_cache
 * wrapper keyed by a caller-chosen string, not actually Sheets-specific,
 * so this reuses it directly rather than duplicating the same 15 lines
 * under a new name.
 *
 * Falls back to the hardcoded FALLBACK constant above, key by key, if a
 * given key has no document yet (e.g. before the seed script has run) or if
 * Mongo is unreachable entirely — an admin-config outage degrades to
 * "dropdowns serve their last-known-good hardcoded values," never to a page
 * that can't render.
 */
export async function getAllSheetFieldOptions(): Promise<AllSheetFieldOptions> {
  try {
    return await withCache(CACHE_KEY, CACHE_TTL_MS, async () => {
      const col = await getCollection<SheetFieldOptionsDoc>(COLLECTION);
      const docs = await col.find({}).toArray();
      const byKey = new Map(docs.map((d) => [d.key, d]));

      const result = { ...FALLBACK };
      for (const key of OPTION_KEYS) {
        const doc = byKey.get(key);
        if (!doc) continue; // no document for this key yet -> keep its fallback
        (result as unknown as Record<OptionKey, unknown>)[key] = doc.options;
      }
      return result;
    });
  } catch (e) {
    console.error("getAllSheetFieldOptions: Mongo unreachable, serving hardcoded fallback", e);
    return FALLBACK;
  }
}

export class OptionsValidationError extends Error {}

function validatePlain(options: string[]): void {
  if (options.length === 0) throw new OptionsValidationError("La liste ne peut pas être vide.");
  const seen = new Set<string>();
  for (const raw of options) {
    const v = raw.trim();
    if (!v) throw new OptionsValidationError("Une valeur ne peut pas être vide.");
    if (seen.has(v)) throw new OptionsValidationError(`Valeur en double : "${v}".`);
    seen.add(v);
  }
}

function validateColored(options: ColoredOption[]): void {
  if (options.length === 0) throw new OptionsValidationError("La liste ne peut pas être vide.");
  const seen = new Set<string>();
  for (const { value, color } of options) {
    const v = (value ?? "").trim();
    if (!v) throw new OptionsValidationError("Une valeur ne peut pas être vide.");
    if (seen.has(v)) throw new OptionsValidationError(`Valeur en double : "${v}".`);
    seen.add(v);
    if (color !== null && !(PALETTE_COLORS as readonly string[]).includes(color)) {
      throw new OptionsValidationError(`Couleur invalide pour "${v}" : "${color}".`);
    }
  }
}

export type UpdateOptionsInput =
  | { key: Exclude<OptionKey, "FLAG_OPTIONS" | "PRESTATAIRE_OPTIONS">; options: string[] }
  | { key: "FLAG_OPTIONS" | "PRESTATAIRE_OPTIONS"; options: ColoredOption[] };

/**
 * Validates and writes one whole option-set (the admin UI always saves a
 * full replace of a set, not a per-item patch — simpler and matches how
 * small these lists are, 5-20 entries each). invalidateCache() runs after a
 * successful write so the very next read anywhere in the app — same
 * instance or a different warm one — sees the change immediately instead of
 * waiting out CACHE_TTL_MS.
 */
export async function updateFieldOptions(input: UpdateOptionsInput, updatedBy: string): Promise<void> {
  if (!(OPTION_KEYS as readonly string[]).includes(input.key)) {
    throw new OptionsValidationError(`Clé inconnue : "${input.key}".`);
  }
  const colored = isColoredKey(input.key);
  if (colored) validateColored(input.options as ColoredOption[]);
  else validatePlain(input.options as string[]);

  const doc: SheetFieldOptionsDoc = colored
    ? {
        _id: input.key,
        key: input.key,
        label: OPTION_LABELS[input.key],
        type: "colored",
        options: input.options as ColoredOption[],
        updatedAt: new Date(),
        updatedBy,
      }
    : {
        _id: input.key,
        key: input.key,
        label: OPTION_LABELS[input.key],
        type: "plain",
        options: input.options as string[],
        updatedAt: new Date(),
        updatedBy,
      };

  const col = await getCollection<SheetFieldOptionsDoc>(COLLECTION);
  await col.updateOne({ _id: input.key }, { $set: doc }, { upsert: true });
  invalidateCache(CACHE_KEY);
}
