import { getCollection } from "@/lib/mongo/client";
import { withCache, invalidateCache } from "@/lib/sheets/googleSheetsClient";

const VEHICLE_SUGGEST_CACHE_KEY = "vehicle-suggest-list:parc+cp";

export type VehicleSuggestion = { imm: string; ww: string; marque: string; modele: string };

/**
 * Full, deduped plate universe across BOTH "parc" (7,786 distinct plates)
 * and "cp" (10,276 distinct plates, ~3,732 of them not present in parc at
 * all — real counts confirmed live against Mongo, 2026-08-10) — combined
 * 11,518 distinct plates, ~824KB as JSON. Small enough to ship the whole
 * thing to the browser once and do every plate search client-side with
 * zero further network calls, across Parking/Atelier/Depot/DS History.
 *
 * parc's fields win on overlap (it's the canonical fleet record); cp only
 * fills in plates parc doesn't have at all.
 */
export async function getCombinedVehicleSuggestionList(): Promise<VehicleSuggestion[]> {
  return withCache(VEHICLE_SUGGEST_CACHE_KEY, 7 * 24 * 60 * 60_000, async () => {
    const [parcCol, cpCol] = await Promise.all([getCollection("parc"), getCollection("cp")]);
    const [parcDocs, cpDocs] = await Promise.all([
      parcCol.find({}, { projection: { immatriculation: 1, numero_ww: 1, marque: 1, modele: 1 } }).toArray(),
      cpCol.find({}, { projection: { imm: 1, ww: 1, marque: 1, modele: 1 } }).toArray(),
    ]);

    const map = new Map<string, VehicleSuggestion>();
    for (const d of parcDocs) {
      const imm = String(d.immatriculation ?? "").trim().toUpperCase();
      if (!imm || map.has(imm)) continue;
      map.set(imm, {
        imm,
        ww: String(d.numero_ww ?? "").trim(),
        marque: String(d.marque ?? "").trim(),
        modele: String(d.modele ?? "").trim(),
      });
    }
    for (const d of cpDocs) {
      const imm = String(d.imm ?? "").trim().toUpperCase();
      if (!imm || map.has(imm)) continue;
      map.set(imm, {
        imm,
        ww: String(d.ww ?? "").trim(),
        marque: String(d.marque ?? "").trim(),
        modele: String(d.modele ?? "").trim(),
      });
    }

    const list = [...map.values()];
    // Sorted so any client that truncates a filtered result set (dropdown
    // display caps) does so deterministically — the same top-N for the
    // same prefix, every time, on every page.
    list.sort((a, b) => (a.imm < b.imm ? -1 : a.imm > b.imm ? 1 : 0));
    return list;
  });
}

/** Called by app/api/trigger-import/route.ts after a successful parc OR cp pipeline run. */
export function invalidateVehicleSuggestionListCache(): void {
  invalidateCache(VEHICLE_SUGGEST_CACHE_KEY);
}
