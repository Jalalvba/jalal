"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AllSheetFieldOptions, ColoredOption, OptionKey } from "@/lib/types";
import {
  EMPLACEMENT_OPTIONS_FALLBACK,
  ETAT_OPTIONS_FALLBACK,
  FLAG_OPTIONS_FALLBACK,
  CATEGORIE_OPTIONS_FALLBACK,
  TECHNICIEN_OPTIONS_FALLBACK,
  PRESTATAIRE_OPTIONS_FALLBACK,
  RDV_CONVOYEURS_FALLBACK,
} from "@/lib/types";

// Client-side counterpart to lib/sheetFieldOptions.ts's server-side fallback
// — same *_FALLBACK constants, shown immediately on first render (and if the
// fetch itself fails) instead of an empty dropdown while the query is
// pending. The server-side fallback (Mongo unreachable) and this one
// (network/query not yet resolved) are two different failure points, both
// degrading to the same last-known-good values rather than a blank UI.
const CLIENT_FALLBACK: AllSheetFieldOptions = {
  EMPLACEMENT_OPTIONS: EMPLACEMENT_OPTIONS_FALLBACK,
  ETAT_OPTIONS: ETAT_OPTIONS_FALLBACK,
  FLAG_OPTIONS: FLAG_OPTIONS_FALLBACK,
  CATEGORIE_OPTIONS: CATEGORIE_OPTIONS_FALLBACK,
  TECHNICIEN_OPTIONS: TECHNICIEN_OPTIONS_FALLBACK,
  PRESTATAIRE_OPTIONS: PRESTATAIRE_OPTIONS_FALLBACK,
  RDV_CONVOYEURS: [...RDV_CONVOYEURS_FALLBACK],
};

const QUERY_KEY = ["config", "options"] as const;

async function fetchOptions(): Promise<AllSheetFieldOptions> {
  const res = await fetch("/api/config/options");
  const json = (await res.json()) as { ok: boolean; options?: AllSheetFieldOptions; error?: string };
  if (!json.ok || !json.options) throw new Error(json.error ?? "Erreur inconnue");
  return json.options;
}

/**
 * Replaces every page's old direct `import { X_OPTIONS } from "@/lib/types"`
 * — options are Mongo-backed now, so reading them is an async fetch instead
 * of a static import. Backed by TanStack Query's own cache, so calling this
 * from several components on the same page (a list page's chip row AND its
 * per-row card component, for instance) costs one network request, not one
 * per caller. staleTime matches the server-side cache TTL (options change
 * rarely) so this isn't refetching on every window focus for data that's
 * essentially static.
 */
export function useSheetFieldOptions() {
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchOptions,
    staleTime: 5 * 60_000,
  });

  const options = query.data ?? CLIENT_FALLBACK;

  return {
    options,
    isLoading: query.isPending,
    error: query.error instanceof Error ? query.error.message : "",
    refetch: query.refetch,
  };
}

/** Plain string[] view of a colored option list — for components (InlineEditSelect, InlineEditCombobox) whose `options` prop only wants values, not colors. */
export function optionValues(colored: ColoredOption[]): string[] {
  return colored.map((o) => o.value);
}

export function useUpdateSheetFieldOptions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { key: OptionKey; options: string[] | ColoredOption[] }) => {
      const res = await fetch("/api/config/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Erreur inconnue");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
