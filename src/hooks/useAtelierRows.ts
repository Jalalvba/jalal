"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AtelierRow, AtelierEditableField, ParkingAddResponse } from "@/types";

// Same pattern/refetch-behavior mapping as src/hooks/useParkingRows.ts. The
// plate-suggestion list itself is shared app-wide — see
// src/hooks/useVehicleSuggestionList.ts, one fetch across all four plate-input
// pages — so it isn't duplicated here.

const ROWS_KEY = ["atelier", "rows"] as const;

async function fetchJson<T extends { ok: boolean; error?: string }>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, init);
  const json = (await res.json()) as T;
  if (!json.ok) throw new Error(json.error ?? "Erreur inconnue");
  return json;
}

export function useAtelierRows() {
  return useQuery({
    queryKey: ROWS_KEY,
    queryFn: () => fetchJson<{ ok: true; rows: AtelierRow[] }>("/api/atelier"),
    select: (data) => data.rows,
  });
}

export function useAddAtelierPlates() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (raw: string) =>
      fetchJson<ParkingAddResponse & { ok: true }>("/api/atelier/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw }),
      }),
    meta: { successMessage: "Véhicule(s) ajouté(s) à l'atelier" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ROWS_KEY }),
  });
}

export function useUpdateAtelierField() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      rowIndex,
      field,
      value,
      imm,
    }: {
      rowIndex: number;
      field: AtelierEditableField;
      value: string;
      imm: string;
    }) =>
      fetchJson<{ ok: true }>("/api/atelier/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIndex, field, value, imm }),
      }),
    meta: { successMessage: "Champ mis à jour" },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ROWS_KEY }),
  });
}

export function useDeleteAtelierRow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ rowIndex, imm }: { rowIndex: number; imm: string }) =>
      fetchJson<{ ok: true }>("/api/atelier/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIndex, imm }),
      }),
    meta: { successMessage: "Véhicule retiré de l'atelier" },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ROWS_KEY }),
  });
}

export function useClearAtelierAll() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fetchJson<{ ok: true }>("/api/atelier/clear", { method: "POST" }),
    meta: { successMessage: "Atelier vidé" },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ROWS_KEY }),
  });
}

/** Genuine hard refresh for ListPageHeader's "Actualiser" button — see useRefreshParkingRows() in src/hooks/useParkingRows.ts for the full reasoning. */
export function useRefreshAtelierRows() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await fetchJson<{ ok: true }>("/api/atelier/refresh", { method: "POST" });
      await queryClient.refetchQueries({ queryKey: ROWS_KEY });
    },
    meta: { successMessage: "Données actualisées" },
  });
}
