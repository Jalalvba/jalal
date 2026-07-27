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

// Raw `parc` collection shape, projected down to the 4 fields the
// query/query-search suggest endpoints actually read.
export type ParcDoc = {
  Immatriculation?: string;
  "Numéro WW"?: string;
  Marque?: string;
  "Modèle"?: string;
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
// Confirmed by a live read of the real header row. This is NOT a guess: it's
// the actual row-1 content of the sheet as of the discovery pass.
// lib/googleSheetsBdd.ts still builds rows dynamically from a fresh live
// header read at runtime — this list exists for the UI layer (labels, field
// order, search) and the editable-fields allowlist below, not as a
// substitute for that live read.
//
// Re-confirmed live on a later pass: "Parking" no longer exists as header
// text anywhere in the sheet (column order drifted and it was dropped on
// the sheet side) — removed here to match. "Part" was re-confirmed as
// pluralized to "Parts". Added RDV/CONVOYEUR/Intervention: new
// formula-derived (XLOOKUP against the RDV tab) read-only columns.
//
// "date_ds" briefly disappeared too (its column had been mislabeled
// "Technicien" — a duplicate of the real editable column — causing
// getSheetRows() to silently return the wrong value on read; see the
// duplicate-header handling below). The sheet owner has since corrected
// that header cell back to "date_ds", its actual XLOOKUP-DATE_DS content
// all along, confirmed live (no duplicate header names remain anywhere in
// the row) — restored here as a read-only, date-formatted field.

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
  "ds",
  "date_ds",
  "Parts",
  "Technicein_ds",
  "Founisseur",
  "mois_restant",
  "date_fin_contrat",
  "lieu_Reparation",
  "Motif",
  "station_départ",
  "RDV",
  "CONVOYEUR",
  "Intervention",
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
  ds: string;
  date_ds: string;
  Parts: string;
  Technicein_ds: string;
  Founisseur: string;
  mois_restant: number;
  date_fin_contrat: string;
  lieu_Reparation: string;
  Motif: string;
  "station_départ": string;
  RDV: string;
  CONVOYEUR: string;
  Intervention: string;
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

// Shared with app/suivi-rl/page.tsx (and now app/ds-history/page.tsx) so
// every page renders the same flag exactly the same way — single source of
// truth, not copies to drift.
export const FLAG_STYLE: Record<string, { border: string; badge: string }> = {
  Urgent: { border: "border-l-red-500", badge: "bg-red-500/10 text-red-400 border-red-500/20" },
  "Prêt": { border: "border-l-emerald-500", badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  NTR: { border: "border-l-zinc-500", badge: "bg-zinc-500/10 text-zinc-300 border-zinc-500/20" },
  INST: { border: "border-l-amber-500", badge: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  REP: { border: "border-l-orange-500", badge: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  ESSAI: { border: "border-l-blue-500", badge: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
};

// Dropdown option lists — exact, given verbatim, not invented. Shared between
// app/suivi-rl/page.tsx and app/ds-history/page.tsx: both edit the same 6
// BDD_EDITABLE_FIELDS against the same sheet, so the picker choices must
// match exactly rather than being two independently-typed literal lists.
export const ETAT_OPTIONS = ["INTERNE", "EXTERNE", "DISPONIBLE", "ANNULE", "ANNULEE"];

export const FLAG_OPTIONS = ["Urgent", "Prêt", "NTR", "INST", "REP", "ESSAI"];

export const CATEGORIE_OPTIONS = [
  "Atelier chargé — en attente diagnostic",
  "En cours diagnostic par technicien",
  "En réparation atelier",
  'En réparation externe — décision validée"',
  "En attente décision Mehdi",
  "En attente PDR",
  "En attente validation pièce",
  "En attente validation devis prestataire externe",
  "Chez concessionnaire — expertise externe",
  "Chez concessionnaire — garantie constructeur",
];

export const TECHNICIEN_OPTIONS = [
  "ALI ELGHORABI",
  "Said Errakkachi",
  "AMDAOUI OTHMANE",
  "Othmane Madih",
  "MALEK HAMZA",
  "BELOUARDIGHI AZIZ",
  "RIDA BOULLAH",
  "HAJJI BADRY",
  "MINYAOUI SAID",
  "ABDERRAHIM ELKONTAFI",
  "RAMZI ADIL",
  "HOUCINE CHARII",
];

const PRESTATAIRE_YELLOW = new Set([
  "amine diag", "pres injection", "simo BV", "EMAA", "nabil", "ELECTRO DIESEL",
  "FATR", "OPTIMUM", "HAMID CLIM", "nabil plaque", "My cherif Pneu", "FAP",
]);
const PRESTATAIRE_GREEN = new Set([
  "M-AUTOMOTIV", "CAC", "BUGSHAN", "STELLANTIS", "SMEIA", "BAMOTORS", "JAMEEL", "VOVLO",
]);
export const PRESTATAIRE_OPTIONS = [
  "SCAL", "amine diag", "pres injection", "simo BV", "EMAA", "nabil",
  "ELECTRO DIESEL", "FATR", "OPTIMUM", "HAMID CLIM", "nabil plaque",
  "M-AUTOMOTIV", "CAC", "BUGSHAN", "STELLANTIS", "SMEIA", "BAMOTORS",
  "JAMEEL", "VOVLO", "My cherif Pneu", "FAP",
];

export function prestataireDotClass(val: string): string | null {
  if (PRESTATAIRE_GREEN.has(val)) return "bg-emerald-500";
  if (PRESTATAIRE_YELLOW.has(val)) return "bg-amber-400";
  return null;
}

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

// ─── RDV sheet (Google Sheets, tab "RDV", gid=2066154497) ─────────────────────
//
// Confirmed by a live spreadsheets.values.get() read of the real header row
// (full width A1:H1, nothing beyond H): Date, Heure, Clients, Véhicule,
// Matricule, Intervention, Contact, CONVOYEUR. Unlike PARKING/ATELIER, this
// tab has no formula/XLOOKUP columns at all — every field is manually typed
// (a call/appointment log), confirmed all 8 are editable. "Matricule" is the
// plate field — same "NNNNN-L-N" format confirmed live against BDD's IMM
// column, so it plugs into the same usePlateAutocomplete/ZoneBadges
// infrastructure as IMM elsewhere. Also confirmed live: BDD's RDV/CONVOYEUR/
// Intervention columns are XLOOKUP formulas reading Matricule (RDV!E:E)
// against this tab's Date/CONVOYEUR/Intervention columns — this tab is
// already wired in as a lookup source the same way ds/parc/RL_reunion feed
// Atelier/Parking.
//
// Unlike PARKING/ATELIER, rows here are NOT keyed/deduped by plate — the
// same Matricule legitimately appears across many appointment rows over
// time, and there's no TIMESTAMP column to bump on a "duplicate". Adding a
// row always appends a brand-new entry.

export const RDV_HEADERS = [
  "Date",
  "Heure",
  "Clients",
  "Véhicule",
  "Matricule",
  "Intervention",
  "Contact",
  "CONVOYEUR",
] as const;

export type RdvRow = {
  rowIndex: number;
  date: string; // dd/mm/yyyy, formatted from the sheet's date serial
  rawDate: number; // for sorting
  heure: string;
  clients: string;
  vehicule: string;
  matricule: string;
  intervention: string;
  contact: string;
  convoyeur: string;
};

// All 8 real columns are editable — this tab has no formula/read-only
// columns, confirmed live (see comment above).
export const RDV_EDITABLE_FIELDS = [
  "Date",
  "Heure",
  "Clients",
  "Véhicule",
  "Matricule",
  "Intervention",
  "Contact",
  "CONVOYEUR",
] as const;

export type RdvEditableField = (typeof RDV_EDITABLE_FIELDS)[number];

export type RdvAddInput = {
  date: string; // dd/mm/yyyy, written USER_ENTERED so Sheets parses it as a real date
  heure: string;
  clients: string;
  vehicule: string;
  matricule: string;
  intervention: string;
  contact: string;
  convoyeur: string;
};

export type RdvAddResponse = { ok: true; rowIndex: number } | { ok: false; error: string };

export type RdvUpdateResult = { ok: true } | { ok: false; error: string };

// ─── DEPOT sheet (Google Sheets, tab "DEPOT", gid=1365327220) ─────────────────
//
// Confirmed live to be a byte-for-byte structural clone of PARKING: same 15
// columns (IMM, TIMESTAMP, ACTION, MARQUE, MODEL, CLIENT, RL_REUNION, MOTIF,
// ETAT VÉHICULE, BDD, DATE_DS, DS, PARTS, TECHNICEIN, FOUNISSEUR — TECHNICEIN/
// FOUNISSEUR sic, matching Parking's real header cells), same 12 XLOOKUP
// formulas verbatim (checked via a FORMULA-render read, not inferred from
// resemblance alone). Only ACTION is editable — IMM/TIMESTAMP are the
// add-mechanism fields, the rest is read-only XLOOKUP output, exactly like
// Parking. Reuses ParkingAddResponse/ParkingAddResultItem (lib/googleSheetsAtelier.ts
// already sets this precedent) since the add-result shape is identical.

export type DepotRow = {
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
