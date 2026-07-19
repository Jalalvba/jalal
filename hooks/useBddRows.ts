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
