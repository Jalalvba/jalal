"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AtelierRow, AtelierEditableField, ParkingAddResponse } from "@/lib/types";

// Same pattern/refetch-behavior mapping as hooks/useParkingRows.ts. Atelier
// has no imm-list endpoint of its own — app/atelier/page.tsx already reused
// /api/parking/imm-list directly ("Shares the same parc plate list as
// Parking — same underlying resource"), so this reuses useParkingImmList
// rather than duplicating a second identical hook.

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
    }: {
      rowIndex: number;
      field: AtelierEditableField;
      value: string;
    }) =>
      fetchJson<{ ok: true }>("/api/atelier/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIndex, field, value }),
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ROWS_KEY }),
  });
}

export function useDeleteAtelierRow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rowIndex: number) =>
      fetchJson<{ ok: true }>("/api/atelier/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIndex }),
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ROWS_KEY }),
  });
}

export function useClearAtelierAll() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fetchJson<{ ok: true }>("/api/atelier/clear", { method: "POST" }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ROWS_KEY }),
  });
}
