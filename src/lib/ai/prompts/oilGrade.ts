// Oil-grade regression detection, computed in code.
//
// Same rule as every other check in this feature: the comparison is
// deterministic here, the model only narrates the finished result.
//
// ── What the data actually supports ──────────────────────────────────────
//
// Grade is NOT in the VIDANGE package code, which is generic
// ("Vidange 1:Huile+Filtre H+MO", 13,012 lines). It is on a SEPARATE oil line
// in the same DS, with its own code_art:
//     PCA010287  "Huile FV 5W30 SL/CF 200 LT"     8,589
//     PRM053277  "Huile moteur 10W40 1L"          2,336
//     PRM031276  "Huile moteur 5W30 5L"           1,502
// and sometimes only in the DS description ("HUILE 5W30 + FH + CONTROLE
// GENERAL", 2,604 lines). Measured coverage: 28,507 of 52,158 oil-related DS
// carry a readable grade — 54.7%. The rest billed only the package code and
// are genuinely undeterminable; they are skipped, never guessed.
//
// Ambiguity within one DS is negligible and is handled rather than assumed:
// 25,946 DS carry exactly one distinct grade, 17 carry two. Those 17 return
// "ambiguous" instead of picking one.
//
// ── Why this is a REGRESSION check and not a consistency check ────────────
//
// The obvious check — "flag when the grade changes between consecutive oil
// changes" — is unusable here. The fleet migrated 10W40 -> 5W30 across
// 2023-2024, measured over every graded oil line:
//
//     2022   4,084 lines    5W30  1%    10W40 88%
//     2023   5,876 lines    5W30  8%    10W40 77%
//     2024   7,906 lines    5W30 74%    10W40 24%
//     2025   6,858 lines    5W30 93%    10W40  6%
//     2026   1,416 lines    5W30 92%    10W40  2%
//
// So a plain change-detector fires on essentially every vehicle whose history
// spans 2023-2024, reporting the fleet's own deliberate policy change as an
// anomaly hundreds of times. That is the noise failure this feature avoids
// everywhere else.
//
// The signal that survives is the INVERSE: a vehicle that has already been
// switched to 5W30 and then, at a LATER service, receives something else.
// That is a backslide against the vehicle's own established grade — grounded
// entirely in that one vehicle's history, requiring no manufacturer spec.
//
// ── What this check deliberately does NOT claim ───────────────────────────
//
// There is no source of truth in this project for the manufacturer-specified
// grade of a given vehicle. `parc` carries marque/modele but no oil spec;
// neither does `cp` or `bc`. So this check NEVER says a grade is wrong for the
// engine — only that it departs from what this vehicle was already receiving.
// Wording the model is given reflects that, and asks for a human check rather
// than asserting a fault.

import type { IntervalEntry } from "@/lib/ai/prompts/maintenanceIntervals";

/**
 * Real SAE viscosity grades, as a whitelist.
 *
 * A whitelist rather than a bare /\d{1,2}W\d{2}/ pattern because that pattern
 * has a real false positive in production: "Lampe 2p W 21/5W 12V" (78 lines)
 * yields "5W12", which is not a grade. Requiring a genuine SAE grade drops it
 * without needing to guess whether a line is oil-related from its wording,
 * which also lets odd-but-real spellings through ("10.4 10W40 - 1L (15)").
 */
const KNOWN_GRADES = new Set([
  "0W16", "0W20", "0W30", "0W40",
  "5W20", "5W30", "5W40", "5W50",
  "10W30", "10W40", "10W50", "10W60",
  "15W40", "15W50", "20W50",
]);

/**
 * The grade the fleet standardised on, per the year table above: 93% of 2025
 * and 92% of 2026 oil lines. Used ONLY to decide which direction of change is
 * worth reporting — never asserted as correct for any particular engine.
 */
export const ESTABLISHED_GRADE = "5W30";

/**
 * Canonical form of one grade token: uppercase, separators stripped.
 * Real spellings found in production include "5W30", "5w30", "10W40",
 * "5W-30" and spaced variants, all of which must collapse to one value.
 */
function canonicalGrade(raw: string): string | null {
  const c = raw.toUpperCase().replace(/[\s-]/g, "");
  return KNOWN_GRADES.has(c) ? c : null;
}

const GRADE_TOKEN = /\b\d{1,2}\s*W\s*-?\s*\d{2}\b/gi;

/** Every distinct valid grade mentioned anywhere in one piece of text. */
function gradesInText(text: string | undefined): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const m of text.match(GRADE_TOKEN) ?? []) {
    const g = canonicalGrade(m);
    if (g) found.add(g);
  }
  return [...found];
}

export type EntryGrade =
  /** Exactly one grade readable for this service. */
  | { kind: "known"; grade: string }
  /** No grade recorded — the package code was billed alone. Skipped, not guessed. */
  | { kind: "absent" }
  /** Two different grades on one DS. Reported as such rather than resolved. */
  | { kind: "ambiguous"; grades: string[] };

/**
 * The grade used at one service, read from its part designations AND its
 * description — both carry it in production, and either alone loses entries.
 */
export function gradeOfEntry(entry: IntervalEntry): EntryGrade {
  const found = new Set<string>();
  for (const p of entry.parts) for (const g of gradesInText(String(p))) found.add(g);
  for (const g of gradesInText(entry.description)) found.add(g);

  if (found.size === 0) return { kind: "absent" };
  if (found.size === 1) return { kind: "known", grade: [...found][0] };
  return { kind: "ambiguous", grades: [...found].sort() };
}

export type OilGradeStatus =
  /** Established on ESTABLISHED_GRADE, then a later service used another. */
  | "regression"
  /** Nothing to report — deliberately silent. */
  | "ok"
  /** Never established on ESTABLISHED_GRADE, so there is no baseline to depart from. */
  | "not_applicable"
  /** No entry carries a readable grade at all. */
  | "unknown";

export type OilGradeOccurrence = { date?: string; km?: number; grade: string };

export type OilGradeCheck = {
  label: string;
  status: OilGradeStatus;
  establishedGrade: string;
  /** The first service that put this vehicle on ESTABLISHED_GRADE. */
  establishedAt?: OilGradeOccurrence;
  /** Later services that used something else. */
  regressions: OilGradeOccurrence[];
  /** Services whose DS carried two grades at once — named, never resolved. */
  ambiguous: { date?: string; grades: string[] }[];
  /** How many services had a readable grade, out of how many were examined. */
  gradedCount: number;
  examinedCount: number;
  note?: string;
};

/**
 * Rule 15. Chronological, on dates as recorded — no km arithmetic, so the
 * odometer-coherence problem that shapes every other check does not apply
 * here. Entries with no date sort last and cannot establish a baseline.
 */
export function checkOilGrade(entries: readonly IntervalEntry[]): OilGradeCheck {
  const label = "Grade d'huile";
  const base = { label, establishedGrade: ESTABLISHED_GRADE };

  const graded: { date?: string; km?: number; g: EntryGrade }[] = [];
  for (const e of entries) {
    const g = gradeOfEntry(e);
    if (g.kind !== "absent") graded.push({ date: e.date, km: e.km, g });
  }
  graded.sort((a, b) => String(a.date ?? "￿").localeCompare(String(b.date ?? "￿")));

  const ambiguous = graded
    .filter((x) => x.g.kind === "ambiguous")
    .map((x) => ({ date: x.date, grades: (x.g as { grades: string[] }).grades }));

  const known = graded.filter((x) => x.g.kind === "known") as {
    date?: string; km?: number; g: { kind: "known"; grade: string };
  }[];

  const common = {
    ...base,
    regressions: [] as OilGradeOccurrence[],
    ambiguous,
    gradedCount: known.length,
    examinedCount: entries.length,
  };

  if (known.length === 0) {
    return { ...common, status: "unknown", note: "Aucun grade d'huile lisible dans l'historique fourni." };
  }

  const firstEstablished = known.findIndex((x) => x.g.grade === ESTABLISHED_GRADE);
  if (firstEstablished === -1) {
    return { ...common, status: "not_applicable" };
  }

  const establishedAt = {
    date: known[firstEstablished].date,
    km: known[firstEstablished].km,
    grade: ESTABLISHED_GRADE,
  };
  const regressions = known
    .slice(firstEstablished + 1)
    .filter((x) => x.g.grade !== ESTABLISHED_GRADE)
    .map((x) => ({ date: x.date, km: x.km, grade: x.g.grade }));

  return {
    ...common,
    status: regressions.length > 0 ? "regression" : "ok",
    establishedAt,
    regressions,
  };
}

/**
 * Prompt line for rule 15. Empty unless a regression actually fired — same
 * silence-by-design as the belt/pump check. "ok"/"not_applicable"/"unknown"
 * are all normal states that do not deserve a finding.
 */
export function formatOilGradeCheck(c: OilGradeCheck): string[] {
  if (c.status !== "regression") return [];
  const at = (o: { date?: string; km?: number }) =>
    `${o.date?.slice(0, 10) ?? "date inconnue"}${o.km != null ? ` à ${o.km.toLocaleString("fr-FR")} km` : ""}`;
  const list = c.regressions.map((r) => `${r.grade} le ${at(r)}`).join(", ");
  return [
    `- ${c.label} : RETOUR EN ARRIÈRE — ce véhicule est passé au ${c.establishedGrade} le ${at(c.establishedAt!)}, ` +
      `puis ${c.regressions.length === 1 ? "une intervention ultérieure a utilisé" : `${c.regressions.length} interventions ultérieures ont utilisé`} un autre grade : ${list}. ` +
      `Le grade prescrit par le constructeur n'est pas connu de cette application : signaler l'écart, sans affirmer lequel est correct.`,
  ];
}
