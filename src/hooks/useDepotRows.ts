"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { markFresh, freshUrl } from "@/hooks/freshFetch";
import type { DepotRow, ParkingAddResponse } from "@/types";

// Same pattern/shape as src/hooks/useParkingRows.ts. The plate-suggestion list
// itself is shared app-wide — see src/hooks/useVehicleSuggestionList.ts, one
// fetch across all four plate-input pages — so it isn't duplicated here.

const ROWS_KEY = ["depot", "rows"] as const;

async function fetchJson<T extends { ok: boolean; error?: string }>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, init);
  const json = (await res.json()) as T;
  if (!json.ok) throw new Error(json.error ?? "Erreur inconnue");
  return json;
}

export function useDepotRows() {
  return useQuery({
    queryKey: ROWS_KEY,
    queryFn: () => fetchJson<{ ok: true; rows: DepotRow[] }>(freshUrl("depot", "/api/depot")),
    select: (data) => data.rows,
  });
}

export function useAddDepotPlates() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (raw: string) =>
      fetchJson<ParkingAddResponse & { ok: true }>("/api/depot/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw }),
      }),
    meta: { successMessage: "Véhicule(s) ajouté(s) au dépôt" },
    onSuccess: () => {
      // markFresh first: invalidating alone gets the pre-write rows back,
      // because revalidateTag is stale-while-revalidate (see freshFetch.ts).
      markFresh("depot");
      void queryClient.invalidateQueries({ queryKey: ROWS_KEY });
    },
  });
}

export function useUpdateDepotAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ rowIndex, action, imm }: { rowIndex: number; action: string; imm: string }) =>
      fetchJson<{ ok: true }>("/api/depot/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIndex, action, imm }),
      }),
    meta: { successMessage: "Action mise à jour" },
    onSettled: () => {
      // markFresh first: invalidating alone gets the pre-write rows back,
      // because revalidateTag is stale-while-revalidate (see freshFetch.ts).
      markFresh("depot");
      void queryClient.invalidateQueries({ queryKey: ROWS_KEY });
    },
  });
}

export function useDeleteDepotRow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ rowIndex, imm }: { rowIndex: number; imm: string }) =>
      fetchJson<{ ok: true }>("/api/depot/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIndex, imm }),
      }),
    meta: { successMessage: "Véhicule retiré du dépôt" },
    onSettled: () => {
      // markFresh first: invalidating alone gets the pre-write rows back,
      // because revalidateTag is stale-while-revalidate (see freshFetch.ts).
      markFresh("depot");
      void queryClient.invalidateQueries({ queryKey: ROWS_KEY });
    },
  });
}

export function useClearDepotAll() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fetchJson<{ ok: true }>("/api/depot/clear", { method: "POST" }),
    meta: { successMessage: "Dépôt vidé" },
    onSettled: () => {
      // markFresh first: invalidating alone gets the pre-write rows back,
      // because revalidateTag is stale-while-revalidate (see freshFetch.ts).
      markFresh("depot");
      void queryClient.invalidateQueries({ queryKey: ROWS_KEY });
    },
  });
}

/** Genuine hard refresh for ListPageHeader's "Actualiser" button — see useRefreshParkingRows() in src/hooks/useParkingRows.ts for the full reasoning. */
export function useRefreshDepotRows() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await fetchJson<{ ok: true }>("/api/depot/refresh", { method: "POST" });
      markFresh("depot");
      await queryClient.refetchQueries({ queryKey: ROWS_KEY });
    },
    meta: { successMessage: "Données actualisées" },
  });
}
