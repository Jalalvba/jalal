// Detecting which maintenance service a DS line represents, from AVIS's own
// free-text part designations (ds["Désignation Consomation"] — the misspelling
// is the real field name).
//
// This is harder than matching keywords, for two reasons found by reading
// production data rather than assuming:
//
// 1. AVIS logs oil services as PACKAGE CODES, not as separate lines:
//      VIDANGE 1:HUILE+FILTRE H+MO      oil + oil filter        23,486
//      VIDANGE 2:HUILE+FILTRE H/A+MO    oil + oil + AIR filter  15,015
//      VIDANGE 4: HUILE+FILTRE H/G+MO   oil + oil + GASOIL      1,633
//      VIDANGE 3:HUIL+FILTRE H/A/G+MO   oil + air + gasoil        621
//    H=huile A=air G=gasoil C=clim P=pollen. So an air-filter change is
//    usually NOT its own line — it is the "A" inside a VIDANGE 2. Detecting
//    air filters only via "FILTRE A AIR" lines would miss ~15,000 services.
//
// 2. The obvious keywords have high-volume FALSE POSITIVES:
//      COURROIE ALTERNATEUR (724) / D'ACCESSOIRE (261) are NOT the timing
//      belt — matching on "courroie" alone is ~75% wrong.
//      FILTRE A HUILE (26,379) is the oil FILTER part, not an oil change.
//      BOUCHON / JOINT POMPE A EAU are a cap and a gasket, not the pump.
//      DURITE FILTRE A AIR is a hose; FILTRE A CLIM/POLLEN is the cabin
//      filter, a different service entirely.

export type ServiceType =
  | "vidange"
  | "filtre_air"
  | "filtre_gasoil"
  | "distribution"
  | "pompe_eau";

/** Accent-insensitive, case-insensitive, whitespace-collapsed. */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Lines that merely mention a part without being that service.
const OIL_FILTER_ONLY = /FILTRE\s*A?\s*HUILE/;
const PUMP_EXCLUSIONS = /(BOUCHON|JOINT|AUXILIAIRE|ELECTRIQUE)\s+.*POMPE|POMPE\s+D'AMOR|POMPE\s+A\s+GASOIL/;
const AIR_EXCLUSIONS = /DURITE|PAPPILLON|PAPILLON|TRACTION/;
const FUEL_EXCLUSIONS = /POMPE|CAPTEUR|JAUGE|RESERVOIR|BOUCHON/;

/**
 * Extracts the filter-code group from a VIDANGE package, e.g. "H/A/G" from
 * "VIDANGE 3:HUIL+FILTRE H/A/G+MO".
 *
 * Requires the letters to be followed by "+" or end-of-segment, which is what
 * separates a code group from a spelled-out name: "FILTRE H/A+MO" matches,
 * "FILTRE A AIR" does not (the "A" is followed by a space and a word, not a
 * "+"). That distinction matters because "FILTRE A GASOIL" would otherwise
 * parse as code "A" = air, i.e. exactly backwards.
 */
function vidangeFilterCodes(text: string): Set<string> {
  const codes = new Set<string>();
  const m = text.match(/FILTRE\s+((?:[HAGCP]\s*[/+]\s*)*[HAGCP])(?=\s*[+]|\s*$)/);
  if (m) for (const ch of m[1].replace(/[^HAGCP]/g, "")) codes.add(ch);
  return codes;
}

/**
 * Which services one part designation represents. A single line can represent
 * several — a VIDANGE 3 is an oil change AND an air filter AND a fuel filter.
 */
export function detectServices(designation: unknown): Set<ServiceType> {
  // String()-coerced: these come from Mongo and do not honour their declared
  // types (26,573 km values are stored as strings, and qte as "2").
  const t = normalize(String(designation ?? ""));
  const out = new Set<ServiceType>();
  if (!t) return out;

  const isVidange = /\bVIDANGE\b/.test(t) && !/VIDANGE\s*5\s*:|BOITE A VITESSE|\bBVA?\b/.test(t);
  if (isVidange) {
    out.add("vidange");
    const codes = vidangeFilterCodes(t);
    if (codes.has("A")) out.add("filtre_air");
    if (codes.has("G")) out.add("filtre_gasoil");
  }

  // Explicit names, which also appear appended to VIDANGE lines (+FA, +F AIR).
  if (!AIR_EXCLUSIONS.test(t) && /FILTRE\s*A?\s*AIR|\bF\.?\s?AIR\b|\+\s*FA\b/.test(t)) {
    out.add("filtre_air");
  }
  if (!FUEL_EXCLUSIONS.test(t) && /FILTRE\s*A?\s*(GASOIL|GAZOIL|CARBURANT)/.test(t)) {
    out.add("filtre_gasoil");
  }

  // Timing belt: only "distribution" counts. An alternator or accessory belt
  // is a different, far cheaper part on a different schedule.
  if (/DISTRIBUTION|DISTRIB\b|DISTRI\b|DISTRB|DISTYRI|DISTRIBU/.test(t)) {
    out.add("distribution");
  }

  if (!PUMP_EXCLUSIONS.test(t) && /POMPE\s*A?\s*EAU/.test(t)) {
    out.add("pompe_eau");
  }

  // An oil-filter-only line is not an oil change.
  if (out.size === 0 && OIL_FILTER_ONLY.test(t)) return out;

  return out;
}

/** Convenience: the services represented anywhere in one DS entry's parts. */
export function servicesInEntry(parts: readonly unknown[]): Set<ServiceType> {
  const all = new Set<ServiceType>();
  for (const p of parts) for (const s of detectServices(p)) all.add(s);
  return all;
}


// ── Regulatory inspection (Visite Technique) ──────────────────────────────

/**
 * A "Visite Technique" is the Moroccan regulatory roadworthiness inspection —
 * a legal check, not a maintenance service. Its km value is routinely entered
 * late and not synced to the real odometer at the time of the visit, which
 * makes these readings actively misleading for interval arithmetic.
 *
 * Measured: excluding VT entries from the km sequence takes the share of
 * vehicles with a clean, non-decreasing odometer from 72.5% to 81.3% (35 of
 * 400 sampled vehicles fixed outright) and removes about a third of all
 * backward steps. On 44329-B-7 — the vehicle that surfaced this — it removes
 * the single backward step entirely: a VT logged 130,000 km, and the next real
 * entry read 118,157.
 *
 * The pattern is deliberately typo-tolerant, because the real data is: VISITE
 * TECHNIQUE, VIISTE TECHNIQUE (110 rows), VIISITE, VISIITE, VSITE, TECHNQIUE,
 * TECHNQUE, TECHEIQUE, TECHNIQIUE, TECHNIUQE, "VISITE VTECHNIQUE". Validated
 * against every TECH-containing row in production: 3,877 classified as VT,
 * and the non-VT rows it must NOT catch ("TECH. = RACHID …", "RéVISION:
 * OTHMANE TECHNICIEN") are all correctly rejected.
 */
const VT_PATTERN = /(V[I]{0,2}S[I]{0,2}TE|CONTR[ÔO]?LE)\s*V?TECH|DEFAUTS?\s*VT\b/i;

/**
 * VT appears in the DS-level `description` far more often than in the part
 * designations (3,702 vs 1,063), so both are checked.
 */
export function isTechnicalInspection(description: unknown, parts: readonly unknown[]): boolean {
  const text = normalize(String(description ?? "") + " " + parts.map((p) => String(p ?? "")).join(" "));
  return VT_PATTERN.test(text);
}
