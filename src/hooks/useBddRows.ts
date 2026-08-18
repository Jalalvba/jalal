"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BddRow,
  BddUpdateResult,
  ParkingAddResponse,
  ReformulateCommentContext,
  ReformulateCommentResponse,
} from "@/types";

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
    // Inherits the provider's 30s default staleTime — the persisted cache
    // (see hooks/queryClient.tsx) plus TanStack Query's default
    // refetchOnMount already paint instantly from the last-known cache and
    // refetch in the background, without forcing an unconditional refetch
    // on every mount the way staleTime: 0 used to.
  });
}

/**
 * Genuine hard refresh for Suivi RL's ListPageHeader "Actualiser" button —
 * see useRefreshParkingRows() in hooks/useParkingRows.ts for the full
 * reasoning. app/api/bdd/refresh also busts RL_reunion's cache, since DS
 * History's search reads both — this hook only needs to refetch BDD's own
 * query key, DS History manages its own refetch (see app/ds-history/page.tsx).
 */
export function useRefreshBddRows() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await fetchJson<{ ok: true }>("/api/bdd/refresh", { method: "POST" });
      await queryClient.refetchQueries({ queryKey: ROWS_KEY });
    },
    meta: { successMessage: "Données actualisées" },
  });
}

export function useAddBddRow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ imm, etat }: { imm: string; etat: string }) =>
      fetchJson<ParkingAddResponse & { ok: true }>("/api/bdd/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imm, etat }),
      }),
    meta: { successMessage: "Véhicule ajouté à la BDD" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ROWS_KEY }),
  });
}

export function useUpdateBddRow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ row, updates, imm }: { row: number; updates: Record<string, string>; imm: string }) =>
      fetchJson<BddUpdateResult & { ok: true }>("/api/bdd/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ row, updates, imm }),
      }),
    meta: { successMessage: "Champ mis à jour" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ROWS_KEY }),
  });
}

/**
 * Calls Gemini to suggest a reformulated Commentaire — never saves anything
 * itself. The caller reviews the suggestion and, on confirm, saves it via
 * the same useUpdateBddRow() mutation as any other manual Commentaire edit.
 */
export function useReformulateComment() {
  return useMutation({
    mutationFn: ({ comment, context }: { comment: string; context?: ReformulateCommentContext }) =>
      fetchJson<ReformulateCommentResponse & { ok: true }>("/api/bdd/reformulate-comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment, context }),
      }),
  });
}

export function useDeleteBddRow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ row, imm }: { row: number; imm: string }) =>
      fetchJson<{ ok: true }>("/api/bdd/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ row, imm }),
      }),
    meta: { successMessage: "Véhicule supprimé de la BDD" },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ROWS_KEY }),
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
