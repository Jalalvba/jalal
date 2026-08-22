// Vehicle ownership: who the vehicle belongs to, and whether that is AVIS.
//
// Reads MongoDB's `parc` collection. It did not always: `societe` reached Mongo
// only on 2026-08-22 (~/import commit 08aab01 added it to parc.py's
// COLUMNS_NEEDED — the mapping had always known "Société" -> "societe", the
// keep-list simply dropped it), and until then this module read the
// spreadsheet's own `parc` TAB because that column existed nowhere else.
//
// Both sources were compared before switching, in full: 7 838 sheet rows
// against 7 836 documents, and across the 7 836 plates present in both, ZERO
// disagreements on Société. The distributions match to a row (LOCAFINANCE
// 5 522/5 521, AVIS 839, PLF 699, PSD 663, Divers 114) — an earlier comparison
// suggesting otherwise had been measured against a truncated 4 000-row read of
// the tab, not against the tab.
//
// Mongo wins on cost: this replaced a ~7 800-row Sheets read of a second tab on
// every cache miss, against a 60 req/min service-account quota that four zone
// tabs already share.
//
// `locataire` is NOT a substitute for `societe` and must never be used as one:
// it reads "Locafinance" for the very plates whose Société is "AVIS" (checked
// per plate on 89869-E-1, 88369-E-1, 87965-E-1).
//
// Why it matters at all: an AVIS-owned vehicle (short-term rental fleet) is
// handled differently from a customer's leased one — after any part change it
// goes to the garage Pierre Parent — and 766 parc rows have an EMPTY Client
// with the owner recorded only in Société, so without this fallback those
// vehicles show no owner at all.

import { getCollection } from "@/lib/mongo/client";
import { withCache, ROWS_CACHE_TTL_MS } from "@/lib/sheets/googleSheetsClient";

const CACHE_KEY = "rows:parc-owners";

export type VehicleOwner = {
  /** The Client column — the customer, when there is one. */
  client: string;
  /** The Société column — who owns the vehicle. */
  societe: string;
  /**
   * The name to show: Client when set, otherwise Société. A vehicle with no
   * customer still has an owner, and showing an empty cell for 766 rows is
   * worse than showing the owner.
   */
  display: string;
  /**
   * AVIS's own fleet — short-term rental. Matched on either field because the
   * value appears as both "AVIS" (Société) and "Scal Avis" (Locataire), and a
   * vehicle is no less AVIS's for being recorded in the other column.
   */
  isAvis: boolean;
};

const AVIS_RE = /\b(avis|scal)\b/i;

export function classifyOwner(client: unknown, societe: unknown): VehicleOwner {
  const c = String(client ?? "").trim();
  const s = String(societe ?? "").trim();
  return {
    client: c,
    societe: s,
    display: c || s,
    isAvis: AVIS_RE.test(c) || AVIS_RE.test(s),
  };
}

/**
 * plate -> owner, for the whole tab. One read per cache window, shared by
 * every caller: this is ~4 000 rows and a per-plate lookup would be a Sheets
 * call per vehicle on a page rendering 84 of them.
 */
export async function getParcOwners(fresh = false): Promise<Map<string, VehicleOwner>> {
  // The CACHE stores an array, and the Map is built outside it. unstable_cache
  // serialises what it returns, so a cached Map survives exactly one call and
  // comes back as `{}` on every hit afterwards — the first request answered
  // correctly and every later one threw "(intermediate value).get is not a
  // function". Anything cached here must be JSON, by construction.
  const entries = await withCache(
    CACHE_KEY,
    ROWS_CACHE_TTL_MS,
    async () => {
      const parc = await getCollection("parc");
      const docs = await parc
        .find({}, { projection: { _id: 0, immatriculation: 1, client: 1, societe: 1 } })
        .toArray();
      const out: [string, VehicleOwner][] = [];
      for (const d of docs) {
        const imm = String(d.immatriculation ?? "").trim().toUpperCase();
        if (!imm) continue;
        out.push([imm, classifyOwner(d.client, d.societe)]);
      }
      return out;
    },
    { bypass: fresh }
  );

  return new Map(entries);
}

/** One plate's owner, or null when the tab does not know it. */
export async function getVehicleOwner(imm: string): Promise<VehicleOwner | null> {
  const plate = imm.trim().toUpperCase();
  if (!plate) return null;
  return (await getParcOwners()).get(plate) ?? null;
}
