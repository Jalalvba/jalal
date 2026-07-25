"use client";

import { useQuery } from "@tanstack/react-query";

// Existence-check only, same shape as useParkingImmList() — DEPOT has no
// full feature/page, just this one read for the zone-badge check.

const DEPOT_PLATES_KEY = ["depot", "plates"] as const;

async function fetchJson<T extends { ok: boolean; error?: string }>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = (await res.json()) as T;
  if (!json.ok) throw new Error(json.error ?? "Erreur inconnue");
  return json;
}

export function useDepotPlates() {
  return useQuery({
    queryKey: DEPOT_PLATES_KEY,
    queryFn: () => fetchJson<{ ok: true; plates: string[] }>("/api/depot"),
    select: (data) => data.plates,
    staleTime: 5 * 60_000,
  });
}
