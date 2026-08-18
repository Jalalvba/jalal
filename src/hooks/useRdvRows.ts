"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RdvRow, RdvEditableField, RdvAddInput, RdvAddResponse, RdvUpdateResult, RdvClearResult } from "@/lib/types";

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

/** Genuine hard refresh for ListPageHeader's "Actualiser" button — see useRefreshParkingRows() in hooks/useParkingRows.ts for the full reasoning. */
export function useRefreshRdvRows() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await fetchJson<{ ok: true }>("/api/rdv/refresh", { method: "POST" });
      await queryClient.refetchQueries({ queryKey: ROWS_KEY });
    },
    meta: { successMessage: "Données actualisées" },
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
    meta: { successMessage: "Rendez-vous ajouté" },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ROWS_KEY }),
  });
}

/**
 * `identity` is the appointment's full current-field snapshot (everything
 * the frontend last read it as, except `field` itself) — the backend
 * re-resolves the live row from this by content match, in both tabs
 * independently, rather than trusting any row number. See
 * lib/googleSheetsRdv.ts's updateRdvField() for the full reasoning.
 */
export function useUpdateRdvField() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      identity,
      field,
      value,
    }: {
      identity: RdvAddInput;
      field: RdvEditableField;
      value: string;
    }) =>
      fetchJson<RdvUpdateResult & { ok: true }>("/api/rdv/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity, field, value }),
      }),
    meta: { successMessage: "Champ mis à jour" },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ROWS_KEY }),
  });
}

/** Clears (not deletes) the appointment matching `identity`, re-resolved fresh in both tabs — same reasoning as useUpdateRdvField(). */
export function useClearRdvRow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (identity: RdvAddInput) =>
      fetchJson<RdvClearResult & { ok: true }>("/api/rdv/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(identity),
      }),
    meta: { successMessage: "Rendez-vous effacé" },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ROWS_KEY }),
  });
}

/** Converts a fetched RdvRow (display-formatted) back into the RdvAddInput shape the identity-based update/clear endpoints expect. */
export function rdvRowToIdentity(row: RdvRow): RdvAddInput {
  const [d, m, y] = row.date.split("/");
  return {
    date: `${y}-${m}-${d}`,
    heure: row.heure,
    clients: row.clients,
    vehicule: row.vehicule,
    matricule: row.matricule,
    intervention: row.intervention,
    contact: row.contact,
    convoyeur: row.convoyeur,
  };
}
