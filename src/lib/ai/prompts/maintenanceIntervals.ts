// Maintenance-interval compliance, computed in code.
//
// Deliberately NOT asked of the model, for the same reason contract-date
// arithmetic is not: km subtraction and threshold comparison are deterministic,
// models are unreliable at arithmetic, and computing it here makes every check
// independently unit-testable. The model receives finished facts to narrate.
//
// ── The data hazard this is built around ──────────────────────────────────
// Odometer readings in `ds` are NOT reliably monotonic. Measured over 400
// vehicles with >=10 DS: 55.3% strictly non-decreasing, 44.8% carry at least
// one backward step. Only 4.1% of individual steps go backwards, so it is
// sparse noise rather than systemic — but 68 of those 400 had a drop larger
// than 5,000 km (worst observed: -30,574). Naive "current km minus last
// service km" would therefore emit confident nonsense ("overdue by 30,000 km")
// on a large minority of vehicles. Every check below returns "unknown" with a
// stated reason rather than a number it cannot stand behind.

import type { ServiceType } from "@/lib/ai/prompts/serviceTypes";
import { servicesInEntry, isTechnicalInspection } from "@/lib/ai/prompts/serviceTypes";

/** Fixed thresholds. There is no per-model interval data in this project. */
export const INTERVALS: Partial<Record<ServiceType, number>> = {
  vidange: 10_000,
  filtre_air: 30_000,
  filtre_gasoil: 40_000,
};

export const SERVICE_LABELS: Record<ServiceType, string> = {
  vidange: "Vidange",
  filtre_air: "Filtre à air",
  filtre_gasoil: "Filtre à gasoil",
  distribution: "Kit de distribution",
  pompe_eau: "Pompe à eau",
};

export type IntervalStatus = "ok" | "overdue" | "never" | "unknown";

export type IntervalCheck = {
  service: ServiceType;
  label: string;
  intervalKm: number;
  status: IntervalStatus;
  /** Real readings dropped to obtain a coherent run — always named, never silent. */
  excludedReadings?: KmReading[];
  /** km at the most recent service of this type. */
  lastKm?: number;
  lastDate?: string;
  /** Best estimate of the vehicle's current odometer. */
  currentKm?: number;
  kmSince?: number;
  overdueByKm?: number;
  /** Why the status is "unknown" — always set when it is. */
  note?: string;
};

/** One DS entry, as the analysis payload carries it. */
export type IntervalEntry = {
  date?: string;
  km?: number;
  /** Needed to spot a Visite Technique — VT is named here far more often than in parts. */
  description?: string;
  parts: readonly unknown[];
};

/** A real reading actually present in the source, never interpolated. */
export type KmReading = { date?: string; km: number };

/**
 * Entries whose km can be trusted for arithmetic: everything except the
 * regulatory inspection, whose mileage is routinely back-dated. Excluded from
 * KM MATH ONLY — VT entries still appear in the history the model sees and in
 * every UI/export that displays km.
 */
export function usableKmEntries(entries: readonly IntervalEntry[]): IntervalEntry[] {
  return entries.filter((e) => !isTechnicalInspection(e.description, e.parts));
}

/** Mongo stores km as int, string, and double — coerce, don't trust the type. */
function toKm(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(/[\s,]/g, ""));
  return Number.isFinite(n) && n > 0 && n <= 1_000_000 ? n : null;
}

/**
 * Best estimate of the current odometer: the HIGHEST plausible reading, not
 * the latest. An odometer only goes up, so the maximum is robust to a single
 * mistyped low reading at the end of the history — which the 4.1% backward-step
 * rate makes a real possibility.
 */
export function currentKmOf(entries: readonly IntervalEntry[]): number | null {
  let max: number | null = null;
  for (const e of usableKmEntries(entries)) {
    const k = toKm(e.km);
    if (k !== null && (max === null || k > max)) max = k;
  }
  return max;
}

/**
 * Greedy forward scan keeping a non-decreasing run: keep the first reading,
 * then keep each later one only if it is not below the last kept. Everything
 * dropped is returned so it can be named in the finding.
 *
 * This is the "one more attempt before giving up" step. It uses only readings
 * that genuinely exist — nothing is interpolated, averaged, or corrected into
 * a value that was never recorded. If the FIRST reading is itself the inflated
 * outlier, this correctly collapses to a single kept reading and the caller
 * gives up, which is the desired behaviour rather than a rescued wrong answer.
 */
export function longestCleanRun(readings: readonly KmReading[]): {
  kept: KmReading[];
  excluded: KmReading[];
} {
  const kept: KmReading[] = [];
  const excluded: KmReading[] = [];
  for (const r of readings) {
    if (kept.length === 0 || r.km >= kept[kept.length - 1].km - KM_REGRESSION_TOLERANCE) {
      kept.push(r);
    } else {
      excluded.push(r);
    }
  }
  return { kept, excluded };
}

/**
 * Small backward steps are keying noise (the most common observed drop was
 * -67 km); large ones mean the odometer was replaced, the reading was badly
 * mistyped, or the plate was reassigned. 1,000 km separates the two cleanly
 * against the observed distribution.
 */
const KM_REGRESSION_TOLERANCE = 1_000;

/**
 * True when the odometer runs backwards within [since, now] — the only window
 * that matters for "km since the last service of type X".
 *
 * Checked EXPLICITLY rather than inferred from a negative gap, because
 * currentKmOf() takes the maximum reading, which by construction is never less
 * than an earlier one — so a backward step would otherwise be invisible and
 * silently produce a confident "ok". Found by a test, not by reading.
 *
 * SCOPED to the window rather than the whole history, which matters more than
 * it sounds: scanning a real sample of the highest-DS vehicles, 5 of 6 contain
 * at least one bad reading somewhere across 50-60 entries, so a whole-history
 * guard reported "indéterminé" for every check on exactly the vehicles whose
 * long histories most warrant analysis. A mistyped reading in 2022 says
 * nothing about the gap since a 2025 service.
 */
export function hasIncoherentKmSequence(
  entries: readonly IntervalEntry[],
  sinceDate?: string
): boolean {
  const seq = entries
    .filter((e) => toKm(e.km) !== null)
    .map((e) => ({ km: toKm(e.km) as number, date: String(e.date ?? "") }))
    .filter((e) => (sinceDate ? e.date >= sinceDate : true))
    .sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < seq.length; i++) {
    if (seq[i].km - seq[i - 1].km < -KM_REGRESSION_TOLERANCE) return true;
  }
  return false;
}

/**
 * Compliance for one service type.
 *
 * "never" is distinct from "overdue": a vehicle with no recorded oil change at
 * all is a different (and often more suspicious) statement than one whose last
 * change was too long ago, and conflating them would overstate what the data
 * supports.
 */
export function checkInterval(
  service: ServiceType,
  entries: readonly IntervalEntry[]
): IntervalCheck {
  const intervalKm = INTERVALS[service];
  const base = { service, label: SERVICE_LABELS[service], intervalKm: intervalKm ?? 0 };
  if (intervalKm == null) {
    return { ...base, status: "unknown", note: "Aucun intervalle défini pour ce service." };
  }

  // Step 0: drop Visite Technique entries. Their mileage is back-dated, and
  // they caused about a third of all observed backward steps.
  const usable = usableKmEntries(entries);

  const currentKm = currentKmOf(entries);
  if (currentKm === null) {
    return { ...base, status: "unknown", note: "Aucun relevé kilométrique exploitable." };
  }

  // Latest entry (by date) that actually performed this service.
  const performed: { km: number; date?: string }[] = [];
  for (const e of usable) {
    if (!servicesInEntry(e.parts).has(service)) continue;
    const km = toKm(e.km);
    if (km !== null) performed.push({ km, date: e.date });
  }
  performed.sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));

  if (performed.length === 0) {
    return { ...base, status: "never", currentKm, note: "Aucune intervention de ce type enregistrée." };
  }

  const last = performed[performed.length - 1];
  const since = String(last.date ?? "");

  // The window that actually matters: readings from that service onward. A bad
  // reading from two years and forty entries ago must not block a calculation
  // that only needs the last three.
  const window: KmReading[] = [];
  for (const e of usable) {
    const km = toKm(e.km);
    if (km === null) continue;
    if (String(e.date ?? "") < since) continue;
    window.push({ date: e.date, km });
  }
  window.sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));

  const finish = (
    readings: readonly KmReading[],
    excluded: KmReading[]
  ): IntervalCheck => {
    const effectiveCurrent = Math.max(...readings.map((r) => r.km));
    const kmSince = effectiveCurrent - last.km;
    const overdue = kmSince > intervalKm;
    return {
      ...base,
      status: overdue ? "overdue" : "ok",
      lastKm: last.km,
      lastDate: last.date,
      currentKm: effectiveCurrent,
      kmSince,
      ...(overdue ? { overdueByKm: kmSince - intervalKm } : {}),
      ...(excluded.length > 0 ? { excludedReadings: excluded } : {}),
    };
  };

  // Step 1: if the window is already coherent, compute normally.
  if (!hasIncoherentKmSequence(usable, since)) {
    return finish(window, []);
  }

  // Step 2: one more attempt — keep the longest non-decreasing run of REAL
  // readings within the window and compute against that, naming everything
  // dropped. Nothing is interpolated or corrected.
  const { kept, excluded } = longestCleanRun(window);
  if (kept.length >= 2) {
    return finish(kept, excluded);
  }

  // Step 3: genuinely unrecoverable. Say specifically why.
  return {
    ...base,
    status: "unknown",
    lastKm: last.km,
    lastDate: last.date,
    currentKm,
    ...(excluded.length > 0 ? { excludedReadings: excluded } : {}),
    note:
      "Relevés en recul à chaque point de la fenêtre depuis cette intervention — " +
      "aucun segment cohérent exploitable, écart non calculable.",
  };
}


/** Rules 1, 3 and 4 — the three unambiguous fixed-interval checks. */
export const CHECKED_SERVICES: ServiceType[] = ["vidange", "filtre_gasoil", "filtre_air"];

export function computeIntervalChecks(entries: readonly IntervalEntry[]): IntervalCheck[] {
  return CHECKED_SERVICES.map((s) => checkInterval(s, entries));
}

/** Renders the computed facts for the prompt. The model narrates these. */
export function formatIntervalChecks(checks: readonly IntervalCheck[]): string[] {
  return checks.map((c) => {
    const head = `${c.label} (intervalle ${c.intervalKm.toLocaleString("fr-FR")} km)`;
    switch (c.status) {
      case "ok":
        return `- ${head} : À JOUR — ${c.kmSince?.toLocaleString("fr-FR")} km depuis le dernier (${c.lastDate?.slice(0, 10)} à ${c.lastKm?.toLocaleString("fr-FR")} km), compteur actuel ${c.currentKm?.toLocaleString("fr-FR")} km.`;
      case "overdue":
        return `- ${head} : DÉPASSÉ de ${c.overdueByKm?.toLocaleString("fr-FR")} km — ${c.kmSince?.toLocaleString("fr-FR")} km depuis le dernier (${c.lastDate?.slice(0, 10)} à ${c.lastKm?.toLocaleString("fr-FR")} km), compteur actuel ${c.currentKm?.toLocaleString("fr-FR")} km.`;
      case "never":
        return `- ${head} : JAMAIS ENREGISTRÉ dans l'historique fourni (compteur actuel ${c.currentKm?.toLocaleString("fr-FR")} km).`;
      default:
        return `- ${head} : INDÉTERMINÉ — ${c.note}`;
    }
  });
}


// ── Rule 2: timing belt / water pump ──────────────────────────────────────
//
// NOT an interval check. There is no per-model interval data in this project
// (kb_specs / part_families exist in no collection, no database on the
// cluster, and nowhere in git history), so "overdue by X km" is not a
// statement this data supports.
//
// MILEAGE ONLY. The original spec also required the vehicle to be >6 months
// past its contract end; that condition was removed on real-world feedback —
// a high-mileage vehicle that has never had a timing belt or water pump is a
// real risk whether its contract is active, ending, or long over. This check
// no longer reads date_fin_contrat at all.

const BELT_PUMP_KM_THRESHOLD = 120_000;
const BELT_PUMP_SERVICES: ServiceType[] = ["distribution", "pompe_eau"];

export type BeltPumpStatus =
  /** Current km could not be established — the check cannot run, and says so. */
  | "skipped"
  /** Over the threshold and never recorded. The flag. */
  | "never"
  /** A service is on record. Shown, matching the other checks' positive state. */
  | "ok"
  /** Under the km threshold. Deliberately silent. */
  | "not_applicable";

export type BeltPumpCheck = {
  label: string;
  status: BeltPumpStatus;
  thresholdKm: number;
  currentKm?: number;
  lastServiceDate?: string;
  lastServiceKm?: number;
  /** Always set for "skipped"; explains why. */
  note?: string;
};

/**
 * Rule 2, mileage-only. Reuses the same service matcher and the same odometer
 * helper as the other checks — including the Visite Technique exclusion, so an
 * inflated VT reading cannot push a vehicle over the threshold on its own.
 */
export function checkBeltPump(entries: readonly IntervalEntry[]): BeltPumpCheck {
  const label = "Distribution / pompe à eau";
  const base = { label, thresholdKm: BELT_PUMP_KM_THRESHOLD };

  const currentKm = currentKmOf(entries) ?? undefined;

  // Latest recorded belt-or-pump service, if any. VT entries are irrelevant
  // here but excluded anyway for consistency with the km used above.
  let last: { km: number | null; date?: string } | null = null;
  for (const e of usableKmEntries(entries)) {
    const svc = servicesInEntry(e.parts);
    if (!BELT_PUMP_SERVICES.some((sv) => svc.has(sv))) continue;
    const d = String(e.date ?? "");
    if (!last || d > String(last.date ?? "")) last = { km: toKm(e.km), date: e.date };
  }

  if (last) {
    return {
      ...base,
      status: "ok",
      currentKm,
      lastServiceDate: last.date,
      ...(last.km !== null ? { lastServiceKm: last.km } : {}),
    };
  }

  if (currentKm === undefined) {
    return {
      ...base,
      status: "skipped",
      note: "Kilométrage actuel indéterminable — contrôle non effectué.",
    };
  }

  if (currentKm <= BELT_PUMP_KM_THRESHOLD) {
    return { ...base, status: "not_applicable", currentKm };
  }

  return { ...base, status: "never", currentKm };
}

/** Prompt line for rule 2. Empty when not applicable — silence by design. */
export function formatBeltPumpCheck(c: BeltPumpCheck): string[] {
  const fr = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "?");
  switch (c.status) {
    case "skipped":
      return [`- ${c.label} : NON VÉRIFIÉ — ${c.note}`];
    case "never":
      return [
        `- ${c.label} : JAMAIS ENREGISTRÉ alors que le véhicule affiche ${c.currentKm?.toLocaleString("fr-FR")} km (seuil ${c.thresholdKm.toLocaleString("fr-FR")} km).`,
      ];
    case "ok":
      return [
        `- ${c.label} : DÉJÀ EFFECTUÉ le ${fr(c.lastServiceDate)}${c.lastServiceKm ? ` à ${c.lastServiceKm.toLocaleString("fr-FR")} km` : ""}.`,
      ];
    default:
      return [];
  }
}


// ── Rules reference (follow-up path only) ─────────────────────────────────
//
// The main analysis is deliberately SILENT about checks that did not fire:
// formatIntervalChecks() narrates only what it found, and formatBeltPumpCheck()
// returns [] for "not_applicable". That silence is right for the analysis —
// a clean vehicle should not produce a wall of "this rule did not apply".
//
// It is wrong for a FOLLOW-UP. Live on 44329-B-7 someone asked why the timing
// belt was never flagged; the vehicle sits at 118,157 km against a 120,000 km
// threshold, so rule 2 correctly stayed silent — but "correctly silent" and
// "absent from the prompt" are the same thing to the model, which could only
// answer "no such intervention exists in the history". Factually true, and it
// completely missed the point: the reason it was not flagged is the threshold,
// not the data gap.
//
// So the follow-up gets EVERY rule stated with its threshold and this
// vehicle's actual computed value against it — including the ones that did not
// fire — reusing the exact same IntervalCheck/BeltPumpCheck objects the
// analysis was built from. Nothing is recomputed, so the two turns can never
// disagree about a number.

/**
 * Every tracked rule, its threshold, and where this vehicle actually stands —
 * including rules that did not fire. Follow-up prompt only.
 */
export function formatRulesReference(
  checks: readonly IntervalCheck[],
  belt: BeltPumpCheck
): string[] {
  const km = (n?: number) => (n === undefined ? "?" : n.toLocaleString("fr-FR"));

  const lines = checks.map((c) => {
    const head = `- ${c.label} — règle : à refaire tous les ${km(c.intervalKm)} km.`;
    switch (c.status) {
      case "ok":
        return `${head} Statut calculé : RESPECTÉE — dernier le ${c.lastDate?.slice(0, 10)} à ${km(c.lastKm)} km, compteur ${km(c.currentKm)} km, soit ${km(c.kmSince)} km parcourus depuis (sous le seuil).`;
      case "overdue":
        return `${head} Statut calculé : DÉPASSÉE de ${km(c.overdueByKm)} km — dernier le ${c.lastDate?.slice(0, 10)} à ${km(c.lastKm)} km, compteur ${km(c.currentKm)} km.`;
      case "never":
        return `${head} Statut calculé : AUCUNE intervention de ce type dans l'historique (compteur ${km(c.currentKm)} km).`;
      default:
        return `${head} Statut calculé : INDÉTERMINÉ — ${c.note}`;
    }
  });

  const bHead = `- ${belt.label} — règle : signalé UNIQUEMENT si le véhicule dépasse ${km(belt.thresholdKm)} km sans aucune intervention enregistrée.`;
  switch (belt.status) {
    case "not_applicable":
      lines.push(
        `${bHead} Statut calculé : NON APPLICABLE — le compteur fiable est à ${km(belt.currentKm)} km, soit ${km(belt.thresholdKm - (belt.currentKm ?? 0))} km sous le seuil. Aucune intervention n'est enregistrée, mais la règle ne s'applique pas encore : l'absence seule ne constitue pas une anomalie à ce kilométrage.`
      );
      break;
    case "never":
      lines.push(
        `${bHead} Statut calculé : DÉCLENCHÉE — compteur ${km(belt.currentKm)} km, au-dessus du seuil, et aucune intervention enregistrée.`
      );
      break;
    case "ok":
      lines.push(
        `${bHead} Statut calculé : NON APPLICABLE — une intervention est enregistrée le ${belt.lastServiceDate?.slice(0, 10) ?? "?"}${belt.lastServiceKm ? ` à ${km(belt.lastServiceKm)} km` : ""}.`
      );
      break;
    default:
      lines.push(`${bHead} Statut calculé : NON VÉRIFIÉ — ${belt.note}`);
  }

  return lines;
}
