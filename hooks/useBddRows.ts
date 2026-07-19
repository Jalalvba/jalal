"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BddRow, BddUpdateResult } from "@/lib/types";

// Same pattern as hooks/useParkingRows.ts / useAtelierRows.ts, against the
// existing /api/bdd and /api/bdd/update endpoints (unchanged).
//
// Note for the app/suivi-rl/page.tsx migration specifically: the original
// page persisted rows to localStorage itself (loadCachedRows/saveCachedRows)
// so a repeat visit painted instantly from the last-known cache before the
// background refresh landed. Plain useQuery's cache is in-memory only and
// won't survive a hard reload the same way — flagging this explicitly during
// that page's migration rather than silently changing the behavior here.

const ROWS_KEY = ["bdd", "rows"] as const;

async function fetchJson<T extends { ok: boolean; error?: string }>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, init);
  const json = (await res.json()) as T;
  if (!json.ok) throw new Error(json.error ?? "Erreur inconnue");
  return json;
}

export function useBddRows() {
  return useQuery({
    queryKey: ROWS_KEY,
    queryFn: () => fetchJson<{ ok: true; rows: BddRow[] }>("/api/bdd"),
    select: (data) => data.rows,
    // Original page always kicked off a silent background fetchFresh() on
    // mount even when painting instantly from a fresh localStorage cache —
    // staleTime: 0 (overriding the 30s default) reproduces that unconditional
    // refetch-on-mount instead of skipping it when the persisted cache is
    // still within the global staleTime window.
    staleTime: 0,
  });
}

export function useUpdateBddRow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ row, updates }: { row: number; updates: Record<string, string> }) =>
      fetchJson<BddUpdateResult & { ok: true }>("/api/bdd/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ row, updates }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ROWS_KEY }),
  });
}

/**
 * Matches the original page's handleRowSaved(): patch the just-saved fields
 * into the cached rows immediately (instant UI feedback) rather than waiting
 * for the invalidated query's refetch to land.
 */
export function useOptimisticBddUpdate() {
  const queryClient = useQueryClient();
  return (row: number, updates: Partial<BddRow>) => {
    queryClient.setQueryData<{ ok: true; rows: BddRow[] }>(ROWS_KEY, (old) =>
      old ? { ...old, rows: old.rows.map((r) => (r._row === row ? { ...r, ...updates } : r)) } : old
    );
  };
}
