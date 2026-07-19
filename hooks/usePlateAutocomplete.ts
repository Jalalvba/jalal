"use client";

import { useMemo } from "react";

/**
 * Dedupes stripAlnum/currentTokenFragment/suggestions-filtering, previously
 * copy-pasted verbatim between app/parking/page.tsx and app/atelier/page.tsx.
 * Matches only the trailing comma-separated token, exactly as both pages
 * already did — this is the multi-plate "add" input's autocomplete, not DS
 * History's single-value smart search (which debounces a remote query
 * instead of filtering a pre-fetched list, a genuinely different shape).
 */
function stripAlnum(s: string): string {
  return s.replace(/[^A-Z0-9]/g, "");
}

function currentTokenFragment(value: string): string {
  const tokens = value.split(",");
  return tokens[tokens.length - 1].trim().toUpperCase();
}

export function usePlateAutocomplete(rawInput: string, immList: string[]) {
  const suggestions = useMemo(() => {
    const fragment = currentTokenFragment(rawInput);
    const strippedFragment = stripAlnum(fragment);
    if (!strippedFragment) return [];
    return immList.filter((imm) => stripAlnum(imm).startsWith(strippedFragment)).slice(0, 15);
  }, [rawInput, immList]);

  function applySelection(selected: string): string {
    const tokens = rawInput.split(",");
    tokens.pop();
    tokens.push(" " + selected);
    return tokens.join(",").trim() + ", ";
  }

  return { suggestions, applySelection };
}
