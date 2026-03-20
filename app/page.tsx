// app/page.tsx
"use client";
import Link from "next/link";

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
  cmd_num?: string;
  code_art?: string;
  designation_conso?: string;
  qte?: number;
  mt_ht?: number | null;
  price_source?: "bc" | "ds";
};

type DsHistoryItem = {
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
  model?: string;
  vehicle_state?: string;
  location_type?: string;
  tenant?: string;
  mce_date?: string;
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
  type?: string;
  jockey?: string;
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
  { key: "imm",          label: "Immatriculation" },
  { key: "ww",           label: "Numéro WW" },
  { key: "vin",          label: "VIN" },
  { key: "brand",        label: "Marque" },
  { key: "model",        label: "Modèle" },
  { key: "client",       label: "Client" },
  { key: "vehicle_state",label: "Etat véhicule" },
  { key: "location_type",label: "Type location" },
  { key: "tenant",       label: "Locataire" },
  { key: "mce_date",     label: "Date MCE" },
];

// Used by PDF/DOCX export
const PARC_MANDATORY: (keyof ParcItem)[] = ["imm","ww","vin","brand","model","vehicle_state","mce_date"];
const PARC_EXTRA:     (keyof ParcItem)[] = ["client","location_type","tenant"];

const CARD_FIELDS: CardField[] = [
  { key: "N°DS",         label: "N°DS",         group: "Identification" },
  { key: "Date DS",      label: "Date DS",       group: "Identification" },
  { key: "ENTITE",       label: "Entité",        group: "Localisation" },
  { key: "Description",  label: "Description",   group: "DS Info" },
  { key: "KM",           label: "KM",            group: "DS Info" },
  { key: "Techniciens",  label: "Techniciens",   group: "Intervenants" },
  { key: "Fournisseur",  label: "Fournisseur",   group: "Intervenants" },
];

const LINE_FIELDS: LineField[] = [
  { key: "cmd_num",           label: "CMD Num" },
  { key: "code_art",          label: "Code art" },
  { key: "designation_conso", label: "Désig. conso." },
  { key: "qte",               label: "Qté" },
  { key: "mt_ht",             label: "Mt HT" },
];

const DEFAULT_CARD_VISIBLE = new Set<keyof DsHistoryItem>([
  "N°DS","Date DS","ENTITE","KM","Description","Techniciens","Fournisseur",
]);
const DEFAULT_LINE_VISIBLE = new Set<keyof Line>(["cmd_num","designation_conso","qte","mt_ht"]);
const CARD_GROUPS = ["Identification","Localisation","DS Info","Intervenants"];
const TOP_BAR_KEYS = new Set(["Date DS","KM"]);
const MANDATORY_CARD_KEYS = new Set<keyof DsHistoryItem>(["Description","Techniciens","ENTITE"]);
const NUM_LINE_KEYS = new Set(["qte","mt_ht"]);

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

  if (key === "Date DS") return fmtDate(v as string);
  return String(v).trim() || "—";
}

function displayLineValue(line: Line, key: keyof Line): string {
  const v = line[key];
  if (v == null) return "—";
  if (key === "mt_ht") return fmtNum(v as number, 2);
  if (key === "qte") return String(v);
  return String(v).trim() || "—";
}

function displayVehicleValue(vehicle: ParcItem, key: keyof ParcItem): string {
  const v = vehicle[key];
  if (v == null) return "—";
  if (key === "mce_date") return fmtDate(v as string);
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

// ─── Vehicle Card (parc + cp merged) ─────────────────────────────────────────

function VehicleCard({ parc, contracts, hasRl }: { parc: ParcItem; contracts: CpItem[]; hasRl?: boolean }) {
  const [open, setOpen] = useState(false);
  const cp = contracts[0] ?? null;
  const isRemplacement = contracts.some(c => c.type?.trim().toLowerCase() === "remplacement");
  const isRed = hasRl || isRemplacement;

  const f = (label: string, val?: string | null) => (
    <div>
      <div className="text-xs text-zinc-400 dark:text-zinc-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate">
        {val?.trim() || "—"}
      </div>
    </div>
  );

  return (
    <div className={`rounded-2xl border shadow-sm ${isRed ? "border-red-400 bg-red-50 dark:border-red-700 dark:bg-red-950/20" : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"}`}>
      {/* Header */}
      <div className={`flex items-center gap-2 border-b px-5 py-3 ${isRed ? "border-red-200 dark:border-red-800/50" : "border-zinc-100 dark:border-zinc-800"}`}>
        <svg className={`h-4 w-4 ${isRed ? "text-red-500" : "text-zinc-400"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="1" y="8" width="22" height="10" rx="2"/>
          <path d="M5 8V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2"/>
          <circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>
        </svg>
        <span className={`text-xs font-semibold uppercase tracking-widest ${isRed ? "text-red-600 dark:text-red-400" : "text-zinc-400 dark:text-zinc-500"}`}>
          {isRed && "⚠ "}Véhicule
        </span>
        <span className="ml-auto text-xs italic text-zinc-400 dark:text-zinc-600">parc + cp</span>
      </div>

      {/* ── Priority row: always visible ── */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-3 lg:grid-cols-6">
        {f("Client",        parc.client)}
        {f("IMM",           parc.imm)}
        {f("WW",            parc.ww)}
        {f("Etat véhicule", parc.vehicle_state)}
        {f("Date MCE",      fmtDate(parc.mce_date ?? cp?.mce_date))}
        {f("Fin contrat",   fmtDate(cp?.date_fin_contrat))}
      </div>

      {/* ── Version full width ── */}
      {cp?.version && (
        <div className="border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <div className="text-xs text-zinc-400 dark:text-zinc-500">Version</div>
          <div className="mt-0.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 leading-snug">{cp.version}</div>
        </div>
      )}

      {/* ── Extra: expand/collapse ── */}
      {open && (
        <div className="border-t border-zinc-100 px-5 py-4 space-y-4 dark:border-zinc-800">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
            {f("Marque",         parc.brand)}
            {f("Modèle",         parc.model)}
            {f("VIN",            parc.vin)}
            {f("Type location",  parc.location_type ?? cp?.type_location)}
            {f("Locataire",      parc.tenant)}
            {f("Gestionnaire",   cp?.gestionnaire)}
            {f("Début contrat",  fmtDate(cp?.date_debut_contrat))}
            {f("Type relais",    cp?.type)}
            {f("Jockey",        cp?.jockey)}
          </div>
          {contracts.length > 1 && (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-400">Autres contrats ({contracts.length - 1})</div>
              <div className="space-y-2">
                {contracts.slice(1).map((c, i) => (
                  <div key={i} className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-xl border border-zinc-100 px-4 py-3 sm:grid-cols-4 dark:border-zinc-800">
                    {f("IMM", c.imm)} {f("Fin contrat", fmtDate(c.date_fin_contrat))} {f("Type relais", c.type)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <button onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-center gap-1.5 border-t border-zinc-100 py-2 text-xs font-medium text-zinc-400 transition hover:bg-zinc-50 hover:text-zinc-600 dark:border-zinc-800 dark:hover:bg-zinc-900 dark:hover:text-zinc-300">
        {open
          ? <><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 10l4-4 4 4" strokeLinecap="round"/></svg> Voir moins</>
          : <><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6l4 4 4-4" strokeLinecap="round"/></svg> Voir plus</>}
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
                }`}>
                  {f.key === "cmd_num" ? (
                    <span className="flex items-center gap-1.5">
                      {l.price_source === "bc"
                        ? <span className="rounded px-1 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">BC</span>
                        : <span className="rounded px-1 py-0.5 text-[10px] font-bold bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">DS</span>
                      }
                      {displayLineValue(l, f.key)}
                    </span>
                  ) : displayLineValue(l, f.key)}
                </td>
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


// ─── Sheet Card (BDD + RL merged) ────────────────────────────────────────────

type BddRow = { IMM: string; date: string; client: string; modele: string; ETAT: string; prestataire: string; commentaire: string; "Reunion N-1": string; mois_restant: string; date_fin_contrat: string; lieu_Reparation: string; Motif: string; "station_départ": string; ds: string; date_ds: string; };

type RlRow = {
  Reference: string;
  Date: string;
  Client: string;
  Immatriculation_a_remplacer: string;
  "Modèle_a_remplacer": string;
  Immatriculation_remplacement: string;
  "Modèle_remplacement": string;
  "Date début": string;
  Motif: string;
  "Téléphone": string;
};

function SheetCard({ bddRows, rlRows, importRows }: { bddRows: BddRow[]; rlRows: RlRow[]; importRows: ImportRow[] }) {
  if (!bddRows.length && !rlRows.length && !importRows.length) return null;

  const etatStyle = (etat: string) => ({
    "DISPONIBLE": "bg-[#1a7a4a] text-white border-[#1a7a4a]",
    "INTERNE":    "bg-[#f4c430] text-[#5a3e00] border-[#e6b800]",
    "EXTERNE":    "bg-red-600 text-white border-red-700",
    "ANNULEE":    "bg-zinc-700 text-zinc-200 border-zinc-600",
  } as Record<string,string>)[etat?.toUpperCase()] ?? "bg-zinc-700 text-zinc-200 border-zinc-600";

  const GREEN_PRESTATAIRES = new Set(["M-AUTOMOTIV","CAC","BUGSHAN","STELLANTIS","SMEIA","BAMOTORS","JAMEEL"]);

  const f = (label: string, val?: string) => val ? (
    <div>
      <div className="text-xs text-zinc-400 dark:text-zinc-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate flex items-center gap-1.5">
        {label === "Prestataire" && (
          <span className={`inline-block h-2.5 w-2.5 rounded-full flex-shrink-0 ${GREEN_PRESTATAIRES.has(val.toUpperCase()) ? "bg-[#1a7a4a]" : "bg-[#f4c430]"}`} />
        )}
        {val}
      </div>
    </div>
  ) : null;

  const hasRl = rlRows.length > 0;

  return (
    <div className={`rounded-2xl border shadow-sm ${hasRl ? "border-red-400 bg-red-50 dark:border-red-700 dark:bg-red-950/20" : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"}`}>
      {/* Header */}
      <div className={`flex items-center gap-2 border-b px-5 py-3 ${hasRl ? "border-red-200 dark:border-red-800/50" : "border-zinc-100 dark:border-zinc-800"}`}>
        <svg className={`h-4 w-4 ${hasRl ? "text-red-500" : "text-zinc-400"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
        <span className={`text-xs font-semibold uppercase tracking-widest ${hasRl ? "text-red-600 dark:text-red-400" : "text-zinc-400 dark:text-zinc-500"}`}>
          {hasRl && "⚠ "}Immobilisation BDD {bddRows.length > 0 && `(${bddRows.length})`}
        </span>
        <span className="ml-auto text-xs italic text-zinc-400 dark:text-zinc-600">Source Google Sheets</span>
      </div>

      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {/* BDD rows */}
        {bddRows.map((row, i) => (
          <div key={i} className="px-5 py-4">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {row.ETAT && (
                <span className={`rounded-md border px-1.5 py-0.5 text-xs font-medium ${etatStyle(row.ETAT)}`}>
                  {row.ETAT}
                </span>
              )}
              {row.date && <span className="text-xs text-zinc-400">{row.date}</span>}
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              {f("Prestataire", row.prestataire)}
              {f("Réunion N-1", row["Reunion N-1"])}
              {f("Commentaire", row.commentaire)}
            </div>
          </div>
        ))}

        {/* RL rows */}
        {rlRows.map((row, i) => (
          <div key={`rl-${i}`} className="px-5 py-4">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-xs font-bold text-red-600 dark:text-red-400 uppercase tracking-wide">Véhicule de remplacement</span>
              <span className="text-xs font-mono text-zinc-500">{row.Reference}</span>
              {row.Date && <span className="text-xs text-zinc-400">{row.Date}</span>}
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              {f("Téléphone",        row["Téléphone"])}
              {f("IMM remplacement", row.Immatriculation_remplacement)}
              {f("Modèle rempl.",    row["Modèle_remplacement"])}
              {f("Début RL",         row["Date début"])}
              {f("Motif",            row.Motif)}
            </div>
          </div>
        ))}
        {/* Import rows */}
        {importRows.length > 0 && (() => {
          const parseDate = (s: string): string => {
            if (!s) return "";
            // DD/MM/YYYY HH:mm:ss
            const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
            if (m) {
              const [, d, mo, y, h = "00", min = "00", sec = "00"] = m;
              return `${y}-${mo.padStart(2,"0")}-${d.padStart(2,"0")}T${h.padStart(2,"0")}:${min}:${sec.padStart(2,"0")}`;
            }
            return s;
          };
          const sortedRows = [...importRows].sort((a, b) =>
            parseDate(b["DatePrestation"]).localeCompare(parseDate(a["DatePrestation"]))
          );
          const seenDatetimes = new Set<string>();
          const filteredRows: ImportRow[] = [];
          for (const r of sortedRows) {
            const dt = parseDate(r["DatePrestation"]).slice(0, 16); // YYYY-MM-DDTHH:mm
            if (!seenDatetimes.has(dt)) { seenDatetimes.add(dt); filteredRows.push(r); }
          }
          return (
            <div className="border-t border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-2 px-5 py-2">
                <svg className="h-3.5 w-3.5 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/>
                </svg>
                <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
                  Assistance Import ({filteredRows.length}/{importRows.length})
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-100 dark:border-zinc-800">
                      {["Evénement","N° de tel","Date prestation","Lieu de destination"].map(h => (
                        <th key={h} className="px-4 py-2 text-left font-medium text-zinc-400 dark:text-zinc-500 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50 dark:divide-zinc-900">
                    {filteredRows.map((row, i) => (
                      <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                        <td className="px-4 py-2 text-zinc-700 dark:text-zinc-200">{row["Evénement"]}</td>
                        <td className="px-4 py-2 text-zinc-500 whitespace-nowrap">{row["N° de tel"]}</td>
                        <td className="px-4 py-2 text-zinc-500 whitespace-nowrap">{parseDate(row["DatePrestation"]).replace("T", " ").slice(0, 16)}</td>
                        <td className="px-4 py-2 text-zinc-500">{row["Lieu de Destination"]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}


// ─── Import Assistance Card ───────────────────────────────────────────────────

type ImportRow = { "Reference dossier": string; "Date Ouverture": string; "Evénement": string; "Souscripteur": string; "Bénéficiaire": string; "N° de tel": string; "Marque Véhicule": string; "Immatricule": string; "Prestation": string; "DatePrestation": string; "Lieu de Destination": string; "Ville de sinistre": string; };

// ─── RL Card ──────────────────────────────────────────────────────────────────



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


  // ── Google Sheets ──────────────────────────────────────────────────────────
  const [bddRows, setBddRows] = useState<BddRow[]>([]);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [rlRows, setRlRows] = useState<RlRow[]>([]);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  // ── Dark mode toggle ───────────────────────────────────────────────────────
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved) setDark(saved === "dark");
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);
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
          setData(null); setVehicle(null); setContracts([]); setBddRows([]); setImportRows([]); setRlRows([]);
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

      // For sheet queries: search by resolved IMM and also original WW input
      // because the sheet may store the WW number as the vehicle identifier
      const sheetImmQs    = new URLSearchParams({ imm: immVal });
      const sheetWwQs     = rawVal !== immVal ? new URLSearchParams({ imm: rawVal }) : null;

      const [dsRes, parcRes, cpRes, bddRes, importRes, bddWwRes, importWwRes, rlRes, rlWwRes] = await Promise.all([
        fetch(`/api/ds/history?${dsQs}`),
        fetch(`/api/parc?${parcQs}`),
        fetch(`/api/cp?${cpQs}`),
        fetch(`/api/sheet?sheet=bdd&${sheetImmQs}`),
        fetch(`/api/sheet?sheet=import&${sheetImmQs}`),
        sheetWwQs ? fetch(`/api/sheet?sheet=bdd&${sheetWwQs}`) : Promise.resolve(null),
        sheetWwQs ? fetch(`/api/sheet?sheet=import&${sheetWwQs}`) : Promise.resolve(null),
        fetch(`/api/sheet?sheet=rl&${sheetImmQs}`),
        sheetWwQs ? fetch(`/api/sheet?sheet=rl&${sheetWwQs}`) : Promise.resolve(null),
      ]);

      const dsJson     = await dsRes.json()     as DsApiResponse;
      const parcJson   = await parcRes.json()   as ParcApiResponse;
      const cpJson     = await cpRes.json()     as CpApiResponse;
      const bddJson      = await bddRes.json();
      const importJson   = await importRes.json();
      const bddWwJson    = bddWwRes    ? await bddWwRes.json()    : { ok: false, items: [] };
      const importWwJson = importWwRes ? await importWwRes.json() : { ok: false, items: [] };
      const rlJson       = await rlRes.json();
      const rlWwJson     = rlWwRes     ? await rlWwRes.json()     : { ok: false, items: [] };

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

      // Merge IMM results + WW results, deduplicate by reference/IMM
      const mergeBdd = [
        ...(bddJson.ok ? bddJson.items : []),
        ...(bddWwJson.ok ? bddWwJson.items : []),
      ].filter((r, i, arr) => arr.findIndex(x => x.IMM === r.IMM && x.date === r.date) === i);
      const mergeImport = [
        ...(importJson.ok ? importJson.items : []),
        ...(importWwJson.ok ? importWwJson.items : []),
      ].filter((r, i, arr) => arr.findIndex(x => x["Reference dossier"] === r["Reference dossier"] && x["DatePrestation"] === r["DatePrestation"]) === i);
      setBddRows(mergeBdd);
      setImportRows(mergeImport);

      const mergeRl = [
        ...(rlJson.ok ? rlJson.items : []),
        ...(rlWwJson.ok ? rlWwJson.items : []),
      ].filter((r, i, arr) => arr.findIndex(x =>
        x.Reference === r.Reference &&
        x.Immatriculation_a_remplacer === r.Immatriculation_a_remplacer
      ) === i);
      setRlRows(mergeRl);

    } catch (e) {
      setData(null); setVehicle(null); setContracts([]); setBddRows([]); setImportRows([]); setRlRows([]);
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

 {/* Articles */}
<Link
  href="/articles"
  className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-400"
>
  🔎 Articles
</Link>

            {/* Dark mode toggle */}
            <button onClick={() => setDark(d => !d)}
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              title={dark ? "Passer en mode clair" : "Passer en mode sombre"}>
              {dark
                ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" strokeLinecap="round"/></svg>
                : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              }
              {dark ? "Clair" : "Sombre"}
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
        <div className={`mt-6 rounded-2xl border p-4 shadow-sm ${rlRows.length > 0 && !loading ? "border-red-400 bg-red-50 dark:border-red-700 dark:bg-red-950/20" : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"}`}>
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
        {vehicle && !loading && <div className="mt-4"><VehicleCard parc={vehicle} contracts={contracts} hasRl={rlRows.length > 0} /></div>}
        {(bddRows.length > 0 || rlRows.length > 0 || importRows.length > 0) && !loading && <div className="mt-3"><SheetCard bddRows={bddRows} rlRows={rlRows} importRows={importRows} /></div>}

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
                  {(() => {
                    const bcTotal = it.lines?.filter(l => l.price_source === "bc" && l.mt_ht != null).reduce((s, l) => s + (l.mt_ht ?? 0), 0) ?? 0;
                    return bcTotal > 0 ? (
                      <span className="text-sm font-semibold tabular-nums">{fmtNum(bcTotal, 2)} MAD</span>
                    ) : null;
                  })()}
                  <span className="text-sm font-bold tracking-tight">{nds}</span>
                </div>
              </div>

              {/* All card fields — always visible */}
              {allCardFields.length > 0 && (
                <div className="grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-3">
                  {allCardFields.map(f => {
                    const val = displayValue(it, f.key);
                    if (val === "—") return null;
                    return (
                      <div key={f.key} className={f.key === "Description" ? "sm:col-span-3" : ""}>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">{f.label}</div>
                        <div className={`text-sm font-medium text-zinc-800 dark:text-zinc-200 ${f.key === "Description" ? "whitespace-pre-wrap" : "truncate"}`}>
                          {val}
                        </div>
                      </div>
                    );
                  })}
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
                    totalMtHt={it.lines?.filter(l => l.price_source === "bc" && l.mt_ht != null).reduce((s, l) => s + (l.mt_ht ?? 0), 0) ?? 0}
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