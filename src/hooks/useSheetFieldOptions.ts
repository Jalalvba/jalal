"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AllSheetFieldOptions, ColoredOption, OptionKey } from "@/types";
import { markFreshFor, freshUrl } from "@/hooks/freshFetch";
import {
  EMPLACEMENT_OPTIONS_FALLBACK,
  ETAT_OPTIONS_FALLBACK,
  FLAG_OPTIONS_FALLBACK,
  CATEGORIE_OPTIONS_FALLBACK,
  TECHNICIEN_OPTIONS_FALLBACK,
  PRESTATAIRE_OPTIONS_FALLBACK,
  RDV_CONVOYEURS_FALLBACK,
} from "@/types";

// Client-side counterpart to src/lib/mongo/sheetFieldOptions.ts's server-side fallback
// — same *_FALLBACK constants, shown immediately on first render (and if the
// fetch itself fails) instead of an empty dropdown while the query is
// pending. The server-side fallback (Mongo unreachable) and this one
// (network/query not yet resolved) are two different failure points, both
// degrading to the same last-known-good values rather than a blank UI.
//
// Crucially, this is ONLY ever shown while isLoading is true (or on a fetch
// failure) — /admin/config specifically must never let a user edit against
// this data, since a save while it's showing CLIENT_FALLBACK would replace
// whatever's actually in Mongo with these hardcoded values. See
// src/app/admin/config/page.tsx's isLoading gate.
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

/** Mirrors CACHE_TTL_MS in src/lib/mongo/sheetFieldOptions.ts — how long a
 *  stale options read could otherwise be served after a save. */
const OPTIONS_CACHE_TTL_MS = 5 * 60_000;

type OptionsMeta = Record<OptionKey, string | null>;

type FetchOptionsResult = {
  options: AllSheetFieldOptions;
  degraded: boolean;
  meta: OptionsMeta;
};

async function fetchOptions(): Promise<FetchOptionsResult> {
  const res = await fetch(freshUrl("config-options", "/api/config/options"));
  const json = (await res.json()) as {
    ok: boolean;
    options?: AllSheetFieldOptions;
    degraded?: boolean;
    meta?: OptionsMeta;
    error?: string;
  };
  if (!json.ok || !json.options) throw new Error(json.error ?? "Erreur inconnue");
  return { options: json.options, degraded: json.degraded ?? false, meta: json.meta ?? ({} as OptionsMeta) };
}

/**
 * Replaces every page's old direct `import { X_OPTIONS } from "@/types"`
 * — options are Mongo-backed now, so reading them is an async fetch instead
 * of a static import. Backed by TanStack Query's own cache, so calling this
 * from several components on the same page (a list page's chip row AND its
 * per-row card component, for instance) costs one network request, not one
 * per caller. staleTime matches the server-side cache TTL (options change
 * rarely) so this isn't refetching on every window focus for data that's
 * essentially static.
 *
 * `degraded` is true only when the server itself served fallback data
 * because Mongo was unreachable (not the normal per-key "no document yet"
 * case) — /admin/config uses it to block edits rather than let a write land
 * on top of what might be stale fallback data. `isLoading` additionally
 * covers the client-side "haven't heard back yet" window, which is the more
 * common trigger for the same class of bug (see C2 in the audit this
 * responds to).
 */
export function useSheetFieldOptions() {
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchOptions,
    staleTime: 5 * 60_000,
  });

  const options = query.data?.options ?? CLIENT_FALLBACK;

  return {
    options,
    degraded: query.data?.degraded ?? false,
    meta: query.data?.meta ?? ({} as OptionsMeta),
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
    mutationFn: async (input: {
      key: OptionKey;
      options: string[] | ColoredOption[];
      /** The updatedAt this key had when the caller last read it (from useSheetFieldOptions()'s `meta`) — null if the key had no document yet. Lets the server detect a concurrent write and reject with a 409 instead of silently overwriting it. */
      expectedUpdatedAt: string | null;
    }) => {
      const res = await fetch("/api/config/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Erreur inconnue");
    },
    meta: { successMessage: "Options mises à jour" },
    onSuccess: () => {
      // markFreshFor, not markFresh: the read that must see this save is
      // often on ANOTHER page (add a Technicien here, then open /atelier),
      // and a one-shot in-memory flag does not survive that navigation. The
      // window matches the server-side cache TTL — see freshFetch.ts.
      markFreshFor("config-options", OPTIONS_CACHE_TTL_MS);
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
