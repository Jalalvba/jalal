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

export type BddUpdateResult =
  | { ok: true; written: string[] }
  | { ok: false; error: string; rejectedFields: string[] };

// ─── PARKING sheet (Google Sheets, tab "PARKING") ─────────────────────────────
//
// Column layout confirmed by a live spreadsheets.values.get() read of the real
// header row (gid=1215781154): IMM, ACTION, MARQUE, MODEL, CLIENT, RL_REUNION,
// MOTIF, ETAT VÉHICULE, BDD, DATE_DS, DS, PARTS, TECHNICEIN, FOUNISSEUR,
// TIMESTAMP. Only IMM, ACTION, TIMESTAMP are ever written by this app — the
// rest are sheet-side XLOOKUP formulas, read-only display fields here (ported
// from the AVIS Maroc GAS "Parking" system's code.gs + Parking.gs). TECHNICEIN
// and FOUNISSEUR are spelled exactly as the real header cells (sic) — not
// typos introduced here.

export type ParkingRow = {
  rowIndex: number;
  imm: string;
  timestamp: string;
  rawDate: number;
  action: string;
  marque: string;
  model: string;
  client: string;
  rlReunion: string;
  motif: string;
  etatVehicule: string;
  bdd: string;
  dateDs: string;
  ds: string;
  parts: string;
  technicein: string;
  founisseur: string;
};

export type ParkingAddStatus = "added" | "updated";

export type ParkingAddResultItem = {
  imm: string;
  status: ParkingAddStatus;
  inParc: boolean;
};

export type ParkingAddResponse =
  | { ok: true; results: ParkingAddResultItem[] }
  | { ok: false; error: string };

// ─── ATELIER sheet (Google Sheets, tab "ATELIER", same spreadsheet) ───────────
//
// Ported from the AVIS Maroc GAS "Atelier" system (code.gs + RebuildAtelier.gs).
// Live header row confirmed by a spreadsheets.values.get() read — its column
// *order* drifts from the reference source's CFG_PARKING_SHEET.COLUMNS
// declaration (columns 9-14 are reshuffled), which is exactly why every read/
// write here goes through a live column-name map rather than fixed indices.
// No ACTION field exists on this tab (unlike PARKING) — the editable surface
// is BESOIN PIÈCE, COMMENTAIRE, CATÉGORIE, TECHNICIEN instead. Also has the
// same 9 read-only XLOOKUP columns as PARKING (DS, BDD, RL_REUNION, MOTIF,
// ETAT VÉHICULE, DATE_DS, PARTS, FOUNISSEUR), plus TECHNICEIN_DS — a distinct
// column from the editable TECHNICIEN field above (the DS record's technician,
// not the assigned atelier technician).

export type AtelierRow = {
  rowIndex: number;
  imm: string;
  timestamp: string;
  rawDate: number;
  marque: string;
  model: string;
  client: string;
  commentaire: string;
  categorie: string;
  technicien: string;
  besoinPiece: string;
  rlReunion: string;
  motif: string;
  etatVehicule: string;
  bdd: string;
  dateDs: string;
  ds: string;
  parts: string;
  techniceinDs: string;
  founisseur: string;
};

// Deliberate allowlist (the original GAS updateCellFromWeb() accepts any
// column name, including the read-only XLOOKUP columns — an unrestricted
// endpoint isn't something worth reproducing). Matches BDD_EDITABLE_FIELDS'
// precedent of a named, checked allowlist rather than free-form column access.
export const ATELIER_EDITABLE_FIELDS = ["COMMENTAIRE", "CATÉGORIE", "TECHNICIEN", "BESOIN PIÈCE"] as const;

export type AtelierEditableField = (typeof ATELIER_EDITABLE_FIELDS)[number];
