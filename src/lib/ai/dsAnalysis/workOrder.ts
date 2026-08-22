// Turning an analysis into the text that goes in PARKING's ACTION cell.
//
// The cell is read by a service advisor who copies it into an ordre de
// réparation, so the format is a numbered work list and nothing else — no
// preamble, no summary, no "généré par IA" banner. Anything that is not an
// instruction is something they have to delete before pasting.

import type { DsAnalysis } from "@/lib/ai/prompts/dsAnalysis";

/** A cell holding more than this is unusable in a spreadsheet UI anyway. */
const MAX_CELL = 1500;

/**
 * Returns "" when there is nothing to do — a vehicle with no due maintenance
 * and no recurrence is a real outcome, and writing "RAS" into the cell would
 * overwrite a column the team also uses by hand for exactly nothing.
 */
export function formatWorkOrder(analysis: DsAnalysis): string {
  const actions = (analysis.actions ?? []).map((a) => a.trim()).filter(Boolean);
  if (actions.length === 0) return "";

  const text = actions.map((a, i) => `${i + 1}. ${a}`).join("\n");
  return text.length <= MAX_CELL ? text : `${text.slice(0, MAX_CELL - 1)}…`;
}

/**
 * Whether this app may write over what the cell currently holds.
 *
 * Empty: yes. Byte-identical to what we last wrote: yes, that is a refresh.
 * Anything else is a human's text — the ACTION column is theirs too (it holds
 * values like "DISPONIBLE" today) — and is left exactly as it is.
 */
export function mayOverwrite(current: string, lastWritten: string | undefined): boolean {
  const c = current.trim();
  if (!c) return true;
  return lastWritten !== undefined && c === lastWritten.trim();
}
