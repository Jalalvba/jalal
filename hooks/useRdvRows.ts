"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RdvRow, RdvEditableField, RdvAddInput, RdvAddResponse } from "@/lib/types";

// Same pattern as hooks/useAtelierRows.ts. No clear-all mutation — RDV is an
// append-only appointment log, so unlike Atelier/Parking there's no bulk-wipe
// action here.

const ROWS_KEY = ["rdv", "rows"] as const;

async function fetchJson<T extends { ok: boolean; error?: string }>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, init);
  const json = (await res.json()) as T;
  if (!json.ok) throw new Error(json.error ?? "Erreur inconnue");
  return json;
}

export function useRdvRows() {
  return useQuery({
    queryKey: ROWS_KEY,
    queryFn: () => fetchJson<{ ok: true; rows: RdvRow[] }>("/api/rdv"),
    select: (data) => data.rows,
  });
}

export function useAddRdvRow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RdvAddInput) =>
      fetchJson<RdvAddResponse & { ok: true }>("/api/rdv/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ROWS_KEY }),
  });
}

export function useUpdateRdvField() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      rowIndex,
      field,
      value,
    }: {
      rowIndex: number;
      field: RdvEditableField;
      value: string;
    }) =>
      fetchJson<{ ok: true }>("/api/rdv/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIndex, field, value }),
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ROWS_KEY }),
  });
}

export function useDeleteRdvRow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rowIndex: number) =>
      fetchJson<{ ok: true }>("/api/rdv/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIndex }),
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ROWS_KEY }),
  });
}
