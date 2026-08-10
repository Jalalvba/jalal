"use client";

import { useQuery } from "@tanstack/react-query";
import type { VehicleSuggestion } from "@/lib/vehicleSuggestions";

const VEHICLE_SUGGESTIONS_KEY = ["vehicle-suggestions"] as const;

async function fetchJson<T extends { ok: boolean }>(url: string): Promise<T> {
  const res = await fetch(url);
  return res.json() as Promise<T>;
}

/**
 * The ONE shared fetch of the full combined parc+cp plate universe, used by
 * all four plate-input pages (Parking, Atelier, Depot, DS History) — a
 * single TanStack Query cache entry (persisted to localStorage, see
 * hooks/queryClient.tsx) means only the very first page visited in a
 * browser session ever calls the network for this; every other page reads
 * the same in-memory + localStorage-backed cache with zero requests.
 */
export function useVehicleSuggestionList() {
  return useQuery({
    queryKey: VEHICLE_SUGGESTIONS_KEY,
    queryFn: () => fetchJson<{ ok: true; vehicles: VehicleSuggestion[] }>("/api/vehicle-suggestions"),
    select: (data) => data.vehicles,
    staleTime: 5 * 60_000,
  });
}
