"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { markFresh, freshUrl } from "@/hooks/freshFetch";
import type { ParkingRow, ParkingAddResponse } from "@/types";

// Route logic is untouched — these are thin client-side wrappers around the
// exact same /api/parking* endpoints src/app/parking/page.tsx already called by
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
    queryFn: () => fetchJson<{ ok: true; rows: ParkingRow[] }>(freshUrl("parking", "/api/parking")),
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
    onSuccess: () => {
      // markFresh first: invalidating alone gets the pre-write rows back,
      // because revalidateTag is stale-while-revalidate (see freshFetch.ts).
      markFresh("parking");
      void queryClient.invalidateQueries({ queryKey: ROWS_KEY });
    },
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
    onSettled: () => {
      // markFresh first: invalidating alone gets the pre-write rows back,
      // because revalidateTag is stale-while-revalidate (see freshFetch.ts).
      markFresh("parking");
      void queryClient.invalidateQueries({ queryKey: ROWS_KEY });
    },
  });
}

/**
 * Sets a row's ZONING. Separate from the ACTION mutation on purpose — that one
 * also stamps TIMESTAMP, and a zone change is not workshop activity.
 */
export function useUpdateParkingZoning() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ rowIndex, zoning, imm }: { rowIndex: number; zoning: string; imm: string }) =>
      fetchJson<{ ok: true }>("/api/parking/zoning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIndex, zoning, imm }),
      }),
    meta: { successMessage: "Zoning mis à jour" },
    onSuccess: () => {
      // markFresh first: invalidating alone reads back the pre-write value,
      // because the sheet cache is stale-while-revalidate (see freshFetch.ts).
      markFresh("parking");
      void queryClient.invalidateQueries({ queryKey: ROWS_KEY });
    },
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
    onSettled: () => {
      // markFresh first: invalidating alone gets the pre-write rows back,
      // because revalidateTag is stale-while-revalidate (see freshFetch.ts).
      markFresh("parking");
      void queryClient.invalidateQueries({ queryKey: ROWS_KEY });
    },
  });
}

export function useClearParkingAll() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fetchJson<{ ok: true }>("/api/parking/clear", { method: "POST" }),
    meta: { successMessage: "Parking vidé" },
    onSettled: () => {
      // markFresh first: invalidating alone gets the pre-write rows back,
      // because revalidateTag is stale-while-revalidate (see freshFetch.ts).
      markFresh("parking");
      void queryClient.invalidateQueries({ queryKey: ROWS_KEY });
    },
  });
}

/**
 * Genuine hard refresh for ListPageHeader's "Actualiser" button — busts the
 * server-side 15s rows cache first, then refetches, so the result is
 * guaranteed live instead of possibly still serving a stale cached read
 * (which a plain queryClient.invalidateQueries() alone would risk).
 */
export function useRefreshParkingRows() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await fetchJson<{ ok: true }>("/api/parking/refresh", { method: "POST" });
      markFresh("parking");
      await queryClient.refetchQueries({ queryKey: ROWS_KEY });
    },
    meta: { successMessage: "Données actualisées" },
  });
}
