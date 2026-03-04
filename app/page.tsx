// app/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

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
  id?: number;

  company?: string;
  client?: string;

  brand?: string;
  model?: string | number;

  imm?: string;
  ww?: string;
  vin?: string;

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
};

type ParcApiResponse = {
  ok: boolean;
  query: string;
  count: number;
  items: ParcItem[];
  item: ParcItem | null;
  error?: string;
};

// ─── Field definitions ────────────────────────────────────────────────────────

type MetaField = { key: keyof ParcItem; label: string };
type CardField = { key: keyof DsHistoryItem; label: string; group: string };
type LineField  = { key: keyof Line; label: string };

const VEHICLE_META_FIELDS: MetaField[] = [
  { key: "imm",               label: "Immatriculation" },
  { key: "ww",                label: "Numéro WW" },
  { key: "vin",               label: "VIN" },

  { key: "brand",             label: "Marque" },
  { key: "model",             label: "Modèle" },

  { key: "company",           label: "Société" },
  { key: "client",            label: "Client" },

  { key: "vehicle_type",      label: "Type véhicule" },
  { key: "vehicle_state",     label: "Etat véhicule" },

  { key: "location_type",     label: "Type location" },
  { key: "tenant",            label: "Locataire" },

  { key: "received",          label: "Reçu" },
  { key: "received_date",     label: "Date réception" },
  { key: "mce_date",          label: "Date MCE" },

  { key: "sold",              label: "Vendu" },
  { key: "scrap",             label: "Epave" },

  { key: "purchase_order",    label: "Bon de commande" },
  { key: "purchase_price_net",label: "Prix achat net" },
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

// ─── PDF export ───────────────────────────────────────────────────────────────

function buildPdfHtml(
  data: DsApiResponse,
  vehicle: ParcItem,
  orderedCardFields: CardField[],
  orderedLineFields: LineField[],
  visibleCardFields: Set<keyof DsHistoryItem>
): string {
  const now = new Date().toLocaleDateString("fr-FR");
  const NAVY = "#1e3a5f";

  const vehicleRows = VEHICLE_META_FIELDS.map(f => {
    const val = displayVehicleValue(vehicle, f.key);
    return `<tr>
      <td style="font-weight:600;padding:5px 10px;color:${NAVY};background:#eef3f8;width:190px;font-size:10.5px;border:1px solid #c5d3e0">${f.label}</td>
      <td style="padding:5px 10px;font-size:10.5px;border:1px solid #c5d3e0">${val}</td>
    </tr>`;
  }).join("");

  const dsHtml = data.items.map(it => {
    const topFields = CARD_FIELDS.filter(f => TOP_BAR_KEYS.has(f.key as string) && visibleCardFields.has(f.key));
    const topHtml   = topFields.map(f =>
      `<span style="margin-right:12px"><span style="opacity:.7">${f.label}:</span> <b>${displayValue(it, f.key)}</b></span>`
    ).join("");

    const gridFields = orderedCardFields.filter(f => !TOP_BAR_KEYS.has(f.key as string));
    const gridHtml = gridFields.length > 0
      ? `<table style="width:100%;border-collapse:collapse;margin-top:6px">
          ${gridFields.map(f => `<tr>
            <td style="font-weight:600;color:${NAVY};padding:3px 10px 3px 0;width:170px;font-size:10px;vertical-align:top">${f.label}</td>
            <td style="padding:3px 0;font-size:10.5px;white-space:${f.key==="Description"?"pre-wrap":"normal"}">${displayValue(it, f.key)}</td>
          </tr>`).join("")}
         </table>` : "";

    const linesHtml = (it.lines?.length && orderedLineFields.length > 0)
      ? `<div style="margin-top:10px">
           <div style="font-size:9.5px;font-weight:700;color:${NAVY};margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em">Lignes (${it.lines.length})</div>
           <table style="width:100%;border-collapse:collapse;font-size:9.5px">
             <thead><tr style="background:${NAVY};color:#fff">
               ${orderedLineFields.map(f=>`<th style="padding:5px 7px;text-align:${NUM_LINE_KEYS.has(f.key)?"right":"left"};border:1px solid ${NAVY}">${f.label}</th>`).join("")}
             </tr></thead>
             <tbody>
               ${it.lines.map((l,i)=>`<tr style="background:${i%2===1?"#f5f8fc":"#fff"}">
                 ${orderedLineFields.map(f=>`<td style="padding:4px 7px;border:1px solid #c5d3e0;text-align:${NUM_LINE_KEYS.has(f.key)?"right":"left"}">${displayLineValue(l,f.key)}</td>`).join("")}
               </tr>`).join("")}
             </tbody>
             ${it.lines.length>1&&visibleCardFields.has("MT Total HT")&&it["MT Total HT"]!=null?`
             <tfoot><tr style="background:#d5e8f0;font-weight:700">
               ${orderedLineFields.map((f,i)=>`<td style="padding:4px 7px;border:1px solid #c5d3e0;text-align:${NUM_LINE_KEYS.has(f.key)?"right":"left"}">${f.key==="mt_ht"?fmtNum(it["MT Total HT"],2):i===0?"Total":""}</td>`).join("")}
             </tr></tfoot>`:""}
           </table>
         </div>` : "";

    return `<div style="page-break-inside:avoid;margin-bottom:16px;border:1px solid #c5d3e0;border-radius:5px;overflow:hidden">
      <div style="background:${NAVY};padding:7px 12px;font-size:11px;color:#fff">
        <b>${it["N°DS"]}</b>${topHtml?`<span style="margin-left:14px;font-size:10px">${topHtml}</span>`:""}
      </div>
      <div style="padding:8px 12px;background:#fff">${gridHtml}${linesHtml}</div>
    </div>`;
  }).join("");

  const immTitle = (vehicle.imm ?? data.imm ?? "").toString();

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>Historique DS — ${immTitle}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:Arial,sans-serif;font-size:11px;color:#222;margin:20px}
  h1{font-size:16px;color:#1e3a5f;margin:0 0 4px}
  h2{font-size:12px;color:#1e3a5f;border-bottom:2px solid #1e3a5f;padding-bottom:4px;margin:18px 0 8px}
  @page{margin:12mm}
  @media print{body{margin:0}}
</style></head><body>
<h1>Historique DS — ${immTitle}</h1>
<p style="color:#888;font-size:10px;margin:0 0 14px">Généré le ${now} · ${data.count} dossier${data.count>1?"s":""}</p>
<h2>Véhicule</h2>
<table style="border-collapse:collapse;margin-bottom:16px;width:520px">${vehicleRows}</table>
<h2>Dossiers de service (${data.count})</h2>
${dsHtml}
</body></html>`;
}

function printAsPdf(html: string) {
  const win = window.open("", "_blank");
  if (!win) { alert("Veuillez autoriser les pop-ups pour télécharger le PDF."); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.addEventListener("load", () => { win.focus(); win.print(); });
}

// ─── DOCX export ──────────────────────────────────────────────────────────────

async function downloadDocx(
  data: DsApiResponse,
  vehicle: ParcItem,
  visibleCardFields: Set<keyof DsHistoryItem>,
  visibleLineFields: Set<keyof Line>,
  setExporting: (v: boolean) => void
) {
  setExporting(true);
  try {
    const cardFieldLabels = Object.fromEntries(CARD_FIELDS.map(f => [f.key, f.label]));
    const lineFieldLabels = Object.fromEntries(LINE_FIELDS.map(f => [f.key, f.label]));

    // ✅ moved to /api/export (your new structure)
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imm: (vehicle.imm ?? data.imm ?? "").toString(),
        count: data.count,
        items: data.items,

        // visibility & labels
        visibleCardFields: [...visibleCardFields],
        visibleLineFields: [...visibleLineFields],
        vehicleMetaFields: VEHICLE_META_FIELDS,
        cardFieldLabels,
        lineFieldLabels,
        topBarKeys: [...TOP_BAR_KEYS],

        // ✅ include parc vehicle card explicitly (export can use it)
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

// ─── Vehicle Meta Bar ─────────────────────────────────────────────────────────

function VehicleMetaBar({ item }: { item: ParcItem }) {
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
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-4">
        {VEHICLE_META_FIELDS.map(f => (
          <div key={String(f.key)}>
            <div className="text-xs text-zinc-400 dark:text-zinc-500">{f.label}</div>
            <div className="mt-0.5 truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              {displayVehicleValue(item, f.key)}
            </div>
          </div>
        ))}
      </div>
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
  const toggleCard = (key: keyof DsHistoryItem) => {
    const n = new Set(visibleCardFields); n.has(key) ? n.delete(key) : n.add(key); setVisibleCardFields(n);
  };
  const toggleLine = (key: keyof Line) => {
    const n = new Set(visibleLineFields); n.has(key) ? n.delete(key) : n.add(key); setVisibleLineFields(n);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end" onClick={onClose}>
      <div className="mr-4 mt-16 w-80 max-h-[80vh] overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-950"
           onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-zinc-100 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
          <span className="text-sm font-semibold">Champs visibles</span>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">✕ Fermer</button>
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
                    <button onClick={() => { const n = new Set(visibleCardFields); fields.forEach(f => n.add(f.key)); setVisibleCardFields(n); }} className="text-xs text-blue-500 hover:underline">Tout</button>
                    <button onClick={() => { const n = new Set(visibleCardFields); fields.forEach(f => { if (f.key !== "N°DS") n.delete(f.key); }); setVisibleCardFields(n); }} className="text-xs text-zinc-400 hover:underline">Aucun</button>
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
                <button onClick={() => setVisibleLineFields(new Set(LINE_FIELDS.map(f => f.key)))} className="text-xs text-blue-500 hover:underline">Tout</button>
                <button onClick={() => setVisibleLineFields(new Set(["code_art"] as (keyof Line)[]))} className="text-xs text-zinc-400 hover:underline">Aucun</button>
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

  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string>("");

  const [data, setData]         = useState<DsApiResponse | null>(null);
  const [vehicle, setVehicle]   = useState<ParcItem | null>(null);

  const [selectorOpen, setSelectorOpen] = useState(false);
  const [exportingDocx, setExportingDocx] = useState(false);

  const [visibleCardFields, setVisibleCardFields] = useState<Set<keyof DsHistoryItem>>(DEFAULT_CARD_VISIBLE);
  const [visibleLineFields, setVisibleLineFields] = useState<Set<keyof Line>>(DEFAULT_LINE_VISIBLE);

  const years = useMemo(() => {
    const now = new Date().getUTCFullYear();
    return Array.from({ length: 8 }, (_, i) => String(now - i));
  }, []);

  async function fetchAll(nextImm?: string) {
    const immVal = (nextImm ?? imm).trim();
    if (!immVal) return;

    setLoading(true);
    setError("");

    try {
      const dsQs = new URLSearchParams();
      dsQs.set("imm", immVal);
      dsQs.set("limit", String(limit));
      if (year) dsQs.set("year", year);

      const parcQs = new URLSearchParams();
      parcQs.set("imm", immVal);

      const [dsRes, parcRes] = await Promise.all([
        fetch(`/api/ds/history?${dsQs}`),
        fetch(`/api/parc?${parcQs}`),
      ]);

      const dsJson   = (await dsRes.json()) as DsApiResponse;
      const parcJson = (await parcRes.json()) as ParcApiResponse;

      // DS
      if (!dsRes.ok || !dsJson.ok) {
        setData(null);
        setError(dsJson?.error || `Erreur DS (${dsRes.status})`);
      } else {
        setData(dsJson);
      }

      // Parc (not blocking DS if missing)
      if (parcRes.ok && parcJson.ok) setVehicle(parcJson.item ?? null);
      else setVehicle(null);
    } catch (e) {
      setData(null);
      setVehicle(null);
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
    const v = vehicle ?? {
      imm: data.imm,
      brand: data.items?.[0]?.Marque,
      model: data.items?.[0]?.["Désignation véhicule"],
    } as ParcItem; // fallback
    printAsPdf(buildPdfHtml(data, v, orderedCardFields, orderedLineFields, visibleCardFields));
  }

  function handleDocx() {
    if (!data) return;
    const v = vehicle ?? ({ imm: data.imm } as ParcItem);
    downloadDocx(data, v, visibleCardFields, visibleLineFields, setExportingDocx);
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
              Champs ({visibleCardFields.size})
            </button>

            {/* PDF */}
            <button onClick={handlePdf} disabled={!data}
              className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-800/40 dark:bg-red-950/30 dark:text-red-400">
              <DlIcon /> PDF
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
            <div className="sm:col-span-5">
              <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Immatriculation / WW / VIN</label>
              <input value={imm} onChange={e => setImm(e.target.value)}
                onKeyDown={e => e.key==="Enter" && fetchAll()} placeholder="ex: 48070-B-7 / 832223WW / VIN"
                className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:focus:border-zinc-600" />
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

          {data && !loading && data.items.map(it => (
            <div key={it["N°DS"]} className="rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">

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
                {/* RIGHT: Site · N°DS · MAD · Type DS · Affectation */}
                <div className="flex flex-wrap items-center gap-2">
                  {visibleCardFields.has("MT Total HT") && it["MT Total HT"] != null && (
                    <span className="text-sm font-semibold tabular-nums">{fmtNum(it["MT Total HT"], 2)} MAD</span>
                  )}
                  {visibleCardFields.has("Site") && (
                    <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">{it.Site ?? "—"}</span>
                  )}
                  <span className="text-sm font-bold tracking-tight">{it["N°DS"]}</span>
                  {visibleCardFields.has("Type DS") && it["Type DS"] && (
                    <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium dark:bg-zinc-800 dark:text-zinc-300">{it["Type DS"]}</span>
                  )}
                  {visibleCardFields.has("Affectation") && it.Affectation && (
                    <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">{it.Affectation}</span>
                  )}
                </div>
              </div>

              {/* Field grid */}
              {orderedCardFields.length > 0 && (
                <div className="grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-3">
                  {orderedCardFields.map(f => (
                    <div key={f.key} className={f.key === "Description" ? "sm:col-span-3" : ""}>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">{f.label}</div>
                      <div className={`text-sm font-medium text-zinc-800 dark:text-zinc-200 ${f.key==="Description"?"whitespace-pre-wrap":"truncate"}`}>
                        {displayValue(it, f.key)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Lines */}
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
          ))}
        </div>
      </div>
    </div>
  );
}