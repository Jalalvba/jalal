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
import { servicesInEntry } from "@/lib/ai/prompts/serviceTypes";

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
export type IntervalEntry = { date?: string; km?: number; parts: readonly unknown[] };

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
  for (const e of entries) {
    const k = toKm(e.km);
    if (k !== null && (max === null || k > max)) max = k;
  }
  return max;
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

  const currentKm = currentKmOf(entries);
  if (currentKm === null) {
    return { ...base, status: "unknown", note: "Aucun relevé kilométrique exploitable." };
  }

  // Latest entry (by date) that actually performed this service.
  const performed: { km: number; date?: string }[] = [];
  for (const e of entries) {
    if (!servicesInEntry(e.parts).has(service)) continue;
    const km = toKm(e.km);
    if (km !== null) performed.push({ km, date: e.date });
  }
  performed.sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));

  if (performed.length === 0) {
    return { ...base, status: "never", currentKm, note: "Aucune intervention de ce type enregistrée." };
  }

  const last = performed[performed.length - 1];

  // Only the window since that service needs to be trustworthy.
  if (hasIncoherentKmSequence(entries, String(last.date ?? ""))) {
    return {
      ...base,
      status: "unknown",
      lastKm: last.km,
      lastDate: last.date,
      currentKm,
      note: "Relevés kilométriques incohérents depuis cette intervention (compteur en recul) — écart non calculable.",
    };
  }

  // currentKm is the max over ALL entries, which can exceed the max within the
  // window; recompute it inside the window so the gap describes the same span
  // the coherence check just validated.
  const windowMax = currentKmOf(
    entries.filter((e) => String(e.date ?? "") >= String(last.date ?? ""))
  );
  const effectiveCurrent = windowMax ?? currentKm;
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
