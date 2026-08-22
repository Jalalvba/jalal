"use client";

// The owner (Client / Société / AVIS flag) for one plate, from the parc tab.
//
// Separate from the parc+cp identity merge on purpose: that merge reads two
// MONGO collections, and Société exists in neither — only in the spreadsheet's
// own parc tab. Folding a Sheets read into mergeVehicleIdentity() would make a
// pure function depend on a network call; a small hook alongside it keeps both
// honest.

import { useQuery } from "@tanstack/react-query";
import type { VehicleOwner } from "@/lib/sheets/googleSheetsParc";

export function useVehicleOwner(imm: string) {
  const plate = imm.trim();
  return useQuery({
    queryKey: ["vehicle-owner", plate.toUpperCase()],
    enabled: plate.length > 0,
    // Ownership changes when a contract does, not minute to minute.
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const res = await fetch(`/api/vehicle/owner?imm=${encodeURIComponent(plate)}`);
      const json = (await res.json()) as
        | { ok: true; owner: VehicleOwner | null }
        | { ok: false; error: string };
      if (!json.ok) throw new Error(json.error);
      return json.owner;
    },
  });
}
