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
   * Fingerprint of the prompt that produced this analysis.
   *
   * Freshness is not only about the vehicle. When the RULES change — a new
   * status branch, a different action style — every stored answer is stale in
   * a way isStale() cannot see, because the history did not move. Measured:
   * after the work-order rules changed, a full pass over the tab reused 79 of
   * 83 analyses and left them written to the OLD rules, including an ATV
   * vehicle still listing filter replacements it should never have been given.
   *
   * A hash rather than a hand-maintained number, because a version constant is
   * exactly the kind of thing that gets forgotten in the edit that needed it.
   */
  promptHash?: string;
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

/**
 * Fingerprints a prompt document. Short on purpose: this is a change detector,
 * not a security boundary — a collision would only mean one skipped re-run.
 */
export function promptFingerprint(prompt: string): string {
  // djb2, so this stays usable from a client component too (no node:crypto).
  let h = 5381;
  for (let i = 0; i < prompt.length; i++) h = ((h << 5) + h + prompt.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
