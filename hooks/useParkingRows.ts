"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ParkingRow, ParkingAddResponse } from "@/lib/types";

// Route logic is untouched — these are thin client-side wrappers around the
// exact same /api/parking* endpoints app/parking/page.tsx already called by
// hand. Refetch-on-settle vs refetch-on-success-only per mutation matches
// the original fetchRows() call sites exactly: add() only refetched inside
// its `if (json.ok)` branch, while action/delete/clear all refetched in a
// `finally` regardless of outcome.

const ROWS_KEY = ["parking", "rows"] as const;

async function fetchJson<T extends { ok: boolean; error?: string }>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, init);
  const json = (await res.json()) as T;
  if (!json.ok) throw new Error(json.error ?? "Erreur inconnue");
  return json;
}

export function useParkingRows() {
  return useQuery({
    queryKey: ROWS_KEY,
    queryFn: () => fetchJson<{ ok: true; rows: ParkingRow[] }>("/api/parking"),
    select: (data) => data.rows,
  });
}

export function useAddParkingPlates() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (raw: string) =>
      fetchJson<ParkingAddResponse & { ok: true }>("/api/parking/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw }),
      }),
    meta: { successMessage: "Véhicule(s) ajouté(s) au parking" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ROWS_KEY }),
  });
}

export function useUpdateParkingAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ rowIndex, action, imm }: { rowIndex: number; action: string; imm: string }) =>
      fetchJson<{ ok: true }>("/api/parking/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIndex, action, imm }),
      }),
    meta: { successMessage: "Action mise à jour" },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ROWS_KEY }),
  });
}

export function useDeleteParkingRow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ rowIndex, imm }: { rowIndex: number; imm: string }) =>
      fetchJson<{ ok: true }>("/api/parking/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIndex, imm }),
      }),
    meta: { successMessage: "Véhicule retiré du parking" },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ROWS_KEY }),
  });
}

export function useClearParkingAll() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fetchJson<{ ok: true }>("/api/parking/clear", { method: "POST" }),
    meta: { successMessage: "Parking vidé" },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ROWS_KEY }),
  });
}
