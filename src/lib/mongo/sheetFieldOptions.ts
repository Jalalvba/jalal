import { getCollection } from "@/lib/mongo/client";
import { withCache, invalidateCache } from "@/lib/sheets/googleSheetsClient";
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
} from "@/types";

// Stage 1 of the config-driven sheet-structure proposal (config-proposal
// artifact, 2026-08-06): only dropdown OPTION VALUES move here. Headers,
// BddRow's TypeScript shape, and BDD_EDITABLE_FIELDS are untouched — still
// hardcoded in src/types/index.ts, deliberately out of scope for this stage.

const COLLECTION = "sheetFieldOptions";
const CACHE_KEY = "sheetFieldOptions:all";
// Options change on the order of "once every few weeks", same reasoning
// src/lib/sheets/googleSheetsBdd.ts's 5min header cache already uses — this mirrors
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

/** Deep clone — FALLBACK's arrays/objects must never be handed out by reference, since a caller mutating its own "copy" would otherwise corrupt the process-wide fallback every other request also serves. */
function cloneFallback(): AllSheetFieldOptions {
  return JSON.parse(JSON.stringify(FALLBACK)) as AllSheetFieldOptions;
}

export function getFallbackOptions(): AllSheetFieldOptions {
  return cloneFallback();
}

/** Per-key last-write timestamp, ISO 8601, or null if that key has no Mongo document yet (still serving its hardcoded fallback). Lets a client detect "the value I'm about to overwrite already changed since I read it" — see updateFieldOptions()'s expectedUpdatedAt param. */
export type SheetFieldOptionsMeta = Record<OptionKey, string | null>;

export type SheetFieldOptionsResult = {
  options: AllSheetFieldOptions;
  /** True only when Mongo itself was unreachable for this read (the whole collection fell back) — NOT true for the normal "this one key has no document yet" per-key fallback, which is expected pre-seed behavior, not an outage. */
  degraded: boolean;
  meta: SheetFieldOptionsMeta;
};

/**
 * Reads every option-set from Mongo in one query, cached via the same
 * withCache/invalidateCache primitive src/lib/sheets/googleSheetsClient.ts already
 * exports for Sheets header caching — it's a generic Next unstable_cache
 * wrapper keyed by a caller-chosen string, not actually Sheets-specific,
 * so this reuses it directly rather than duplicating the same 15 lines
 * under a new name.
 *
 * Falls back to the hardcoded FALLBACK constant above, key by key, if a
 * given key has no document yet (e.g. before the seed script has run) or if
 * Mongo is unreachable entirely — an admin-config outage degrades to
 * "dropdowns serve their last-known-good hardcoded values," never to a page
 * that can't render. `degraded`/`meta` let a caller (the admin UI
 * specifically) tell that degraded state apart from a normal healthy read,
 * rather than silently treating fallback data as if it were live Mongo
 * state — see src/app/admin/config/page.tsx.
 */
export async function getAllSheetFieldOptionsWithStatus(): Promise<SheetFieldOptionsResult> {
  try {
    return await withCache(CACHE_KEY, CACHE_TTL_MS, async () => {
      const col = await getCollection<SheetFieldOptionsDoc>(COLLECTION);
      const docs = await col.find({}).toArray();
      const byKey = new Map(docs.map((d) => [d.key, d]));

      const result = cloneFallback();
      const meta = {} as SheetFieldOptionsMeta;
      for (const key of OPTION_KEYS) {
        const doc = byKey.get(key);
        if (!doc) {
          meta[key] = null; // no document for this key yet -> keep its fallback
          continue;
        }
        (result as unknown as Record<OptionKey, unknown>)[key] = doc.options;
        // Defensive: every doc this app itself ever writes has updatedAt
        // set (see updateFieldOptions() below), but a doc missing/carrying
        // a malformed one (e.g. manually edited in Mongo directly)
        // shouldn't take the whole read down with it — treat it the same
        // as "no document yet" for concurrency purposes rather than
        // throwing and falling back to hardcoded defaults for every key.
        meta[key] = doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : null;
      }
      return { options: result, degraded: false, meta };
    });
  } catch (e) {
    console.error("getAllSheetFieldOptions: Mongo unreachable, serving hardcoded fallback", e);
    const meta = Object.fromEntries(OPTION_KEYS.map((k) => [k, null])) as SheetFieldOptionsMeta;
    return { options: cloneFallback(), degraded: true, meta };
  }
}

/** Convenience wrapper for callers (src/lib/sheets/googleSheetsRdvMonthly.ts) that only need the option values, not the degraded/meta status. */
export async function getAllSheetFieldOptions(): Promise<AllSheetFieldOptions> {
  return (await getAllSheetFieldOptionsWithStatus()).options;
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

/** Thrown by updateFieldOptions() when expectedUpdatedAt doesn't match the document's real current updatedAt — someone else's write (or this same admin, from another tab) landed since the caller's local `options` state was read. */
export class OptionsConflictError extends Error {}

/** MongoDB's duplicate-key error code — see the updateOne() comment below for why this doubles as our optimistic-concurrency conflict signal. */
const MONGO_DUPLICATE_KEY_CODE = 11000;

/**
 * Validates and writes one whole option-set (the admin UI always saves a
 * full replace of a set, not a per-item patch — simpler and matches how
 * small these lists are, 5-20 entries each). invalidateCache() runs after a
 * successful write so the very next read anywhere in the app — same
 * instance or a different warm one — sees the change immediately instead of
 * waiting out CACHE_TTL_MS.
 *
 * `expectedUpdatedAt` — the ISO timestamp (or null, for "no document yet")
 * the caller last read for this key via getAllSheetFieldOptionsWithStatus()
 * — is optional for backward compatibility (existing callers/tests that
 * don't pass it get the old unconditional-overwrite behavior), but
 * src/app/api/config/options/route.ts always supplies it. When present, the
 * write is conditioned on the document still having that exact updatedAt;
 * if another write landed in between, the condition doesn't match and
 * OptionsConflictError is thrown instead of silently overwriting.
 */
export async function updateFieldOptions(
  input: UpdateOptionsInput,
  updatedBy: string,
  expectedUpdatedAt?: string | null
): Promise<void> {
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

  if (expectedUpdatedAt === undefined) {
    // No concurrency check requested — old unconditional-replace behavior.
    await col.updateOne({ _id: input.key }, { $set: doc }, { upsert: true });
    invalidateCache(CACHE_KEY);
    return;
  }

  // Filter includes the expected updatedAt as an equality condition. If the
  // live document's updatedAt has since moved on (or a document now exists
  // where the caller expected none), this filter matches nothing — and
  // because upsert:true is set, MongoDB attempts to INSERT a new document
  // instead. That insert collides on the unique _id index (a document with
  // this _id already exists, just with a different updatedAt), throwing
  // E11000 — which is exactly the conflict signal we want, detected
  // atomically by Mongo itself rather than via a separate check-then-write
  // race on our side.
  const filter: Record<string, unknown> =
    expectedUpdatedAt === null
      ? { _id: input.key, updatedAt: { $exists: false } }
      : { _id: input.key, updatedAt: new Date(expectedUpdatedAt) };

  try {
    await col.updateOne(filter, { $set: doc }, { upsert: true });
  } catch (e) {
    const code = (e as { code?: number })?.code;
    if (code === MONGO_DUPLICATE_KEY_CODE) {
      throw new OptionsConflictError(
        `"${OPTION_LABELS[input.key]}" a été modifié entre-temps (par un autre onglet ou une autre personne). Rechargez la page et réessayez.`
      );
    }
    throw e;
  }
  invalidateCache(CACHE_KEY);
}
