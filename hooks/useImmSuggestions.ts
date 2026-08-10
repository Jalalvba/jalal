"use client";

import { useMemo } from "react";
import { useVehicleSuggestionList } from "@/hooks/useVehicleSuggestionList";
import type { VehicleSuggestion } from "@/lib/vehicleSuggestions";

const DISPLAY_CAP = 15;

function stripAlnum(s: string): string {
  return s.replace(/[^A-Z0-9]/g, "");
}

/**
 * Single-value plate-suggestion matcher (DS History's field holds exactly
 * one plate/WW, unlike Parking/Atelier/Depot's comma-separated
 * PlateSearchInput) filtering the full in-browser combined parc+cp list
 * (useVehicleSuggestionList() — fetched once per browser, zero network
 * calls after that). Strict prefix match against the FULL universe, only
 * capped to DISPLAY_CAP for the dropdown after filtering — never a
 * server-truncated list, so results are always the same complete match set
 * before display-capping, identical on every page.
 */
export function useImmSuggestions(rawInput: string) {
  const query = useVehicleSuggestionList();

  const suggestions = useMemo<VehicleSuggestion[]>(() => {
    const fragment = stripAlnum(rawInput.trim().toUpperCase());
    if (!fragment) return [];
    const vehicles = query.data ?? [];
    const matches = vehicles.filter((v) => stripAlnum(v.imm).startsWith(fragment));
    return matches.slice(0, DISPLAY_CAP);
  }, [rawInput, query.data]);

  return { suggestions, loading: query.isLoading };
}
