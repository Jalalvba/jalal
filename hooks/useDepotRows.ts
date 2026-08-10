"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DepotRow, ParkingAddResponse } from "@/lib/types";

// Same pattern/shape as hooks/useParkingRows.ts. The plate-suggestion list
// itself is shared app-wide — see hooks/useVehicleSuggestionList.ts, one
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
    queryFn: () => fetchJson<{ ok: true; rows: DepotRow[] }>("/api/depot"),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ROWS_KEY }),
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
    onSettled: () => queryClient.invalidateQueries({ queryKey: ROWS_KEY }),
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
    onSettled: () => queryClient.invalidateQueries({ queryKey: ROWS_KEY }),
  });
}

export function useClearDepotAll() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fetchJson<{ ok: true }>("/api/depot/clear", { method: "POST" }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ROWS_KEY }),
  });
}
