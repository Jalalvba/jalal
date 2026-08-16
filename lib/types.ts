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
  designation_consommation?: string;
  qte?: number;
};

export type DsHistoryItem = {
  n_ds: string;
  date_ds?: string;
  immatriculation?: string;
  entite_nom?: string;
  description?: string;
  fournisseur?: string;
  techniciens?: string[];
  km?: number;
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
  immatriculation?: string;
  numero_ww?: string;
  marque?: string;
  modele?: string;
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
//
// Added Emplacement/ATELIER/DEPOT/PARKING (live header re-read, 2026-08).
// These are two independent signals, not one derived from the other:
// "Emplacement" is a MANUAL dropdown (EMPLACEMENT_OPTIONS below) — someone's
// human assessment of where the vehicle actually is — hence it's in
// BDD_EDITABLE_FIELDS. "ATELIER"/"DEPOT"/"PARKING" are read-only sheet-side
// XLOOKUP presence flags (value = the vehicle's own IMM if found as a live
// row in that zone's tab, else blank) — the sheet-side equivalent of what
// hooks/useVehicleZone.ts already computes client-side. The two can
// legitimately disagree (stale manual entry, or a failed automated match)
// — that disagreement is itself useful, not a bug to reconcile away.

export const BDD_HEADERS = [
  "IMM",
  "date",
  "client",
  "modele",
  "ETAT",
  "prestataire",
  "flag",
  "Emplacement",
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
  "ATELIER",
  "DEPOT",
  "PARKING",
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
  Emplacement: string;
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
  ATELIER: string;
  DEPOT: string;
  PARKING: string;
};

// Business-rule allowlist (not derived from the sheet — a deliberate policy:
// only these 7 of the 28 real columns in BDD_HEADERS above are writable from
// this app; Emplacement joined the list in 3d9bd87). Shared
// between the server-side check in lib/googleSheetsBdd.ts and the UI's edit
// form so both agree on the same set without duplicating the literal list.
export const BDD_EDITABLE_FIELDS = [
  "ETAT",
  "prestataire",
  "flag",
  "Emplacement",
  "Catégorie",
  "commentaire",
  "Technicien",
] as const;

// The three read-only, sheet-side XLOOKUP presence flags — kept as their own
// list so both app/suivi-rl/page.tsx and app/ds-history/page.tsx can render
// them as a clearly separate "automated zone detection" section rather than
// folding them into the generic readonly field list.
export const BDD_ZONE_DETECTION_HEADERS = ["ATELIER", "DEPOT", "PARKING"] as const;

// ─── Config-driven dropdown options (Stage 1) ─────────────────────────────
//
// EMPLACEMENT/ETAT/FLAG/CATEGORIE/TECHNICIEN/PRESTATAIRE/RDV_CONVOYEURS
// option *values* now live in the Mongo "sheetFieldOptions" collection
// (lib/sheetFieldOptions.ts), admin-editable at /admin/config — not
// hardcoded arrays baked into a deploy anymore. Headers/field structure
// (BDD_HEADERS, BddRow, BDD_EDITABLE_FIELDS above) are explicitly OUT of
// scope for this stage and stay exactly as they were.
//
// The six *_FALLBACK constants below are NOT dead code: lib/sheetFieldOptions.ts's
// getAllSheetFieldOptions() falls back to these if the Mongo collection is
// empty or unreachable, so a Mongo outage degrades to "options frozen at
// their last-known-good hardcoded value" rather than an app that can't
// render its own dropdowns. They also seed scripts/seed-sheet-field-options.ts's
// one-time migration — captured here exactly as they were live in the app
// before this migration, so the seed reflects real values, not new ones.

/** The only six colors any admin-editable option is allowed to carry — matches every color FLAG_STYLE/Prestataire's dot logic actually used before this migration. Picking a 7th requires a code change here, deliberately: this is the design system's palette, not sheet data. */
export const PALETTE_COLORS = ["red", "emerald", "zinc", "amber", "orange", "blue"] as const;
export type PaletteColor = (typeof PALETTE_COLORS)[number];

/** A dropdown option that also carries a color (Flag, Prestataire) — the general shape a "colored" sheetFieldOptions document's `options` array holds. `color: null` means "no color assigned" (most Prestataire values). */
export type ColoredOption = { value: string; color: PaletteColor | null };

// Literal Tailwind class strings, one entry per PaletteColor — kept fully
// spelled out (no `border-l-${color}-500` template interpolation) so
// Tailwind's build-time content scanner can find every class textually.
// This mapping (which Tailwind color a semantic palette name renders as) is
// a design-system concern, not sheet data — it does NOT move to Mongo.
export const FLAG_COLOR_CLASSES: Record<PaletteColor, { border: string; badge: string }> = {
  red: { border: "border-l-red-500", badge: "bg-red-500/10 text-red-400 border-red-500/20" },
  emerald: { border: "border-l-emerald-500", badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  zinc: { border: "border-l-zinc-500", badge: "bg-zinc-500/10 text-zinc-300 border-zinc-500/20" },
  amber: { border: "border-l-amber-500", badge: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  orange: { border: "border-l-orange-500", badge: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  blue: { border: "border-l-blue-500", badge: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
};

/** Same reasoning as FLAG_COLOR_CLASSES, for Prestataire's single-dot indicator. */
export const DOT_COLOR_CLASSES: Record<PaletteColor, string> = {
  red: "bg-red-500",
  emerald: "bg-emerald-500",
  zinc: "bg-zinc-400",
  amber: "bg-amber-400",
  orange: "bg-orange-500",
  blue: "bg-blue-500",
};

/** Looks up `value`'s color in the currently-loaded FLAG_OPTIONS list and resolves it to actual classes — replaces the old static `FLAG_STYLE[value]` lookup, now parameterized by whatever's currently loaded (Mongo-backed or fallback) instead of a hardcoded global. */
export function getFlagStyle(value: string, flagOptions: ColoredOption[]): { border: string; badge: string } | null {
  const opt = flagOptions.find((o) => o.value === value);
  if (!opt?.color) return null;
  return FLAG_COLOR_CLASSES[opt.color];
}

/** Same as getFlagStyle, for Prestataire's dot — replaces the old static prestataireDotClass(). */
export function getPrestataireDotClass(value: string, prestataireOptions: ColoredOption[]): string | null {
  const opt = prestataireOptions.find((o) => o.value === value);
  if (!opt?.color) return null;
  return DOT_COLOR_CLASSES[opt.color];
}

/** Every option-set's Mongo document key — also the traceable name of the *_FALLBACK constant it degrades to. */
export const OPTION_KEYS = [
  "EMPLACEMENT_OPTIONS",
  "ETAT_OPTIONS",
  "FLAG_OPTIONS",
  "CATEGORIE_OPTIONS",
  "TECHNICIEN_OPTIONS",
  "PRESTATAIRE_OPTIONS",
  "RDV_CONVOYEURS",
] as const;
export type OptionKey = (typeof OPTION_KEYS)[number];

/** Which OPTION_KEYS are {value,color} pairs vs plain strings — the admin UI and the Mongo document schema both branch on this. */
export const COLORED_OPTION_KEYS: readonly OptionKey[] = ["FLAG_OPTIONS", "PRESTATAIRE_OPTIONS"];

/** Human-readable label per OPTION_KEYS entry, for the /admin/config UI. Pure data (no env/Mongo dependency) so scripts/seed-sheet-field-options.ts can import it without pulling in lib/mongo.ts's module-scope env check. */
export const OPTION_LABELS: Record<OptionKey, string> = {
  EMPLACEMENT_OPTIONS: "Emplacement",
  ETAT_OPTIONS: "État",
  FLAG_OPTIONS: "Flag",
  CATEGORIE_OPTIONS: "Catégorie",
  TECHNICIEN_OPTIONS: "Technicien",
  PRESTATAIRE_OPTIONS: "Prestataire",
  RDV_CONVOYEURS: "RDV — Convoyeurs",
};

/** The shape /api/config/options returns, and what useSheetFieldOptions() exposes to every page that used to import a *_OPTIONS constant directly. */
export type AllSheetFieldOptions = {
  EMPLACEMENT_OPTIONS: string[];
  ETAT_OPTIONS: string[];
  FLAG_OPTIONS: ColoredOption[];
  CATEGORIE_OPTIONS: string[];
  TECHNICIEN_OPTIONS: string[];
  PRESTATAIRE_OPTIONS: ColoredOption[];
  RDV_CONVOYEURS: string[];
};

// Sheet-confirmed dropdown values for the manual "Emplacement" field — a
// human's assessment of the vehicle's real physical location, exact order
// as given by the sheet owner. Fallback only — see note above.
export const EMPLACEMENT_OPTIONS_FALLBACK = ["ATELIER", "PARKING", "INTROUVABLE", "DEPOT", "EXTERNE"];

// Named handle for the one EMPLACEMENT_OPTIONS_FALLBACK value that
// app/suivi-rl/page.tsx and app/ds-history/page.tsx treat specially (red
// "⚠ Introuvable" alert styling on the whole card/row). Referencing this
// constant instead of a raw "INTROUVABLE" literal at each comparison site
// doesn't remove the underlying fragility — Emplacement is admin-editable
// at /admin/config, and renaming or removing this exact value there still
// silently disables the alert styling with no error anywhere (Stage 1 of
// the config-driven proposal deliberately didn't wire behavior flags like
// this into the Mongo-backed option documents) — but it does mean there's
// exactly one place to look/update if that value's spelling ever changes.
export const EMPLACEMENT_INTROUVABLE = "INTROUVABLE";

// Fallback only — see note above. Merges the old FLAG_OPTIONS list and
// FLAG_STYLE color map into one {value,color}[] (they were always a matched
// pair — two separately-synced lists was the exact drift risk this
// migration closes for Flag/Prestataire, same as CATEGORIE/TECHNICIEN's
// plain-list drift closed earlier this session).
export const FLAG_OPTIONS_FALLBACK: ColoredOption[] = [
  { value: "Urgent", color: "red" },
  { value: "Prêt", color: "emerald" },
  { value: "NTR", color: "zinc" },
  { value: "INST", color: "amber" },
  { value: "REP", color: "orange" },
  { value: "ESSAI", color: "blue" },
];

// Fallback only — see note above. Dropdown option lists were exact, given
// verbatim, not invented; unchanged here, just renamed.
export const ETAT_OPTIONS_FALLBACK = ["INTERNE", "EXTERNE", "DISPONIBLE", "ANNULE", "ANNULEE"];

// Named handles for the three ETAT_OPTIONS_FALLBACK values that code actually
// compares against: app/suivi-rl/page.tsx's INTERNE/EXTERNE Flotte default
// scope, and etatBadgeClass() below (which ds-history aliases as etatStyle).
// Same caveat as EMPLACEMENT_INTROUVABLE above: ETAT is admin-editable at
// /admin/config, and these are still plain string comparisons, not derived
// from the live option list — renaming any of these three values there
// silently breaks the corresponding filter/color, with no error. Centralizing
// the literals here at least means a rename only needs updating in one place.
//
// ANNULE/ANNULEE deliberately have NO named constant. They are real
// ETAT_OPTIONS_FALLBACK values, but nothing compares against them — they
// render through etatBadgeClass()'s muted fallback (see below), which is
// intended. Handles existed for both until 2026-08 and were removed once
// confirmed to have zero references repo-wide: an unused constant is just
// another thing to keep in sync, for no reader.
export const ETAT_INTERNE = "INTERNE";
export const ETAT_EXTERNE = "EXTERNE";
export const ETAT_DISPONIBLE = "DISPONIBLE";

/**
 * ETAT's badge color mapping — a deliberate literal-color exception (see
 * CLAUDE.md §3's "ÉTAT badges" entry, same convention FLAG_STYLE/ZoneBadges
 * use), but previously duplicated and drifted independently in two places:
 * app/ds-history/page.tsx's etatStyle() covered ANNULEE but not ANNULE
 * (despite ETAT_OPTIONS_FALLBACK including both), and app/suivi-rl/page.tsx
 * had its own, simpler two-branch (EXTERNE vs everything-else) ternary that
 * didn't distinguish DISPONIBLE/ANNULE/ANNULEE at all. Centralized here so
 * the same ETAT value renders identically on both pages.
 *
 * ANNULE/ANNULEE have no branch of their own: they are real
 * ETAT_OPTIONS_FALLBACK values that deliberately fall through to the single
 * `return` at the bottom and render muted. That is the intended treatment,
 * not an oversight — lib/__tests__/etatBadgeClass.test.ts pins
 * etatBadgeClass("ANNULE") === etatBadgeClass("ANNULEE") so it stays true.
 *
 * That fallback uses the semantic muted/border tokens rather than a literal
 * zinc shade — the literal it replaced (bg-zinc-700 text-zinc-200) was also
 * a real light/dark bug, not just a token-naming nitpick: it rendered a
 * dark surface unconditionally, regardless of the app's light/dark theme.
 */
export function etatBadgeClass(etat: string): string {
  const key = etat?.toUpperCase();
  if (key === ETAT_DISPONIBLE) return "bg-green-700 text-white border-green-700";
  if (key === ETAT_INTERNE) return "bg-amber-400 text-amber-950 border-amber-500";
  if (key === ETAT_EXTERNE) return "bg-red-600 text-white border-red-700";
  return "bg-muted text-muted-foreground border-border";
}

export const CATEGORIE_OPTIONS_FALLBACK = [
  "Atelier chargé — en attente diagnostic",
  "En cours diagnostic par technicien",
  "En réparation atelier",
  "En réparation externe — décision validée",
  "En attente décision Mehdi",
  "En attente PDR",
  "En attente validation pièce",
  "En attente validation devis prestataire externe",
  "Chez concessionnaire — expertise externe",
  "Chez concessionnaire — garantie constructeur",
];

export const TECHNICIEN_OPTIONS_FALLBACK = [
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

// Fallback only — see note above. Merges the old PRESTATAIRE_OPTIONS list
// and its two color Sets into one {value,color}[]; entries not in either
// Set carry color: null (no dot), matching prestataireDotClass()'s old
// "neither set -> null" fallthrough exactly.
const PRESTATAIRE_YELLOW_FALLBACK = new Set([
  "amine diag", "pres injection", "simo BV", "EMAA", "nabil", "ELECTRO DIESEL",
  "FATR", "OPTIMUM", "HAMID CLIM", "nabil plaque", "My cherif Pneu", "FAP",
]);
const PRESTATAIRE_GREEN_FALLBACK = new Set([
  "M-AUTOMOTIV", "CAC", "BUGSHAN", "STELLANTIS", "SMEIA", "BAMOTORS", "JAMEEL", "VOVLO",
]);
export const PRESTATAIRE_OPTIONS_FALLBACK: ColoredOption[] = [
  "SCAL", "amine diag", "pres injection", "simo BV", "EMAA", "nabil",
  "ELECTRO DIESEL", "FATR", "OPTIMUM", "HAMID CLIM", "nabil plaque",
  "M-AUTOMOTIV", "CAC", "BUGSHAN", "STELLANTIS", "SMEIA", "BAMOTORS",
  "JAMEEL", "VOVLO", "My cherif Pneu", "FAP",
].map((value) => ({
  value,
  color: PRESTATAIRE_GREEN_FALLBACK.has(value) ? "emerald" : PRESTATAIRE_YELLOW_FALLBACK.has(value) ? "amber" : null,
}));

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
  date: string; // yyyy-mm-dd (isoDateToSerial's expected shape); written RAW as a precomputed serial, not USER_ENTERED
  heure: string;
  clients: string;
  vehicule: string;
  matricule: string;
  intervention: string;
  contact: string;
  convoyeur: string;
};

// The 17-name CONVOYEUR dropdown list, confirmed byte-for-byte against the
// live ONE_OF_LIST data validation rule on the monthly appointment-calendar
// tabs (source: CONFIG.CONVOYEURS in the generating Apps Script). Fallback
// only now — see the "Config-driven dropdown options" note above; the real
// source is lib/sheetFieldOptions.ts's Mongo-backed loader.
export const RDV_CONVOYEURS_FALLBACK = [
  "KHACHI Taha",
  "DRIOUICH Mohamad",
  "RAJI Ahmed",
  "DANAMI Hamza",
  "ZIAD Youssef",
  "MAOUID Ayoub",
  "AITMASAUD Khalid",
  "AOUCHAR Jalal",
  "ELBAZ Aziz",
  "HANANI Mehdi",
  "ZAMRANI Lahbib",
  "NADIF Adil",
  "ZARHLOUL Ilias",
  "ABAANI Oussama",
  "ELMAJDI Amine",
  "JIRARI Mohamed",
  "HAJBI Hakim",
] as const;

// Matches the monthly tabs' own CUSTOM_FORMULA data validation exactly:
// either 6 digits + 2 letters (980867WW) or 4-5 digits + 1 letter + 1 digit
// (79421-B-7).
export const RDV_MATRICULE_REGEX = /^([0-9]{6}[A-Za-z]{2}|[0-9]{4,5}-[A-Za-z]-[0-9])$/;

// Outcome of writing into the monthly appointment-calendar tab (the durable
// source — see lib/googleSheetsRdvMonthly.ts). `written: false` carries a
// human-readable reason (out-of-range date, tab not generated yet, etc.).
export type MonthlyWriteResult = { written: true; tab: string; row: number } | { written: false; error: string };

export type RdvAddResponse =
  | {
      ok: true;
      rowIndex?: number; // flat "RDV" tab row index — present only when flatTab.written is true
      monthlyTab: MonthlyWriteResult;
      flatTab: { written: boolean };
      warning?: string; // set when the monthly tab wrote OK but the flat-tab mirror didn't
    }
  | { ok: false; error: string };

// Same two-write shape as RdvAddResponse (monthly tab first — durable
// source, abort with a clean error if it can't be resolved — then the flat
// mirror, retried once, degrading to a warning rather than a hard failure).
export type RdvUpdateResult =
  | { ok: true; monthlyTab: MonthlyWriteResult; flatTab: { written: boolean }; warning?: string }
  | { ok: false; error: string };

export type RdvClearResult =
  | { ok: true; monthlyTab: MonthlyWriteResult; flatTab: { written: boolean }; warning?: string }
  | { ok: false; error: string };

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

// ─── Fleet Data Import (external pipeline, ~/import → import-red.vercel.app) ──
//
// This app never talks to Mongo/Drive for the import itself — it proxies
// two endpoints on a separate Vercel project (see app/api/trigger-import
// and app/api/import-status). Shapes below are normalized server-side from
// that project's own response shapes (run.py's run_all() for the trigger
// call, lib/pipeline_log.py's PipelineLogger.to_document() for the
// per-run status document) — confirmed by reading that project's source
// directly, not guessed from its HTTP docs.
//
// One important asymmetry: the trigger call's own response only carries a
// compact "step:status" string per step (no timestamp, no detail text) —
// full step detail only exists in the per-run status document. So
// app/api/trigger-import/route.ts calls /api/status for each run_id
// *after* the trigger call resolves (every run has already finished by
// then) to backfill real timestamps/detail before handing the combined
// result to the browser.

export type ImportPipelineStepStatus = "started" | "success" | "failed" | "skipped";

export type ImportPipelineStep = {
  step: string;
  status: ImportPipelineStepStatus;
  detail: string;
  /** ISO 8601 (normalized from the backend's Python `str(datetime)` form), or null if unavailable. */
  timestamp: string | null;
};

// Distinct from ImportPipelineStepStatus above — this is the top-level
// per-pipeline run status, not a step status. Confirmed against
// ~/import/run.py's run_all() (its own docstring + the literal "status":
// ... dict values) directly: never a bare "skipped" — "skipped_absent"
// (file not in the Drive folder at all) and "skipped_unchanged" (unchanged
// since the last successful run) are distinct outcomes callers should tell
// apart. "running" is added here only for /api/status's in-progress poll
// (PipelineLogger.status starts "running" until finish() is called), never
// a value the trigger route itself can return.
export type ImportPipelineRunStatus = "success" | "failed" | "skipped_absent" | "skipped_unchanged" | "running";

export type ImportPipelineResult = {
  label: string;
  filename: string;
  /** Module name — "ds" | "cp" | "parc" | "bc". */
  pipeline: string;
  run_id: string;
  status: ImportPipelineRunStatus;
  started_at: string | null;
  finished_at: string | null;
  steps: ImportPipelineStep[];
  /**
   * Set when /api/status couldn't be fetched for this run (e.g. it isn't
   * deployed on the backend yet — see app/api/trigger-import/route.ts's
   * comment) — `steps` above is then reconstructed from the trigger
   * response's compact "step:status" strings only, with no real detail/
   * timestamp. Surfaced in the UI rather than left implicit, so degraded
   * data never looks identical to the real thing.
   */
  stepDetailWarning?: string;
};

export type TriggerImportResponse =
  | { ok: true; success: boolean; results: ImportPipelineResult[] }
  | { ok: false; error: string };

export type ImportStatusResponse =
  | { ok: true; run: ImportPipelineResult }
  | { ok: false; error: string };

export type GenerateEmailRequest = {
  prompt: string;
  tone?: string;
  model?: string;
};

export type GenerateEmailResponse =
  | { ok: true; email: string }
  | { ok: false; error: string };

export type ReformulateCommentContext = {
  modele?: string;
  etat?: string;
  prestataire?: string;
  flag?: string;
  categorie?: string;
  technicien?: string;
};

export type ReformulateCommentRequest = {
  comment: string;
  context?: ReformulateCommentContext;
};

export type ReformulateCommentResponse =
  | { ok: true; reformulated: string }
  | { ok: false; error: string };
