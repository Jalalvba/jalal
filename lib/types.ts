// Canonical response shapes for the app's own APIs.
//
// Each type here is derived directly from the corresponding route's actual
// $project stage (see app/api/ds/history, app/api/parc, app/api/cp), not from
// what a consumer *wishes* the API returned. Keeping this as the single
// source of truth is what prevents API and consumer types from drifting
// apart silently (see git history around 2026-07 for what that drift cost).

export type Line = {
  cmd_num?: string;
  code_art?: string;
  designation_conso?: string;
  qte?: number;
  mt_ht?: number | null;
  price_source?: "bc" | "ds";
};

export type DsHistoryItem = {
  "N°DS": string;
  "Date DS"?: string;
  Immatriculation?: string;
  ENTITE?: string;
  Description?: string;
  Fournisseur?: string;
  Techniciens?: string[];
  KM?: number;
  lines?: Line[];
};

export type DsApiResponse = {
  ok: boolean;
  imm: string;
  count: number;
  items: DsHistoryItem[];
  error?: string;
};

export type ParcItem = {
  imm?: string;
  ww?: string;
  vin?: string;
  brand?: string;
  model?: string;
  vehicle_state?: string;
  location_type?: string;
  tenant?: string;
  mce_date?: string;
  client?: string;
};

export type ParcApiResponse = {
  ok: boolean;
  query: string;
  count: number;
  items: ParcItem[];
  item: ParcItem | null;
  error?: string;
};

export type CpItem = {
  gestionnaire?: string;
  ww?: string;
  imm?: string;
  vin?: string;
  marque?: string;
  model?: string;
  version?: string;
  type_location?: string;
  mce_date?: string;
  date_debut_contrat?: string;
  date_fin_contrat?: string;
  type?: string; // e.g. "Remplacement"
  jockey?: string;
};

export type CpApiResponse = {
  ok: boolean;
  count: number;
  items: CpItem[];
  item: CpItem | null;
  error?: string;
};

// ─── BDD sheet (Google Sheets, tab "BDD", gid=868042157) ──────────────────────
//
// Confirmed by a live read of the real header row (all 22 columns, no
// truncation — see conversation history). This is NOT a guess: it's the
// actual row-1 content of the sheet as of the discovery pass. lib/googleSheetsBdd.ts
// still builds rows dynamically from a fresh live header read at runtime —
// this list exists for the UI layer (labels, field order, search) and the
// editable-fields allowlist below, not as a substitute for that live read.

export const BDD_HEADERS = [
  "IMM",
  "date",
  "client",
  "modele",
  "ETAT",
  "prestataire",
  "flag",
  "commentaire",
  "Catégorie",
  "Technicien",
  "Reunion N-1",
  "Parking",
  "date_ds",
  "ds",
  "Part",
  "Technicein_ds",
  "Founisseur",
  "mois_restant",
  "date_fin_contrat",
  "lieu_Reparation",
  "Motif",
  "station_départ",
] as const;

export type BddRow = {
  _row: number;
  IMM: string;
  date: string;
  client: string;
  modele: string;
  ETAT: string;
  prestataire: string;
  flag: string;
  commentaire: string;
  "Catégorie": string;
  Technicien: string;
  "Reunion N-1": string;
  Parking: string;
  date_ds: string;
  ds: string;
  Part: string;
  Technicein_ds: string;
  Founisseur: string;
  mois_restant: number;
  date_fin_contrat: string;
  lieu_Reparation: string;
  Motif: string;
  "station_départ": string;
};

// Business-rule allowlist (not derived from the sheet — a deliberate policy:
// only these 6 of the 22 real columns are writable from this app). Shared
// between the server-side check in lib/googleSheetsBdd.ts and the UI's edit
// form so both agree on the same set without duplicating the literal list.
export const BDD_EDITABLE_FIELDS = [
  "ETAT",
  "prestataire",
  "flag",
  "Catégorie",
  "commentaire",
  "Technicien",
] as const;

export type BddEditableField = (typeof BDD_EDITABLE_FIELDS)[number];

export type BddUpdateResult =
  | { ok: true; written: string[] }
  | { ok: false; error: string; rejectedFields: string[] };
