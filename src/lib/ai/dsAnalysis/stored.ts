// Types and pure logic for a STORED analysis — importable from a client
// component.
//
// Deliberately separate from src/lib/mongo/dsAnalyses.ts: that module imports
// getCollection(), which pulls the MongoDB driver in and reads MONGODB_URI at
// module scope. A "use client" component importing isStale() from there would
// drag the driver into the browser bundle (and blow up on the missing env),
// which is exactly what happened before this split.

import type { DsAnalysis } from "@/lib/ai/prompts/dsAnalysis";

export type AnalysisTier = "standard" | "pro";

export type StoredDsAnalysis = {
  imm: string;
  analysis: DsAnalysis;
  /** Which tier produced it — a free-tier answer is not the same evidence. */
  tier: AnalysisTier;
  model: string;
  costUsd: number;
  /**
   * How much history the answer was based on. A vehicle that has been in the
   * workshop twice since is not described by this analysis any more, and the
   * UI says so rather than quietly showing a stale verdict — see isStale().
   */
  entriesCount: number;
  /** ISO date of the most recent intervention that was analysed. */
  lastEntryDate: string | null;
  /**
   * The exact text this app last wrote into PARKING's ACTION cell for this
   * plate, when it did.
   *
   * Kept so a re-run can tell ITS OWN previous output apart from something a
   * human typed. Without it the batch has two bad options: never refresh (an
   * action list goes stale the moment new work is logged) or always overwrite
   * (and one day it erases a note somebody meant to keep).
   */
  actionText?: string;
  createdAt: Date;
  updatedAt: Date;
};

/** The list-page shape: everything a card needs, without the findings blob. */
export type DsAnalysisSummary = Pick<
  StoredDsAnalysis,
  "imm" | "tier" | "entriesCount" | "lastEntryDate" | "updatedAt"
> & { summary: string };

/**
 * True when the vehicle has been worked on since the analysis was produced.
 *
 * Compares COUNTS as well as the newest date: a back-dated DS is routine in
 * this data, so "the newest entry is newer than the analysis" alone would miss
 * an intervention inserted with an older date. Either signal moving means the
 * picture changed.
 */
export function isStale(
  stored: Pick<StoredDsAnalysis, "entriesCount" | "lastEntryDate">,
  current: { entriesCount: number; lastEntryDate: string | null }
): boolean {
  if (current.entriesCount !== stored.entriesCount) return true;
  return (current.lastEntryDate ?? "") !== (stored.lastEntryDate ?? "");
}
