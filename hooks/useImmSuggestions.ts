"use client";

import { useMemo } from "react";
import { useVehicleSuggestionList } from "@/hooks/useParkingRows";
import type { VehicleSuggestion } from "@/lib/googleSheetsParking";

function stripAlnum(s: string): string {
  return s.replace(/[^A-Z0-9]/g, "");
}

/**
 * Single-value plate-suggestion matcher (DS History's field holds exactly
 * one plate/WW, unlike Parking/Atelier/Depot's comma-separated
 * PlateSearchInput) backed by the same cached+persisted widened vehicle
 * list (see useVehicleSuggestionList()). Strict prefix match only — same
 * stripAlnum+startsWith rule as hooks/usePlateAutocomplete.ts.
 */
export function useImmSuggestions(rawInput: string) {
  const query = useVehicleSuggestionList();

  const suggestions = useMemo<VehicleSuggestion[]>(() => {
    const fragment = stripAlnum(rawInput.trim().toUpperCase());
    if (!fragment) return [];
    const vehicles = query.data ?? [];
    return vehicles.filter((v) => stripAlnum(v.imm).startsWith(fragment)).slice(0, 15);
  }, [rawInput, query.data]);

  return { suggestions, loading: query.isLoading };
}
