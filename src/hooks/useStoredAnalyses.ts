"use client";

// Reads analyses already stored in Mongo, so a card can show one without
// spending a call. Two hooks for the two shapes /api/ds-history/analysis
// serves — one request for a whole list page, one document for a single
// vehicle.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DsAnalysisSummary, StoredDsAnalysis } from "@/lib/ai/dsAnalysis/stored";

export const STORED_ANALYSES_KEY = ["ds-analyses"] as const;
export const storedAnalysisKey = (imm: string) => ["ds-analysis", imm.trim().toUpperCase()] as const;

async function fetchJson<T extends { ok: boolean; error?: string }>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = (await res.json()) as T;
  if (!json.ok) throw new Error(json.error ?? "Erreur inconnue");
  return json;
}

/**
 * Every stored summary, keyed by plate. ONE request for the whole page — a
 * card looks its own plate up in the map rather than fetching for itself.
 */
export function useStoredAnalyses() {
  return useQuery({
    queryKey: STORED_ANALYSES_KEY,
    queryFn: () =>
      fetchJson<{ ok: true; summaries: DsAnalysisSummary[] }>("/api/ds-history/analysis"),
    select: (data) =>
      new Map(data.summaries.map((s) => [s.imm.trim().toUpperCase(), s])),
  });
}

/** The full stored analysis for one vehicle, findings included. */
export function useStoredAnalysis(imm: string) {
  const plate = imm.trim();
  return useQuery({
    queryKey: storedAnalysisKey(plate),
    enabled: plate.length > 0,
    queryFn: () =>
      fetchJson<{ ok: true; analysis: StoredDsAnalysis | null }>(
        `/api/ds-history/analysis?imm=${encodeURIComponent(plate)}`
      ),
    select: (data) => data.analysis,
  });
}

/** Call after an analysis is (re)generated, so both shapes stop being stale. */
export function useInvalidateStoredAnalyses() {
  const queryClient = useQueryClient();
  return (imm?: string) => {
    void queryClient.invalidateQueries({ queryKey: STORED_ANALYSES_KEY });
    if (imm) void queryClient.invalidateQueries({ queryKey: storedAnalysisKey(imm) });
  };
}
