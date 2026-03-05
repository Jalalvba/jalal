// app/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// ─── Cookie helpers ──────────────────────────────────────────────────────────

const COOKIE_CARD  = "ds_visible_card";
const COOKIE_LINE  = "ds_visible_line";
const COOKIE_DAYS  = 365;

function cookieSet(name: string, value: string) {
  const expires = new Date();
  expires.setDate(expires.getDate() + COOKIE_DAYS);
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
}

function cookieGet(name: string): string | null {
  const match = document.cookie
    .split("; ")
    .find(row => row.startsWith(name + "="));
  return match ? decodeURIComponent(match.split("=")[1]) : null;
}

function loadCardFields(): Set<keyof DsHistoryItem> {
  try {
    const raw = cookieGet(COOKIE_CARD);
    if (!raw) return DEFAULT_CARD_VISIBLE;
    const parsed = JSON.parse(raw) as string[];
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_CARD_VISIBLE;
    return new Set(parsed as (keyof DsHistoryItem)[]);
  } catch { return DEFAULT_CARD_VISIBLE; }
}

function loadLineFields(): Set<keyof Line> {
  try {
    const raw = cookieGet(COOKIE_LINE);
    if (!raw) return DEFAULT_LINE_VISIBLE;
    const parsed = JSON.parse(raw) as string[];
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_LINE_VISIBLE;
    return new Set(parsed as (keyof Line)[]);
  } catch { return DEFAULT_LINE_VISIBLE; }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Line = {
  n_intervention?: string;

  cmd_num?: string; // ✅ moved here

  code_art?: string;
  designation_art?: string;
  designation_conso?: string;

  qte?: number;

  prix_unitaire?: number | null;

  mt_ht?: number | null;

  dernier_prix?: number | null;
};

type DsHistoryItem = {
  "N°DS": string;

  Societe?: string;
  Site?: string;
  "SITE DS"?: string;

  "Date DS"?: string;
  "Date entrée"?: string;
  "Date interv"?: string;
  "Effectué le"?: string;

  Immatriculation?: string;
  Parc?: string;
  "Type Parc"?: string;

  "Désignation véhicule"?: string;
  Marque?: string;

  ENTITE?: string;
  "Code entité"?: string;
  Entité?: string;

  Description?: string;
  "Type DS"?: string;
  "Type de DS"?: string;

  Techniciens?: string[];

  User?: string | null;
  "Facturé par"?: string | null;

  "Client Final"?: string;
  "Raison Social"?: string;
  "Client DS"?: string;

  "Code Client"?: string;
  "Détenteur DS"?: string;
  "Détenteur parc"?: string;

  "Locat Parc"?: string;
  "A Facturé"?: string;
  "Statut facture"?: string;

  "N° Facture"?: string;
  Affectation?: string;
  "Ref CP"?: string;

  Réceptionné?: string;
  Soldé?: string;

  "Demande satisfaite"?: string;
  Fournisseur?: string;

  KM?: number;
  "MT Total HT"?: number;

  lines?: Line[];
};

type DsApiResponse = {
  ok: boolean;
  imm: string;
  count: number;
  items: DsHistoryItem[];
  error?: string;
};

type ParcItem = {
  imm?: string;
  ww?: string;
  vin?: string;
  brand?: string;
  model?: string | number;
  vehicle_state?: string;
  vehicle_type?: string;
  location_type?: string;
  tenant?: string;
  received?: string;
  received_date?: string;
  mce_date?: string;
  sold?: string;
  scrap?: string;
  purchase_order?: string;
  purchase_price_net?: number;
  company?: string;
  client?: string;
};

type ParcApiResponse = {
  ok: boolean;
  query: string;
  count: number;
  items: ParcItem[];
  item: ParcItem | null;
  error?: string;
};

type CpItem = {
  reference?: string;
  nature?: string;
  statut?: string;
  ww?: string;
  imm?: string;
  vin?: string;
  marque?: string;
  model?: string;
  version?: string;
  type_vehicle?: string;
  type_location?: string;
  client?: string;
  gestionnaire?: string;
  duree?: string;
  km_prevu?: number;
  bon_commande?: string;
  mce_date?: string;
  date_debut_contrat?: string;
  date_fin_contrat?: string;
  date_debut_facturation?: string;
  etat_livraison?: string;
  date_livraison?: string;
  etat_restitution?: string;
  etat_prorogation?: string;
  avenant?: string;
  vh_relais?: string;
  type?: string;
  date_debut_rl?: string;
  km_depart?: number;
  dernier_km?: number;
  date_dernier_km?: string;
  total_relais?: number;
  km_consomme?: number;
  ecart_km?: number;
  projection_km?: number;
  ecart_pct?: number;
  conducteur?: string;
  intersociete?: string;
  type_vehicle?: string;
};

type CpApiResponse = {
  ok: boolean;
  count: number;
  items: CpItem[];
  item: CpItem | null;
  error?: string;
};

// ─── Field definitions ────────────────────────────────────────────────────────

type MetaField = { key: keyof ParcItem; label: string };
type CardField = { key: keyof DsHistoryItem; label: string; group: string };
type LineField  = { key: keyof Line; label: string };

const VEHICLE_META_FIELDS: MetaField[] = [
  { key: "imm",                label: "Immatriculation" },
  { key: "ww",                 label: "Numéro WW" },
  { key: "vin",                label: "VIN" },
  { key: "brand",              label: "Marque" },
  { key: "model",              label: "Modèle" },
  { key: "company",            label: "Société" },
  { key: "client",             label: "Client" },
  { key: "vehicle_type",       label: "Type véhicule" },
  { key: "vehicle_state",      label: "Etat véhicule" },
  { key: "location_type",      label: "Type location" },
  { key: "tenant",             label: "Locataire" },
  { key: "received",           label: "Reçu" },
  { key: "received_date",      label: "Date réception" },
  { key: "mce_date",           label: "Date MCE" },
  { key: "sold",               label: "Vendu" },
  { key: "scrap",              label: "Epave" },
  { key: "purchase_order",     label: "Bon de commande" },
  { key: "purchase_price_net", label: "Prix achat net" },
];

const CARD_FIELDS: CardField[] = [
  { key: "N°DS", label: "N°DS", group: "Identification" },

  { key: "Site", label: "Site", group: "Identification" },
  { key: "SITE DS", label: "SITE DS", group: "Identification" },

  { key: "Date DS", label: "Date DS", group: "Dates" },
  { key: "Date entrée", label: "Date entrée", group: "Dates" },
  { key: "Date interv", label: "Date interv", group: "Dates" },
  { key: "Effectué le", label: "Effectué le", group: "Dates" },

  { key: "ENTITE", label: "ENTITE", group: "Localisation" },
  { key: "Code entité", label: "Code entité", group: "Localisation" },
  { key: "Entité", label: "Entité", group: "Localisation" },

  { key: "Description", label: "Description", group: "DS Info" },
  { key: "Type DS", label: "Type DS", group: "DS Info" },
  { key: "Type de DS", label: "Type de DS", group: "DS Info" },

  { key: "KM", label: "KM", group: "DS Info" },
  { key: "MT Total HT", label: "MT Total HT", group: "DS Info" },

  { key: "Affectation", label: "Affectation", group: "DS Info" },

  { key: "Techniciens", label: "Techniciens", group: "Intervenants" },
  { key: "User", label: "User", group: "Intervenants" },
  { key: "Facturé par", label: "Facturé par", group: "Intervenants" },

  { key: "Fournisseur", label: "Fournisseur", group: "Intervenants" },

  { key: "Client Final", label: "Client Final", group: "Facturation" },
  { key: "Raison Social", label: "Raison Social", group: "Facturation" },
  { key: "Client DS", label: "Client DS", group: "Facturation" },

  { key: "Code Client", label: "Code Client", group: "Facturation" },
  { key: "Détenteur DS", label: "Détenteur DS", group: "Facturation" },

  { key: "A Facturé", label: "A Facturé", group: "Facturation" },
  { key: "Statut facture", label: "Statut facture", group: "Facturation" },

  { key: "N° Facture", label: "N° Facture", group: "Facturation" },

  { key: "Ref CP", label: "Ref CP", group: "Facturation" },

  { key: "Réceptionné", label: "Réceptionné", group: "Facturation" },
  { key: "Soldé", label: "Soldé", group: "Facturation" },

  { key: "Demande satisfaite", label: "Demande satisfaite", group: "Facturation" },
];

const LINE_FIELDS: LineField[] = [
  { key: "n_intervention", label: "N° Interv." },

  { key: "cmd_num", label: "CMD Num" },

  { key: "code_art", label: "Code art" },
  { key: "designation_art", label: "Désignation article" },
  { key: "designation_conso", label: "Désig. conso." },

  { key: "qte", label: "Qté" },

  { key: "prix_unitaire", label: "Prix unit." },

  { key: "mt_ht", label: "Mt HT" },

  { key: "dernier_prix", label: "Dernier prix" },
];

const DEFAULT_CARD_VISIBLE = new Set<keyof DsHistoryItem>([
  "N°DS","Site","Date DS","ENTITE","KM","Description","Type DS","MT Total HT","Techniciens","Affectation",
]);
const DEFAULT_LINE_VISIBLE = new Set<keyof Line>(["code_art","designation_art","qte","mt_ht"]);
const CARD_GROUPS = ["Identification","Dates","Localisation","DS Info","Intervenants","Facturation"];
const TOP_BAR_KEYS = new Set(["Site","Date DS","Type DS","Affectation","MT Total HT","KM"]);
// Always shown in card body regardless of user field preferences
const MANDATORY_CARD_KEYS = new Set<keyof DsHistoryItem>(["Description","Techniciens","ENTITE"]);
const NUM_LINE_KEYS = new Set(["qte","mt_ht","prix_unitaire","dernier_prix"]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : d.toISOString().slice(0, 10);
}

function fmtNum(v?: number | null, dec = 0): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v);
}

function displayValue(item: DsHistoryItem, key: keyof DsHistoryItem): string {
  const v = item[key];
  if (v == null) return "—";
  if (key === "Techniciens") return (v as string[]).join(", ") || "—";
  if (key === "KM") return fmtNum(v as number) + " km";
  if (key === "MT Total HT") return fmtNum(v as number, 2) + " MAD";
  if (["Date DS","Date entrée","Date interv","Effectué le"].includes(key as string)) return fmtDate(v as string);
  return String(v).trim() || "—";
}

function displayLineValue(line: Line, key: keyof Line): string {
  const v = line[key];
  if (v == null) return "—";
  if (["mt_ht","prix_unitaire","dernier_prix"].includes(key)) return fmtNum(v as number, 2);
  if (key === "qte") return String(v);
  return String(v).trim() || "—";
}

function displayVehicleValue(vehicle: ParcItem, key: keyof ParcItem): string {
  const v = vehicle[key];
  if (v == null) return "—";
  if (key === "purchase_price_net") return fmtNum(v as number, 2) + " MAD";
  return String(v).trim() || "—";
}

// ─── PDF export (server-side via /api/export?format=pdf) ─────────────────────

async function downloadPdf(
  data: DsApiResponse,
  vehicle: ParcItem,
  contracts: CpItem[],
  visibleCardFields: Set<keyof DsHistoryItem>,
  visibleLineFields: Set<keyof Line>,
  setExporting: (v: boolean) => void
) {
  setExporting(true);
  try {
    const parcFieldsForExport = VEHICLE_META_FIELDS.filter(f =>
      ([...PARC_MANDATORY, ...PARC_EXTRA] as string[]).includes(f.key as string)
    );
    const cardFieldLabels = Object.fromEntries(CARD_FIELDS.map(f => [f.key, f.label]));
    const lineFieldLabels = Object.fromEntries(LINE_FIELDS.map(f => [f.key, f.label]));

    const res = await fetch("/api/export?format=pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imm: (vehicle.imm ?? data.imm ?? "").toString(),
        count: data.count,
        items: data.items,
        contracts,
        visibleCardFields: [...visibleCardFields],
        visibleLineFields: [...visibleLineFields],
        vehicleMetaFields: parcFieldsForExport,
        cardFieldLabels,
        lineFieldLabels,
        topBarKeys: [...TOP_BAR_KEYS],
        parcMandatoryKeys: PARC_MANDATORY,
        parcExtraKeys: PARC_EXTRA,
        vehicle,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `historique_ds_${((vehicle.imm ?? data.imm ?? "ds") as string).replace(/[^a-zA-Z0-9-]/g,"_")}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(`Erreur PDF: ${e instanceof Error ? e.message : e}`);
  } finally {
    setExporting(false);
  }
}

// ─── DOCX export ──────────────────────────────────────────────────────────────

async function downloadDocx(
  data: DsApiResponse,
  vehicle: ParcItem,
  contracts: CpItem[],
  visibleCardFields: Set<keyof DsHistoryItem>,
  visibleLineFields: Set<keyof Line>,
  setExporting: (v: boolean) => void
) {
  setExporting(true);
  try {
    const cardFieldLabels = Object.fromEntries(CARD_FIELDS.map(f => [f.key, f.label]));
    const lineFieldLabels = Object.fromEntries(LINE_FIELDS.map(f => [f.key, f.label]));

    const parcFieldsForExport = VEHICLE_META_FIELDS.filter(f =>
      [...PARC_MANDATORY, ...PARC_EXTRA].includes(f.key as keyof ParcItem)
    );

    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imm: (vehicle.imm ?? data.imm ?? "").toString(),
        count: data.count,
        items: data.items,
        contracts,
        visibleCardFields: [...visibleCardFields],
        visibleLineFields: [...visibleLineFields],
        vehicleMetaFields: parcFieldsForExport,
        cardFieldLabels,
        lineFieldLabels,
        topBarKeys: [...TOP_BAR_KEYS],
        parcMandatoryKeys: PARC_MANDATORY,
        parcExtraKeys: PARC_EXTRA,
        vehicle,
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `historique_ds_${((vehicle.imm ?? data.imm ?? "ds") as string).replace(/[^a-zA-Z0-9-]/g,"_")}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(`Erreur DOCX: ${e instanceof Error ? e.message : e}`);
  } finally {
    setExporting(false);
  }
}

// ─── CP Contracts Bar ────────────────────────────────────────────────────────

// ─── CP Contract Row (with expand/collapse) ──────────────────────────────────

function CpContractRow({ cp }: { cp: CpItem }) {
  const [open, setOpen] = useState(false);
  const statutStyle = ({
    "Validé":   "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800/40",
    "Annulé":   "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800/40",
    "Livré":    "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800/40",
    "En cours": "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800/40",
  } as Record<string,string>)[cp.statut ?? ""] ?? "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700";

  const f = (label: string, value?: string | number | null, bold = false) => (
    <div>
      <div className="text-xs text-zinc-400 dark:text-zinc-500">{label}</div>
      <div className={`mt-0.5 truncate text-sm dark:text-zinc-100 ${bold ? "font-bold text-zinc-800" : "font-semibold text-zinc-700 dark:text-zinc-200"}`}>
        {value != null && String(value).trim() !== "" ? String(value) : "—"}
      </div>
    </div>
  );
  const km = (v?: number | null) => v != null ? new Intl.NumberFormat("fr-FR").format(v) + " km" : null;

  return (
    <div>
      {/* ── MANDATORY: always visible ── */}
      <div className="px-5 py-4 space-y-4">

        {/* Row 1: Marque/Modèle · Client · Version · Fin contrat */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
          {f("Marque / Modèle", cp.marque && cp.model ? `${cp.marque} ${cp.model}` : (cp.marque ?? cp.model))}
          {f("Client", cp.client, true)}
          <div>
            <div className="text-xs text-zinc-400 dark:text-zinc-500">Version</div>
            <div className="mt-0.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 leading-tight line-clamp-2">{cp.version ?? "—"}</div>
          </div>
          {f("Fin contrat", cp.date_fin_contrat)}
        </div>

        {/* Row 2: VH relais · Type relais · Début RL */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
          {f("VH relais", cp.vh_relais)}
          {f("Type relais", cp.type)}
          {f("Début RL", cp.date_debut_rl)}
        </div>

      </div>

      {/* ── EXTRA: visible only when expanded ── */}
      {open && (
        <div className="border-t border-zinc-100 px-5 py-4 space-y-4 dark:border-zinc-800">

          {/* Row 3: Référence · Nature · Durée · WW · IMM · Gestionnaire */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
            <div>
              <div className="text-xs text-zinc-400 dark:text-zinc-500">Référence</div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="text-sm font-bold text-zinc-800 dark:text-zinc-100">{cp.reference ?? "—"}</span>
                {cp.statut && <span className={`rounded-md border px-1.5 py-0.5 text-xs font-medium ${statutStyle}`}>{cp.statut}</span>}
              </div>
            </div>
            {f("Nature", cp.nature)}
            {f("Durée", cp.duree)}
            {f("WW", cp.ww)}
            {f("IMM", cp.imm)}
          </div>

          {/* Row 4: Type location · Type véhicule · Début contrat · Début facturation · KM prévu */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
            {f("Type location", cp.type_location)}
            {f("Type véhicule", cp.type_vehicle)}
            {f("Début contrat", cp.date_debut_contrat)}
            {f("Début facturation", cp.date_debut_facturation)}
            {f("KM prévu", km(cp.km_prevu))}
          </div>

          {/* Row 4b: Date MCE · Conducteur */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
            {f("Date MCE", cp.mce_date)}
            {f("Conducteur", cp.conducteur?.trim() || "—")}
          </div>

          {/* Row 5: KM tracking */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
            {f("KM départ", km(cp.km_depart))}
            {f("Dernier KM", km(cp.dernier_km))}
            {f("Date dernier KM", cp.date_dernier_km)}
            {f("KM consommé", km(cp.km_consomme))}
            {f("Projection KM", km(cp.projection_km))}
            {f("Ecart%", cp.ecart_pct != null ? cp.ecart_pct + "%" : null)}
          </div>

          {/* Row 6: Relais details */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
            {f("Total relais KM", km(cp.total_relais))}
            {f("Ecart KM", km(cp.ecart_km))}
          </div>

          {/* Row 7: Etat badges */}
          <div className="flex flex-wrap gap-2">
            {([
              ["Livraison",    cp.etat_livraison,  cp.date_livraison],
              ["Restitution",  cp.etat_restitution, null],
              ["Prorogation",  cp.etat_prorogation, null],
              ["Avenant",      cp.avenant,          null],
              ["Intersociété", cp.intersociete,     null],
            ] as [string, string|undefined, string|undefined][]).map(([label, val, date]) => (
              <span key={label} className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                <span className="text-zinc-400">{label}:</span>
                <span className={`font-medium ${val === "Oui" ? "text-green-600 dark:text-green-400" : ""}`}>{val ?? "—"}</span>
                {date && <span className="text-zinc-400 ml-1">{date}</span>}
              </span>
            ))}
          </div>

        </div>
      )}

      {/* Toggle button */}
      <button onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-center gap-1.5 border-t border-zinc-100 py-2 text-xs font-medium text-zinc-400 transition hover:bg-zinc-50 hover:text-zinc-600 dark:border-zinc-800 dark:hover:bg-zinc-900 dark:hover:text-zinc-300">
        {open
          ? <><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 10l4-4 4 4" strokeLinecap="round"/></svg> Voir moins</>
          : <><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6l4 4 4-4" strokeLinecap="round"/></svg> Voir plus</>}
      </button>
    </div>
  );
}

const STATUT_STYLE: Record<string, string> = {
  "Validé":   "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800/40",
  "Annulé":   "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800/40",
  "En cours": "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800/40",
};

function CpContractsBar({ items }: { items: CpItem[] }) {
  if (!items.length) return null;
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
        <svg className="h-4 w-4 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <line x1="10" y1="9" x2="8" y2="9"/>
        </svg>
        <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
          Contrats CP ({items.length})
        </span>
        <span className="ml-auto text-xs italic text-zinc-400 dark:text-zinc-600">Source collection cp</span>
      </div>

      {/* One card per contract */}
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {items.map((cp, i) => <CpContractRow key={i} cp={cp} />)}
      </div>
    </div>
  );
}

// ─── Vehicle Meta Bar ─────────────────────────────────────────────────────────

const PARC_MANDATORY: (keyof ParcItem)[] = ["imm","ww","vin","brand","model","vehicle_state","mce_date"];
const PARC_EXTRA:     (keyof ParcItem)[] = ["company","client","vehicle_type","location_type","tenant","received","received_date","sold","scrap","purchase_order","purchase_price_net"];

function VehicleMetaBar({ item }: { item: ParcItem }) {
  const [open, setOpen] = useState(false);
  const pf = (key: keyof ParcItem) => {
    const f = VEHICLE_META_FIELDS.find(x => x.key === key);
    return f ? { key, label: f.label } : { key, label: String(key) };
  };
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
        <svg className="h-4 w-4 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="1" y="8" width="22" height="10" rx="2"/>
          <path d="M5 8V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2"/>
          <circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>
        </svg>
        <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Véhicule (parc)</span>
        <span className="ml-auto text-xs italic text-zinc-400 dark:text-zinc-600">Données fixes — source parc</span>
      </div>
      {/* Mandatory fields — always visible */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-4">
        {PARC_MANDATORY.map(key => {
          const f = pf(key);
          return (
            <div key={String(key)}>
              <div className="text-xs text-zinc-400 dark:text-zinc-500">{f.label}</div>
              <div className="mt-0.5 truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">{displayVehicleValue(item, key)}</div>
            </div>
          );
        })}
      </div>
      {/* Extra fields — shown when expanded */}
      {open && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-zinc-100 px-5 py-4 sm:grid-cols-4 dark:border-zinc-800">
          {PARC_EXTRA.map(key => {
            const f = pf(key);
            return (
              <div key={String(key)}>
                <div className="text-xs text-zinc-400 dark:text-zinc-500">{f.label}</div>
                <div className="mt-0.5 truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">{displayVehicleValue(item, key)}</div>
              </div>
            );
          })}
        </div>
      )}
      <button onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-center gap-1.5 border-t border-zinc-100 py-2 text-xs font-medium text-zinc-400 transition hover:bg-zinc-50 hover:text-zinc-600 dark:border-zinc-800 dark:hover:bg-zinc-900 dark:hover:text-zinc-300">
        {open
          ? <><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 10l4-4 4 4" strokeLinecap="round"/></svg> Voir moins</>
          : <><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6l4 4 4-4" strokeLinecap="round"/></svg> Voir plus · {PARC_EXTRA.length} champs</>}
      </button>
    </div>
  );
}

// ─── Lines Table ──────────────────────────────────────────────────────────────

function LinesTable({ lines, orderedLineFields, totalMtHt, visibleLineFields }: {
  lines: Line[]; orderedLineFields: LineField[];
  totalMtHt?: number | null; visibleLineFields: Set<keyof Line>;
}) {
  if (!lines.length || !orderedLineFields.length) return null;
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-zinc-50 text-left text-xs font-semibold text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            {orderedLineFields.map(f => (
              <th key={f.key} className={`px-3 py-2 whitespace-nowrap ${NUM_LINE_KEYS.has(f.key) ? "text-right" : ""}`}>{f.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {lines.map((l, idx) => (
            <tr key={idx} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
              {orderedLineFields.map(f => (
                <td key={f.key} className={`px-3 py-2 ${
                  NUM_LINE_KEYS.has(f.key) ? "text-right tabular-nums font-medium"
                  : f.key==="code_art" ? "font-mono text-xs font-medium text-zinc-700 dark:text-zinc-300"
                  : "text-zinc-600 dark:text-zinc-400"
                }`}>{displayLineValue(l, f.key)}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {lines.length > 1 && visibleLineFields.has("mt_ht") && totalMtHt != null && (
          <tfoot>
            <tr className="border-t-2 border-zinc-200 bg-zinc-50 font-semibold dark:border-zinc-700 dark:bg-zinc-900">
              {orderedLineFields.map((f, i) => (
                <td key={f.key} className={`px-3 py-2 text-xs ${NUM_LINE_KEYS.has(f.key) ? "text-right tabular-nums" : ""}`}>
                  {f.key === "mt_ht" ? fmtNum(totalMtHt, 2) : i === 0 ? "Total" : ""}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

// ─── Field Selector ───────────────────────────────────────────────────────────

function FieldSelector({
  visibleCardFields, setVisibleCardFields,
  visibleLineFields, setVisibleLineFields,
  open, onClose,
}: {
  visibleCardFields: Set<keyof DsHistoryItem>; setVisibleCardFields: (s: Set<keyof DsHistoryItem>) => void;
  visibleLineFields: Set<keyof Line>;           setVisibleLineFields: (s: Set<keyof Line>) => void;
  open: boolean; onClose: () => void;
}) {
  if (!open) return null;

  function saveCard(s: Set<keyof DsHistoryItem>) {
    cookieSet(COOKIE_CARD, JSON.stringify([...s]));
    setVisibleCardFields(s);
  }
  function saveLine(s: Set<keyof Line>) {
    cookieSet(COOKIE_LINE, JSON.stringify([...s]));
    setVisibleLineFields(s);
  }

  const toggleCard = (key: keyof DsHistoryItem) => {
    const n = new Set(visibleCardFields); n.has(key) ? n.delete(key) : n.add(key); saveCard(n);
  };
  const toggleLine = (key: keyof Line) => {
    const n = new Set(visibleLineFields); n.has(key) ? n.delete(key) : n.add(key); saveLine(n);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end" onClick={onClose}>
      <div className="mr-4 mt-16 w-80 max-h-[80vh] overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-950"
           onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-zinc-100 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
          <span className="text-sm font-semibold">Champs visibles</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { saveCard(DEFAULT_CARD_VISIBLE); saveLine(DEFAULT_LINE_VISIBLE); }}
              className="rounded-lg px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              title="Réinitialiser aux champs par défaut">
              ↺ Reset
            </button>
            <button onClick={onClose} className="rounded-lg px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">✕ Fermer</button>
          </div>
        </div>
        <div className="mx-3 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-400">
          🚗 Les champs <b>Véhicule</b> viennent de <b>/api/parc</b> (collection parc), pas des DS.
        </div>
        <div className="space-y-5 p-4">
          {CARD_GROUPS.map(group => {
            const fields = CARD_FIELDS.filter(f => f.group === group);
            return (
              <div key={group}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">{group}</span>
                  <div className="flex gap-2">
                    <button onClick={() => { const n = new Set(visibleCardFields); fields.forEach(f => n.add(f.key)); saveCard(n); }} className="text-xs text-blue-500 hover:underline">Tout</button>
                    <button onClick={() => { const n = new Set(visibleCardFields); fields.forEach(f => { if (f.key !== "N°DS") n.delete(f.key); }); saveCard(n); }} className="text-xs text-zinc-400 hover:underline">Aucun</button>
                  </div>
                </div>
                <div className="space-y-1">
                  {fields.map(f => (
                    <label key={f.key} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                      <input type="checkbox" checked={visibleCardFields.has(f.key)} onChange={() => toggleCard(f.key)} disabled={f.key==="N°DS"} className="h-3.5 w-3.5 accent-zinc-800" />
                      <span className="text-sm text-zinc-700 dark:text-zinc-300">{f.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">Colonnes lignes</span>
              <div className="flex gap-2">
                <button onClick={() => saveLine(new Set(LINE_FIELDS.map(f => f.key)))} className="text-xs text-blue-500 hover:underline">Tout</button>
                <button onClick={() => saveLine(new Set(["code_art"] as (keyof Line)[]))} className="text-xs text-zinc-400 hover:underline">Aucun</button>
              </div>
            </div>
            <div className="space-y-1">
              {LINE_FIELDS.map(f => (
                <label key={f.key} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                  <input type="checkbox" checked={visibleLineFields.has(f.key)} onChange={() => toggleLine(f.key)} className="h-3.5 w-3.5 accent-zinc-800" />
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">{f.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Download icon ────────────────────────────────────────────────────────────

function DlIcon({ spinning }: { spinning?: boolean }) {
  return spinning
    ? <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="animate-spin"><circle cx="8" cy="8" r="6" strokeDasharray="28" strokeDashoffset="10"/></svg>
    : <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 12h10M8 2v8M5 7l3 3 3-3" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Home() {
  const [imm, setImm] = useState("48070-B-7");
  const [year, setYear] = useState<string>("");
  const [limit, setLimit] = useState(200);

  // Smart search suggestions
  type SearchResult = { imm: string; ww: string; label: string; primary?: string; secondary?: string };
  const [suggestions, setSuggestions]         = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchLoading, setSearchLoading]     = useState(false);
  const searchRef  = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node))
        setShowSuggestions(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function handleImmChange(val: string) {
    setImm(val);
    setShowSuggestions(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.trim().length < 2) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await fetch(`/api/query/search?q=${encodeURIComponent(val.trim())}`);
        const json = await res.json();
        setSuggestions(json.results ?? []);
        setShowSuggestions((json.results ?? []).length > 0);
      } catch { setSuggestions([]); }
      finally { setSearchLoading(false); }
    }, 300);
  }

  function selectSuggestion(s: SearchResult) {
    setImm(s.imm);
    setSuggestions([]);
    setShowSuggestions(false);
    fetchAll(s.imm);
  }

  function handleImmKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    setShowSuggestions(false);
    if (suggestions.length === 1) { selectSuggestion(suggestions[0]); return; }
    if (suggestions.length === 0) { fetchAll(); return; }
    // multiple suggestions — show them (already visible)
  }

  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string>("");

  const [data, setData]         = useState<DsApiResponse | null>(null);
  const [vehicle, setVehicle]   = useState<ParcItem | null>(null);
  const [contracts, setContracts] = useState<CpItem[]>([]);

  const [selectorOpen, setSelectorOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const toggleExpand = (nds: string) => setExpandedCards(prev => {
    const n = new Set(prev); n.has(nds) ? n.delete(nds) : n.add(nds); return n;
  });
  const [exportingDocx, setExportingDocx] = useState(false);
  const [exportingPdf,  setExportingPdf]  = useState(false);

  const [visibleCardFields, setVisibleCardFields] = useState<Set<keyof DsHistoryItem>>(() => new Set(DEFAULT_CARD_VISIBLE));
  const [visibleLineFields, setVisibleLineFields] = useState<Set<keyof Line>>(() => new Set(DEFAULT_LINE_VISIBLE));

  // Load cookie preferences after mount (avoids SSR/client hydration mismatch)
  useEffect(() => {
    setVisibleCardFields(loadCardFields());
    setVisibleLineFields(loadLineFields());
  }, []);

  const years = useMemo(() => {
    const now = new Date().getUTCFullYear();
    return Array.from({ length: 8 }, (_, i) => String(now - i));
  }, []);

  async function fetchAll(nextImm?: string) {
    const rawVal = (nextImm ?? imm).trim();
    if (!rawVal) return;

    setLoading(true);
    setError("");
    setSuggestions([]);
    setShowSuggestions(false);

    try {
      // If partial input, resolve to exact IMM first
      let immVal = rawVal;
      if (rawVal.length < 10) {
        const resolveRes  = await fetch(`/api/query?q=${encodeURIComponent(rawVal)}`);
        const resolveJson = await resolveRes.json();
        if (resolveJson.ok && resolveJson.mode === "suggest") {
          setSuggestions(resolveJson.suggestions ?? []);
          setShowSuggestions(true);
          setData(null); setVehicle(null); setContracts([]);
          return;
        }
        if (resolveJson.ok && resolveJson.mode === "data") {
          immVal = resolveJson.imm ?? rawVal;
          setImm(immVal);
        }
      }

      const dsQs   = new URLSearchParams({ imm: immVal, limit: String(limit) });
      if (year) dsQs.set("year", year);
      const parcQs = new URLSearchParams({ imm: immVal });
      const cpQs   = new URLSearchParams({ imm: immVal, ww: immVal });

      const [dsRes, parcRes, cpRes] = await Promise.all([
        fetch(`/api/ds/history?${dsQs}`),
        fetch(`/api/parc?${parcQs}`),
        fetch(`/api/cp?${cpQs}`),
      ]);

      const dsJson   = await dsRes.json()   as DsApiResponse;
      const parcJson = await parcRes.json() as ParcApiResponse;
      const cpJson   = await cpRes.json()   as CpApiResponse;

      if (!dsRes.ok || !dsJson.ok) {
        setData(null);
        setError(dsJson?.error || `Erreur DS (${dsRes.status})`);
      } else {
        setData(dsJson);
      }

      if (parcRes.ok && parcJson.ok) setVehicle(parcJson.item ?? null);
      else setVehicle(null);

      if (cpRes.ok && cpJson.ok) setContracts(cpJson.items ?? []);
      else setContracts([]);

    } catch (e) {
      setData(null); setVehicle(null); setContracts([]);
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchAll("48070-B-7"); }, []); // eslint-disable-line

  const orderedCardFields = CARD_FIELDS.filter(
    f => visibleCardFields.has(f.key) && f.key !== "N°DS" && !TOP_BAR_KEYS.has(f.key as string)
  );
  const orderedLineFields = LINE_FIELDS.filter(f => visibleLineFields.has(f.key));

  function handlePdf() {
    if (!data) return;
    const v = vehicle ?? ({ imm: data.imm } as ParcItem);
    downloadPdf(data, v, contracts, visibleCardFields, visibleLineFields, setExportingPdf);
  }

  function handleDocx() {
    if (!data) return;
    const v = vehicle ?? ({ imm: data.imm } as ParcItem);
    downloadDocx(data, v, contracts, visibleCardFields, visibleLineFields, setExportingDocx);
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-black dark:text-zinc-50">
      <FieldSelector
        visibleCardFields={visibleCardFields} setVisibleCardFields={setVisibleCardFields}
        visibleLineFields={visibleLineFields}  setVisibleLineFields={setVisibleLineFields}
        open={selectorOpen} onClose={() => setSelectorOpen(false)}
      />

      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">

        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">DS History</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Recherche par immatriculation / WW / VIN</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
              {data ? `${data.count} DS` : "—"}
            </span>
            <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs dark:border-zinc-800 dark:bg-zinc-950">
              {loading ? "⏳ Chargement…" : "✓ Prêt"}
            </span>

            {/* Champs */}
            <button onClick={() => setSelectorOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 4h12M4 8h8M6 12h4" strokeLinecap="round"/></svg>
              Champs ({mounted ? visibleCardFields.size : "..."})
            </button>

            {/* PDF */}
            <button onClick={handlePdf} disabled={!data || exportingPdf}
              className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-800/40 dark:bg-red-950/30 dark:text-red-400">
              <DlIcon spinning={exportingPdf} /> {exportingPdf ? "Génération…" : "PDF"}
            </button>

            {/* Word DOCX */}
            <button onClick={handleDocx} disabled={!data || exportingDocx}
              className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-blue-800/40 dark:bg-blue-950/30 dark:text-blue-400">
              <DlIcon spinning={exportingDocx} />
              {exportingDocx ? "Génération…" : "Word (.docx)"}
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="grid gap-3 sm:grid-cols-12 sm:items-end">
            <div className="sm:col-span-5" ref={searchRef}>
              <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Immatriculation / WW / VIN</label>
              <div className="relative">
                <input
                  value={imm}
                  onChange={e => handleImmChange(e.target.value)}
                  onKeyDown={handleImmKeyDown}
                  onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                  placeholder="ex: 48070 / 832223WW / VIN"
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 pr-8 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:focus:border-zinc-600"
                />
                {searchLoading && (
                  <div className="absolute right-3 top-3.5">
                    <svg className="h-4 w-4 animate-spin text-zinc-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                  </div>
                )}
                {showSuggestions && suggestions.length > 0 && (
                  <ul className="absolute z-50 mt-1 w-full rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                    {suggestions.map(s => (
                      <li key={s.imm}
                        onMouseDown={() => selectSuggestion(s)}
                        className="cursor-pointer px-4 py-2.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800">
                        <span className="font-semibold text-zinc-800 dark:text-zinc-100">{s.primary ?? s.imm}</span>
                        {s.label && (
                          <span className="ml-2 text-xs text-zinc-400">{s.label}</span>
                        )}
                        {s.secondary && (
                          <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-500">{s.secondary}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="sm:col-span-3">
              <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Année (optionnel)</label>
              <select value={year} onChange={e => setYear(e.target.value)}
                className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:focus:border-zinc-600">
                <option value="">Toutes les années</option>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Limite</label>
              <input type="number" value={limit} onChange={e => setLimit(Number(e.target.value))} min={1} max={2000}
                className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:focus:border-zinc-600" />
            </div>
            <div className="sm:col-span-2">
              <button onClick={() => fetchAll()} disabled={loading || !imm.trim()}
                className="h-11 w-full rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white">
                Rechercher
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">{error}</div>
          )}
        </div>

        {/* Vehicle metadata (from parc) */}
        {vehicle && !loading && <div className="mt-4"><VehicleMetaBar item={vehicle} /></div>}

        {/* CP Contracts */}
        {contracts.length > 0 && !loading && <div className="mt-3"><CpContractsBar items={contracts} /></div>}

        {/* Results */}
        <div className="mt-4 space-y-3">
          {!data && !loading && (
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
              Entrez une immatriculation et cliquez sur Rechercher.
            </div>
          )}

          {loading && (
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="h-5 w-48 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="mt-4 space-y-3">
                {[0,1,2,3].map(i => <div key={i} className="h-24 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />)}
              </div>
            </div>
          )}

          {data && !loading && data.items.map(it => {
            const nds = it["N°DS"];
            const isExpanded = expandedCards.has(nds);

            // All card fields always visible (no collapse for DS cards)
            const allCardFields = orderedCardFields;

            return (
            <div key={nds} className="rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">

              {/* Top bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
                {/* LEFT: date · KM */}
                <div className="flex flex-wrap items-center gap-2">
                  {visibleCardFields.has("Date DS") && (
                    <span className="text-sm font-bold tabular-nums text-zinc-800 dark:text-zinc-100">{fmtDate(it["Date DS"])}</span>
                  )}
                  {visibleCardFields.has("KM") && it.KM != null && (
                    <><span className="text-zinc-400">•</span>
                    <span className="text-sm font-bold tabular-nums text-zinc-800 dark:text-zinc-100">{fmtNum(it.KM)} km</span></>
                  )}
                </div>
                {/* RIGHT: MAD · Site · N°DS · Type DS · Affectation */}
                <div className="flex flex-wrap items-center gap-2">
                  {visibleCardFields.has("MT Total HT") && it["MT Total HT"] != null && (
                    <span className="text-sm font-semibold tabular-nums">{fmtNum(it["MT Total HT"], 2)} MAD</span>
                  )}
                  {visibleCardFields.has("Site") && (
                    <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">{it.Site ?? "—"}</span>
                  )}
                  <span className="text-sm font-bold tracking-tight">{nds}</span>
                  {visibleCardFields.has("Type DS") && it["Type DS"] && (
                    <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium dark:bg-zinc-800 dark:text-zinc-300">{it["Type DS"]}</span>
                  )}
                  {visibleCardFields.has("Affectation") && it.Affectation && (
                    <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">{it.Affectation}</span>
                  )}
                </div>
              </div>

              {/* All card fields — always visible */}
              {allCardFields.length > 0 && (
                <div className="grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-3">
                  {allCardFields.map(f => (
                    <div key={f.key} className={f.key === "Description" ? "sm:col-span-3" : ""}>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">{f.label}</div>
                      <div className={`text-sm font-medium text-zinc-800 dark:text-zinc-200 ${f.key === "Description" ? "whitespace-pre-wrap" : "truncate"}`}>
                        {displayValue(it, f.key)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Lines — always visible */}
              {it.lines?.length && orderedLineFields.length > 0 ? (
                <div className="border-t border-zinc-100 px-5 pb-4 pt-3 dark:border-zinc-800">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
                    Lignes ({it.lines.length})
                  </div>
                  <LinesTable
                    lines={it.lines}
                    orderedLineFields={orderedLineFields}
                    totalMtHt={it["MT Total HT"]}
                    visibleLineFields={visibleLineFields}
                  />
                </div>
              ) : null}

            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}