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
