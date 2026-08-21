// One vehicle identity, merged from the two collections that describe a
// vehicle: `parc` (fleet master data) and `cp` (contract data).
//
// ── Why this exists ──────────────────────────────────────────────────────
//
// VehicleCard used to take `parc: ParcItem` as a required prop, so the card
// rendered only when the plate had a `parc` record. Measured against live
// data, that hides the card far more often than it sounds:
//
//   11,169  distinct plates in `ds`
//    5,201  have NO `parc` record            (46.6% — no card at all)
//    3,202  of those DO have a `cp` record   (identity data exists, was discarded)
//    1,999  have neither                     (genuinely nothing to show)
//
// So for 3,202 plates the page was already fetching real marque, modèle, VIN,
// gestionnaire and contract dates, then rendering nothing. This was reported
// as "the VehicleCard is broken in production"; it was not a regression —
// `git blame` dates the conditional to 2026-03-20 — but the effect is a card
// that silently vanishes on nearly half the fleet.
//
// ── What cp can and cannot supply ────────────────────────────────────────
//
// Measured across the 3,250 cp rows belonging to those 3,202 plates:
//
//   imm, ww, vin, brand, model, version, mce_date,
//   date_debut_contrat, date_fin_contrat, gestionnaire   100%
//   location_type                                         99%
//   jockey                                                82%
//
// (Note the raw `cp` documents spell these num_chassis / modele /
// libelle_version_long / date_mce; /api/cp maps them to the CpItem names used
// here. Measuring the CpItem names directly against Mongo reports 0% and is
// wrong — a trap worth naming.)
//
// Three fields exist ONLY in `parc` and are absent from every single `cp`
// document (verified: 0 of 10,230 carry any of them):
//
//   vehicle_state, tenant
//
// Those are reported in `unavailable` rather than being faked, guessed, or
// silently rendered as empty — the card states which source it used and which
// fields that source cannot answer.
//
// `client` USED to be in that list. It no longer is: the CP export always
// carried it, the import just never extracted it (~/import commit 8ecafd5
// added `client` and `statut` to cp's COLUMNS_NEEDED). Every one of the 10,230
// cp documents now has a client, 0 blanks.
//
// ── Client precedence is deliberately INVERTED ───────────────────────────
//
// Everywhere else parc wins, because it is the fleet master record. For
// `client` the rule is the opposite: cp first, parc as fallback. cp is the
// live rental contract, so it names who is renting the vehicle NOW, whereas
// parc's client can lag behind a re-rental. Asked for explicitly by the fleet
// owner, and it is the only field with this inversion.

import type { CpItem, ParcItem } from "@/types";

/** Which collection(s) actually backed this identity. */
export type VehicleIdentitySource = "parc+cp" | "parc" | "cp";

/**
 * The fields only `parc` can fill, as key AND label from one definition —
 * the card renders by label, the exports resolve by ParcItem key, and a
 * divergence between the two would make one surface silently disagree with
 * the other about what is missing.
 */
export const PARC_ONLY_FIELDS = [
  { key: "vehicle_state", label: "Etat véhicule" },
  { key: "tenant", label: "Locataire" },
] as const;

export const PARC_ONLY_LABELS = PARC_ONLY_FIELDS.map((f) => f.label) as readonly string[];
export const PARC_ONLY_KEYS = PARC_ONLY_FIELDS.map((f) => f.key) as readonly string[];

export type VehicleIdentity = {
  source: VehicleIdentitySource;
  /** Human label for the card's provenance stamp. */
  sourceLabel: string;
  imm?: string;
  ww?: string;
  vin?: string;
  brand?: string;
  model?: string;
  mce_date?: string;
  location_type?: string;
  /** Renting client — cp first, parc fallback. See the note above. */
  client?: string;
  /**
   * Contract lifecycle from cp: "Livré" | "Arret facturation" | "Restitué".
   * Absent when there is no cp row. "Arret facturation" explains a vehicle
   * that is legitimately no longer in the parc — billing stopped — which is
   * otherwise indistinguishable from a data gap.
   */
  statut?: string;
  /** parc-only — undefined whenever source is "cp". */
  vehicle_state?: string;
  tenant?: string;
  /**
   * Card-field labels this source genuinely cannot answer. Empty unless the
   * identity came from cp alone. The card renders these as "non disponible"
   * rather than "—", so a missing SOURCE is distinguishable from a field that
   * is simply blank in an existing parc record.
   */
  unavailable: readonly string[];
  /**
   * The same fields as `unavailable`, keyed rather than labelled — the PDF and
   * DOCX exports resolve vehicle values by ParcItem key, so they need the key
   * form to render "non disponible" where the card does.
   */
  unavailableKeys: readonly string[];
};

const clean = (v?: string | null): string | undefined => {
  const t = v?.trim();
  return t ? t : undefined;
};

/**
 * Merges the two sources into one identity, or returns null when neither has
 * anything to say — the only case where the card should stay hidden.
 *
 * `parc` wins field by field where both carry a value, because it is the fleet
 * master record; `cp` fills the gaps. This preserves the previous behaviour
 * exactly for any plate that HAS a parc record: same fields, same precedence,
 * same "parc + cp" stamp.
 */
export function mergeVehicleIdentity(
  parc: ParcItem | null | undefined,
  contracts: readonly CpItem[] | null | undefined
): VehicleIdentity | null {
  const cp = contracts?.[0] ?? null;
  if (!parc && !cp) return null;

  if (parc) {
    return {
      source: cp ? "parc+cp" : "parc",
      sourceLabel: cp ? "parc + cp" : "parc",
      imm: clean(parc.imm) ?? clean(cp?.imm),
      ww: clean(parc.ww) ?? clean(cp?.ww),
      vin: clean(parc.vin) ?? clean(cp?.vin),
      brand: clean(parc.brand) ?? clean(cp?.marque),
      model: clean(parc.model) ?? clean(cp?.model),
      mce_date: clean(parc.mce_date) ?? clean(cp?.mce_date),
      location_type: clean(parc.location_type) ?? clean(cp?.type_location),
      // The one inversion: cp before parc.
      client: clean(cp?.client) ?? clean(parc.client),
      statut: clean(cp?.statut),
      vehicle_state: clean(parc.vehicle_state),
      tenant: clean(parc.tenant),
      unavailable: [],
      unavailableKeys: [],
    };
  }

  // cp only. The three parc-only fields are left undefined and named in
  // `unavailable` — never invented, never quietly blank.
  return {
    source: "cp",
    sourceLabel: "cp (aucune fiche parc)",
    imm: clean(cp!.imm),
    ww: clean(cp!.ww),
    vin: clean(cp!.vin),
    brand: clean(cp!.marque),
    model: clean(cp!.model),
    mce_date: clean(cp!.mce_date),
    location_type: clean(cp!.type_location),
    client: clean(cp!.client),
    statut: clean(cp!.statut),
    unavailable: PARC_ONLY_LABELS,
    unavailableKeys: PARC_ONLY_KEYS,
  };
}

/**
 * The degenerate identity for a plate neither collection knows: the plate
 * itself and nothing else. Exports still produce a document in that case (the
 * DS history is the point of the export, not the identity block), so they need
 * something to render rather than refusing.
 *
 * `unavailableKeys` is empty on purpose: nothing here is missing because a
 * SOURCE could not answer it — there is simply no record at all, which the
 * export renders as "—" for every field, the same as before this change.
 */
export function identityFromImmOnly(imm: string): VehicleIdentity {
  return { source: "parc", sourceLabel: "—", imm, unavailable: [], unavailableKeys: [] };
}
