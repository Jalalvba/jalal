// Turning an analysis into the text that goes in PARKING's ACTION cell.
//
// The cell is read by a service advisor who copies it into an ordre de
// réparation, so the format is a numbered work list and nothing else — no
// preamble, no summary, no "généré par IA" banner. Anything that is not an
// instruction is something they have to delete before pasting.

import type { DsAnalysis } from "@/lib/ai/prompts/dsAnalysis";
import { PARKING_ZONE_VALUES, ZONE, isValidZone } from "@/lib/ai/dsAnalysis/prompt-parking";

/** A cell holding more than this is unusable in a spreadsheet UI anyway. */
const MAX_CELL = 1500;

/**
 * One control point, in characters. Beyond this it is not an instruction but a
 * pasted DS description — measured on 45802-B-7, whose first line ran to
 * "…antigel+2l huil boit+huile frein+cullase+colle+fh+5l 5w30".
 */
const MAX_ACTION_LENGTH = 90;

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
  // Style is enforced HERE, not only where the model answers: a stored
  // analysis is replayed straight into this function, so an answer written
  // before a style rule existed would otherwise keep its old shape forever.
  // That is how "Diagnostiquer diagnostic" survived the rule that banned it.
  const actions = enforceActionStyle(analysis.actions);
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
export function mayOverwrite(current: string, lastWritten: string | undefined, next?: string): boolean {
  const c = current.trim();
  if (!c) return true;
  if (lastWritten !== undefined && c === lastWritten.trim()) return true;
  // Identical to what we are about to write: the write is a no-op, so refusing
  // it protects nothing — and refusing forever is what actually happened. A
  // vehicle whose ACTION this app wrote WITHOUT recording it (the no-history
  // path used to skip that) was reported "manual" on every later run, so its
  // cell could never be refreshed again. Allowing the no-op lets the run
  // record what it now knows and unstick itself.
  return next !== undefined && c === next.trim();
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
/**
 * Words that name no symptom. A DS description is often just one of these, and
 * repeating it back produces "Diagnostiquer diagnostic" — a line seen in
 * production twice, on 45372-B-7.
 */
const EMPTY_SUBJECTS = new Set([
  "diagnostic", "diagnostique", "controle", "contrôle", "revision", "révision",
  "pb", "probleme", "problème", "rien", "ras", ".", "-",
]);

const CONTROL_VERBS = /^(contrôler|controler|vérifier|verifier|diagnostiquer|remplacer|effectuer|réaliser|realiser|faire)\s+(l[ea]s?\s+|l'|du\s+|de\s+la\s+|des\s+|au\s+)?/i;

export function enforceActionStyle(actions: readonly string[] | undefined): string[] {
  if (!actions) return [];
  const DATE = /\b(\d{1,2}\/\d{1,2}\/\d{4}|\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})\b/g;
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of actions) {
    let cleaned = String(raw ?? "")
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

    // The controller verifies; he does not diagnose. The prompt says so
    // (rule A1), and this makes it true regardless: "Diagnostiquer pb
    // démarrage" becomes "Vérifier pb démarrage".
    cleaned = cleaned.replace(/^diagnostiquer\b/i, "Vérifier");

    // A subject longer than this is a DS description dumped in whole —
    // "Vérifier pb démarrage antigel+2l huil boit+huile frein+cullase+colle+fh"
    // is not a control point, it is a paste. Cut at a word boundary.
    if (cleaned.length > MAX_ACTION_LENGTH) {
      const cut = cleaned.slice(0, MAX_ACTION_LENGTH);
      const lastSpace = cut.lastIndexOf(" ");
      cleaned = (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).replace(/[\s+,;:.-]+$/, "");
    }

    if (!cleaned) continue;

    // "Diagnostiquer diagnostic": the verb plus a word that names nothing.
    // Dropping it is safe — there is no instruction inside it to lose.
    const subject = cleaned
      .replace(CONTROL_VERBS, "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
    if (EMPTY_SUBJECTS.has(subject)) continue;

    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }

  // "Si conforme : ..." only makes sense after something to check. Alone, the
  // destination is not conditional on anything.
  if (out.length === 1) out[0] = out[0].replace(/^si\s+conforme\s*:\s*/i, "");
  return out;
}

/**
 * The work order a vehicle gets from its STATUS alone, with no maintenance
 * history to reason about.
 *
 * 3 of the 83 vehicles on the live tab have zero DS lines, and the batch used
 * to stop at "aucune intervention DS à analyser" and write nothing — which is
 * exactly the outcome the ACTION column must never produce. A car with no
 * service history is not a car with nothing to do: it is still sitting in the
 * parking, and somebody still has to move it somewhere.
 *
 * Computed in code, not asked of the model: with no history there is nothing to
 * analyse, so a model call would be paying for a lookup table. It doubles as
 * the floor under the model's own answer — see the call site.
 *
 * Order matters. ETAT VÉHICULE decides where the car physically goes, so it
 * outranks ownership; a closed contract does NOT suppress it, because billing
 * stopping is a reason not to REPAIR a vehicle, not a reason to leave it parked
 * where it should not be.
 */
export function statusWorkOrder(v: {
  /** The tab's ETAT VÉHICULE — ATV, Remplacement, LLD, LCD, En stock. */
  etat?: string;
  /** AVIS's own fleet — see googleSheetsParc.ts. */
  isAvis?: boolean;
}): string[] {
  const etat = String(v.etat ?? "").trim().toUpperCase();

  // A BARE ZONE VALUE, not a French sentence. These strings are now parsed back
  // out as the destination and exact-matched against the sheet's dropdown
  // (parseDestinationZone below), so anything this returns has to BE a real
  // ZONING value — a sentence like "À envoyer vers depot-ATV" would fail its own
  // guard and leave the fallback path unable to set a zone at all.
  //
  // They previously read "À envoyer vers depot-ATV" / "depot-rempalcmemnt",
  // spellings from the dropdown as it stood before 2026-08-29. Both the
  // sentence form and those spellings are gone.
  if (etat === "ATV") return [ZONE.ATV];
  if (etat === "REMPLACEMENT") return [ZONE.REMPLACEMENT];
  if (v.isAvis) return [ZONE.PIERRE_PARENT];
  return [ZONE.A_LIVRER];
}

// Any phrasing of a destination line: a bare zone value, or one behind the
// "Si conforme : " prefix. The older French sentence forms ("À envoyer vers
// depot-ATV", "Disponible — à livrer") are still matched so that a REUSED
// analysis stored under the pre-2026-08-29 rules is recognised as carrying a
// destination and gets it replaced, rather than keeping a stale sentence and
// having a second destination appended after it.
const DESTINATION_RE = new RegExp(
  "(" +
    [
      ...PARKING_ZONE_VALUES.map((z) => z.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      "à\\s+livrer\\s+au\\s+client",
      "disponible\\s*[—-]\\s*à\\s+livrer",
      "à\\s+envoyer\\s+vers",
      "garage\\s+Pierre\\s+Parent",
      "depot-rempalcmemnt",
    ].join("|") +
    ")",
  "i"
);

/** Strips the conditional prefix rule A3.5 puts in front of a destination. */
const SI_CONFORME_RE = /^\s*si\s+conforme\s*:\s*/i;

/**
 * The destination zone the MODEL chose, read back out of its own actions list.
 *
 * The last line is the destination by construction (prompt rule A3 point 5),
 * optionally behind "Si conforme : ". Returns null when the list is empty or
 * the last line is not a destination at all — the caller decides what to do
 * about that, because "the model gave no usable zone" is a reportable state,
 * not something to paper over with a default.
 *
 * NOTE this does NOT validate against the real dropdown: it only extracts. The
 * exact-match check lives at the write site so the failure can be surfaced to
 * the operator with the offending string attached.
 */
export function parseDestinationZone(actions: readonly string[]): string | null {
  if (actions.length === 0) return null;
  let last = String(actions[actions.length - 1] ?? "").replace(SI_CONFORME_RE, "").trim();
  
  // Handle A0.0 special routing strings
  if (last.toLowerCase() === "merci de créer le ds et faire entrer à l'atelier") {
    return ZONE.ATELIER;
  }
  
  // Remove "Envoyer vers " prefix and trailing " (Supplier)" for external providers
  last = last.replace(/^Envoyer vers\s+/i, "");
  last = last.replace(/\s*\([^)]*\)$/, "").trim();

  return last || null;
}

/**
 * Ensures the work order ends on exactly one destination line, in last place.
 *
 * WHAT THIS NO LONGER DOES, deliberately (changed 2026-08-29): it used to
 * DISCARD whatever destination the model chose and substitute
 * statusWorkOrder()'s own four-outcome, etat/isAvis-driven answer. That threw
 * away the whole of prompt rule A0.5 — its nine criteria covering carrosserie,
 * prestataire externe, atelier and the rest could never reach the sheet, because
 * this function overwrote the result with one of four French sentences.
 *
 * Now the model's own choice is kept. statusWorkOrder() survives only as the
 * explicit fallback for a vehicle with no analysis to speak of (no DS history)
 * or one whose destination line could not be parsed — passed in by the caller
 * as `fallbackZone`, never reached for on its own here.
 *
 * "Si conforme : " goes on only when something is checked first — a destination
 * with nothing before it is conditional on nothing.
 */
/** The vehicle facts every zone precondition is decided from. */
export type ZoneVehicle = {
  /** ETAT VÉHICULE, as stored. Compared case-insensitively. */
  etat?: string;
  /** AVIS's own fleet — see googleSheetsParc.ts. */
  isAvis?: boolean;
  /** cp's contract `statut` — "Livré" / "Arret facturation" / "Restitué". */
  cpStatus?: string;
  /** ZONING, as currently stored in the sheet. */
  zoning?: string;
};

/** Contract states that mean the vehicle has left the billed fleet (A0.5.1). */
const CLOSED_CONTRACT = ["ARRET FACTURATION", "RESTITUÉ"];

/**
 * THE single source of truth for "may this vehicle receive this zone".
 *
 * Returns a reason string when the zone's precondition is NOT met, null when it
 * is. Both consumers call this one function — withDestination() for the ACTION
 * text and the route's applyZone() for the ZONING cell — so the two columns can
 * never disagree about whether a destination was permitted. Two independent
 * copies of the same boolean is exactly how they would drift apart.
 *
 * WHY THESE CHECKS EXIST. Prompt rule A0.5 gates each zone on a criterion, and
 * the model demonstrably applies a zone whose criterion does not hold. Measured
 * live 2026-08-29 over 8 vehicles: 908977WW and 18148-T-6 were both sent to
 * AVIS-PIERRE-PARENT with a non-AVIS owner AND no part-change action — neither
 * of criterion A0.5.4's two conditions met. A wording fix to that criterion
 * corrected 3 of 6 cases and pushed a previously correct vehicle into the
 * failure set, which is what makes a prompt-only remedy insufficient.
 *
 * ONLY zones whose precondition is a plain fact about the row are here. Criteria
 * 5 and 6 (carrosserie wording, prestataire recurrence) are genuine readings of
 * the history and are deliberately absent — a code check there would re-decide
 * the judgement the model exists to make, and would reject correct answers.
 * Criteria 7, 8 and 9 are residual ("nothing above matched") and have no
 * precondition to verify.
 *
 * NOTE the ATV and REMPLACEMENT entries are precautionary. The over-application
 * was OBSERVED only on AVIS-PIERRE-PARENT; these two share its shape (a
 * necessary, purely factual gate) but no measured failure. Documented as
 * inference, not evidence.
 */
export function zonePreconditionFailure(zone: string, vehicle: ZoneVehicle): string | null {
  const etat = String(vehicle.etat ?? "").trim().toUpperCase();
  const cp = String(vehicle.cpStatus ?? "").trim().toUpperCase();
  const isAvis = vehicle.isAvis === true;
  const currentZoning = String(vehicle.zoning ?? "").trim();

  // A0.0 Bypasses preconditions if the zone was already fixed in the sheet
  if (currentZoning === zone && [ZONE.ATV, ZONE.ATELIER, ZONE.CARROSSERIE, ZONE.PRESTATAIRE_EXTERNE, ZONE.VISITE_TECHNIQUE].includes(zone as any)) {
    return null;
  }

  if (zone === ZONE.PIERRE_PARENT && !(isAvis || etat === "LCD")) {
    return "A0.5.4 exige un propriétaire AVIS / Scal Avis, ou A0.5.3 un ETAT « LCD »";
  }
  if (zone === ZONE.ATV && !(etat === "ATV" || CLOSED_CONTRACT.includes(cp))) {
    return "A0.5.1 exige ETAT « ATV » ou un contrat « Arret facturation » / « Restitué »";
  }
  if (zone === ZONE.REMPLACEMENT && etat !== "REMPLACEMENT") {
    return "A0.5.2 exige ETAT « Remplacement »";
  }
  return null;
}

export function withDestination(
  actions: readonly string[],
  vehicle: ZoneVehicle
): string[] {
  const checks = actions.filter((a) => !DESTINATION_RE.test(a));

  const lastParsed = parseDestinationZone(actions);
  const usable =
    lastParsed !== null && isValidZone(lastParsed) && zonePreconditionFailure(lastParsed, vehicle) === null;
  
  const originalLast = actions.length > 0 ? String(actions[actions.length - 1] ?? "").replace(SI_CONFORME_RE, "").trim() : null;
  
  // Keep original if it's an A0.0 special string, otherwise use the bare parsed zone to drop legacy French sentences.
  const isA00 = originalLast && (
    originalLast.toLowerCase().startsWith("envoyer vers ") || 
    originalLast.toLowerCase() === "merci de créer le ds et faire entrer à l'atelier"
  );

  const chosen = usable ? (isA00 ? originalLast : lastParsed) : statusWorkOrder(vehicle)[0];

  return checks.length > 0 ? [...checks, `Si conforme : ${chosen}`] : [chosen!];
}
