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
 * Returns "" only when the model produced no action at all.
 *
 * That is now an ANOMALY rather than a normal outcome: prompt rule A4b makes an
 * empty list impossible except for a closed contract (Arret facturation /
 * Restitué), because a vehicle sitting in the parking is always waiting for
 * something from someone — at minimum "Disponible — à livrer au client".
 *
 * The empty case still returns "" rather than a placeholder: writing "RAS" over
 * a column the team also fills by hand would destroy a real value to say
 * nothing.
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

/**
 * Enforces the work-order style in code: an action is an instruction, with no
 * date, no kilometre count and no parenthetical justification.
 *
 * The prompt says all of this (rule A2), and the model mostly obeys — but
 * "mostly" is not good enough here, because a date inside an action is not
 * merely untidy: `ungroundedDates()` then DROPS that action entirely if the
 * date is not in the source, and the vehicle silently loses a real instruction.
 * Observed on 48083-B-7, whose "Contrôler les plaquettes" vanished and left the
 * work order reading "Disponible — à livrer au client" on a vehicle that had
 * something to check.
 *
 * Stripping is safe precisely BECAUSE the decoration is forbidden: what is
 * removed is never the instruction, only the commentary the column does not
 * want. The findings keep their dates — that is where the evidence belongs.
 */
export function enforceActionStyle(actions: readonly string[] | undefined): string[] {
  if (!actions) return [];
  const DATE = /\b(\d{1,2}\/\d{1,2}\/\d{4}|\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})\b/g;
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of actions) {
    const cleaned = String(raw ?? "")
      // Parenthesised commentary, including the nested-free case
      // "(3 interventions : 2025-01-04, ...)".
      .replace(/\s*\([^)]*\)/g, "")
      // A trailing ", 144 878 km" or "— 12 000 km" survives the parenthesis
      // strip when the model used a dash or comma instead.
      .replace(/\s*[—,-]\s*[\d\s\u202f]+km\b/gi, "")
      .replace(DATE, "")
      .replace(/\s{2,}/g, " ")
      // Punctuation left dangling by the removals — a CLASS with `+`, not one
      // character: stripping "…AV : 2024-04-12, 2025-12-03" leaves "…AV : ,"
      // and a single-character rule would only take the comma.
      .replace(/[\s:;,.—-]+$/g, "")
      .trim();

    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}
