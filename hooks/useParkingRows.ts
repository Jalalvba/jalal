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
const IMM_LIST_KEY = ["parking", "imm-list"] as const;

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

export function useParkingImmList() {
  return useQuery({
    queryKey: IMM_LIST_KEY,
    queryFn: () => fetchJson<{ ok: true; imms: string[] }>("/api/parking/imm-list"),
    select: (data) => data.imms,
    staleTime: 5 * 60_000,
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ROWS_KEY }),
  });
}

export function useUpdateParkingAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ rowIndex, action }: { rowIndex: number; action: string }) =>
      fetchJson<{ ok: true }>("/api/parking/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIndex, action }),
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ROWS_KEY }),
  });
}

export function useDeleteParkingRow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rowIndex: number) =>
      fetchJson<{ ok: true }>("/api/parking/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIndex }),
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ROWS_KEY }),
  });
}

export function useClearParkingAll() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fetchJson<{ ok: true }>("/api/parking/clear", { method: "POST" }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ROWS_KEY }),
  });
}
