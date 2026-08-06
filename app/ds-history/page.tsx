"use client";
import Link from "next/link";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Pencil } from "lucide-react";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { logout } from "@/app/login/actions";
import { clearPersistedAppState } from "@/lib/clearClientState";
import { ThemeToggle } from "@/components/fleet/ThemeToggle";
import { Combobox } from "@/components/ui/combobox";
import type {
  Line,
  DsHistoryItem,
  DsApiResponse,
  ParcItem,
  ParcApiResponse,
  CpItem,
  CpApiResponse,
  BddRow,
} from "@/lib/types";
import {
  getFlagStyle,
  getPrestataireDotClass,
  BDD_ZONE_DETECTION_HEADERS,
  BDD_EDITABLE_FIELDS,
  EMPLACEMENT_INTROUVABLE,
  etatBadgeClass,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { InlineEditSelect } from "@/components/fleet/InlineEditSelect";
import { InlineEditText } from "@/components/fleet/InlineEditText";
import { InlineEditCombobox } from "@/components/fleet/InlineEditCombobox";
import { FieldRowTrigger } from "@/components/fleet/FieldRowTrigger";
import { ReadonlyFieldList } from "@/components/fleet/ReadonlyFieldList";
import { useBddRows, useUpdateBddRow, useOptimisticBddUpdate } from "@/hooks/useBddRows";
import { useVehicleZone } from "@/hooks/useVehicleZone";
import { ZoneBadges } from "@/components/fleet/ZoneBadges";
import { buildPlateVariants } from "@/lib/plateVariants";
import type { RlRow } from "@/lib/googleSheetsRl";
import type { ImportRow } from "@/lib/googleSheetsImport";
import { fmtDate, fmtNum } from "@/lib/format";
import { useSheetFieldOptions, optionValues } from "@/hooks/useSheetFieldOptions";

type FieldKey = (typeof BDD_EDITABLE_FIELDS)[number];

// ─── Field-visibility persistence (localStorage, same pattern as the
// dark-mode toggle — previously a hand-rolled document.cookie utility) ──────

const STORAGE_CARD = "ds_visible_card";
const STORAGE_LINE = "ds_visible_line";

function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore quota/availability errors
  }
}

function loadCardFields(): Set<keyof DsHistoryItem> {
  try {
    const raw = localStorage.getItem(STORAGE_CARD);
    if (!raw) return DEFAULT_CARD_VISIBLE;
    const parsed = JSON.parse(raw) as string[];
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_CARD_VISIBLE;
    return new Set(parsed as (keyof DsHistoryItem)[]);
  } catch { return DEFAULT_CARD_VISIBLE; }
}

function loadLineFields(): Set<keyof Line> {
  try {
    const raw = localStorage.getItem(STORAGE_LINE);
    if (!raw) return DEFAULT_LINE_VISIBLE;
    const parsed = JSON.parse(raw) as string[];
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_LINE_VISIBLE;
    return new Set(parsed as (keyof Line)[]);
  } catch { return DEFAULT_LINE_VISIBLE; }
}

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
];

const DEFAULT_CARD_VISIBLE = new Set<keyof DsHistoryItem>([
  "N°DS","Date DS","ENTITE","KM","Description","Techniciens","Fournisseur",
]);
const DEFAULT_LINE_VISIBLE = new Set<keyof Line>(["cmd_num","designation_conso","qte"]);
const CARD_GROUPS = ["Identification","Localisation","DS Info","Intervenants"];
const TOP_BAR_KEYS = new Set(["Date DS","KM"]);
const NUM_LINE_KEYS = new Set(["qte"]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function displayValue(item: DsHistoryItem, key: keyof DsHistoryItem): string {
  const v = item[key];
  if (v == null) return "—";
  if (key === "Techniciens") return (v as string[]).join(", ") || "—";
  if (key === "KM") return fmtNum(v as number) + " km";

  if (key === "Date DS") return fmtDate(v as string);
  return String(v).trim() || "—";
}

// Search suggestions now match IMM/WW only (VIN search cut) — plate/WW
// standardization across the app. Formats one suggestion into the single
// display line the shared Combobox renders per row.
type SearchResult = { imm: string; ww: string; label: string; primary?: string; secondary?: string };

function formatSuggestion(s: SearchResult): string {
  const parts = [s.primary ?? s.imm];
  if (s.secondary) parts.push(`(${s.secondary})`);
  if (s.label) parts.push(`— ${s.label}`);
  return parts.join(" ");
}

function displayLineValue(line: Line, key: keyof Line): string {
  const v = line[key];
  if (v == null) return "—";
  if (key === "qte") return String(v);
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
  const zone = useVehicleZone(parc.imm ?? "");
  const zoneLabel = [zone.inParking && "Parking", zone.inAtelier && "Atelier", zone.inRdv && "RDV", zone.inDepot && "Dépôt"]
    .filter(Boolean)
    .join(" + ") || null;

  const f = (label: string, val?: string | null) => (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-card-foreground truncate">
        {val?.trim() || "—"}
      </div>
    </div>
  );

  return (
    <div className={`rounded-2xl border shadow-sm ${isRed ? "border-red-400 bg-red-50 dark:border-red-700 dark:bg-red-950/20" : "border-border bg-card dark:border-border dark:bg-card"}`}>
      {/* Header */}
      <div className={`flex items-center gap-2 border-b px-5 py-3 ${isRed ? "border-red-200 dark:border-red-800/50" : "border-border"}`}>
        <svg className={`h-4 w-4 ${isRed ? "text-red-500" : "text-muted-foreground"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="1" y="8" width="22" height="10" rx="2"/>
          <path d="M5 8V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2"/>
          <circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>
        </svg>
        <span className={`text-xs font-semibold uppercase tracking-widest ${isRed ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
          {isRed && "⚠ "}Véhicule
        </span>
        <span className="ml-auto text-xs italic text-muted-foreground">parc + cp</span>
      </div>

      {/* ── Priority row: always visible ── */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-3 lg:grid-cols-6">
        {f("Client",        parc.client)}
        {f("IMM",           parc.imm)}
        {f("WW",            parc.ww)}
        {f("Etat véhicule", parc.vehicle_state)}
        {f("Date MCE",      fmtDate(parc.mce_date ?? cp?.mce_date))}
        {f("Fin contrat",   fmtDate(cp?.date_fin_contrat))}
        {zoneLabel && f("Zone", zoneLabel)}
      </div>

      {/* ── Version full width ── */}
      {cp?.version && (
        <div className="border-t border-border px-5 py-3 dark:border-border">
          <div className="text-xs text-muted-foreground">Version</div>
          <div className="mt-0.5 text-sm font-medium text-card-foreground leading-snug">{cp.version}</div>
        </div>
      )}

      {/* ── Extra: expand/collapse ── */}
      {open && (
        <div className="border-t border-border px-5 py-4 space-y-4 dark:border-border">
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
              <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Autres contrats ({contracts.length - 1})</div>
              <div className="space-y-2">
                {contracts.slice(1).map((c, i) => (
                  <div key={i} className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-xl border border-border px-4 py-3 sm:grid-cols-4 dark:border-border">
                    {f("IMM", c.imm)} {f("Fin contrat", fmtDate(c.date_fin_contrat))} {f("Type relais", c.type)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <button onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-center gap-1.5 border-t border-border py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground">
        {open
          ? <><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 10l4-4 4 4" strokeLinecap="round"/></svg> Voir moins</>
          : <><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6l4 4 4-4" strokeLinecap="round"/></svg> Voir plus</>}
      </button>
    </div>
  );
}



// ─── Lines Table ──────────────────────────────────────────────────────────────

function LinesTable({ lines, orderedLineFields }: {
  lines: Line[]; orderedLineFields: LineField[];
}) {
  if (!lines.length || !orderedLineFields.length) return null;
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted text-left text-xs font-semibold text-muted-foreground dark:bg-card dark:text-muted-foreground">
            {orderedLineFields.map(f => (
              <th key={f.key} className={`px-3 py-2 whitespace-nowrap ${NUM_LINE_KEYS.has(f.key) ? "text-right" : ""}`}>{f.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {lines.map((l, idx) => (
            <tr key={idx} className="hover:bg-muted">
              {orderedLineFields.map(f => (
                <td key={f.key} className={`px-3 py-2 ${
                  NUM_LINE_KEYS.has(f.key) ? "text-right tabular-nums font-medium"
                  : f.key==="code_art" ? "font-mono text-xs font-medium text-card-foreground"
                  : "text-muted-foreground"
                }`}>
                  {displayLineValue(l, f.key)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
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
    storageSet(STORAGE_CARD, JSON.stringify([...s]));
    setVisibleCardFields(s);
  }
  function saveLine(s: Set<keyof Line>) {
    storageSet(STORAGE_LINE, JSON.stringify([...s]));
    setVisibleLineFields(s);
  }

  const toggleCard = (key: keyof DsHistoryItem) => {
    const n = new Set(visibleCardFields);
    if (n.has(key)) n.delete(key); else n.add(key);
    saveCard(n);
  };
  const toggleLine = (key: keyof Line) => {
    const n = new Set(visibleLineFields);
    if (n.has(key)) n.delete(key); else n.add(key);
    saveLine(n);
  };
  // Same corner-panel visual design as before, now driven by Radix Dialog so
  // ESC and outside-click both dismiss (the old version only had the latter,
  // via a manual full-screen click-catcher) and focus is trapped inside.
  // No visible overlay (bg-transparent) — original never dimmed the page.
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex items-start justify-end outline-none"
          aria-describedby={undefined}
        >
      <div className="mr-4 mt-16 w-80 max-h-[80vh] overflow-y-auto rounded-2xl border border-border bg-popover shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-popover px-4 py-3">
          <DialogPrimitive.Title asChild>
            <span className="text-sm font-semibold">Champs visibles</span>
          </DialogPrimitive.Title>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { saveCard(DEFAULT_CARD_VISIBLE); saveLine(DEFAULT_LINE_VISIBLE); }}
              className="rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
              title="Réinitialiser aux champs par défaut">
              ↺ Reset
            </button>
            <button onClick={onClose} className="rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-muted">✕ Fermer</button>
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
                  <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{group}</span>
                  <div className="flex gap-2">
                    <button onClick={() => { const n = new Set(visibleCardFields); fields.forEach(f => n.add(f.key)); saveCard(n); }} className="text-xs text-blue-500 hover:underline">Tout</button>
                    <button onClick={() => { const n = new Set(visibleCardFields); fields.forEach(f => { if (f.key !== "N°DS") n.delete(f.key); }); saveCard(n); }} className="text-xs text-muted-foreground hover:underline">Aucun</button>
                  </div>
                </div>
                <div className="space-y-1">
                  {fields.map(f => (
                    <label key={f.key} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted">
                      <input type="checkbox" checked={visibleCardFields.has(f.key)} onChange={() => toggleCard(f.key)} disabled={f.key==="N°DS"} className="h-3.5 w-3.5 accent-foreground" />
                      <span className="text-sm text-card-foreground">{f.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Colonnes lignes</span>
              <div className="flex gap-2">
                <button onClick={() => saveLine(new Set(LINE_FIELDS.map(f => f.key)))} className="text-xs text-blue-500 hover:underline">Tout</button>
                <button onClick={() => saveLine(new Set(["code_art"] as (keyof Line)[]))} className="text-xs text-muted-foreground hover:underline">Aucun</button>
              </div>
            </div>
            <div className="space-y-1">
              {LINE_FIELDS.map(f => (
                <label key={f.key} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted">
                  <input type="checkbox" checked={visibleLineFields.has(f.key)} onChange={() => toggleLine(f.key)} className="h-3.5 w-3.5 accent-foreground" />
                  <span className="text-sm text-card-foreground">{f.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}


// ─── Sheet Card (BDD + RL merged) ────────────────────────────────────────────

// etatBadgeClass (lib/types.ts) replaces this file's own local mapping —
// that local one covered ANNULEE but not ANNULE, and drifted independently
// from app/suivi-rl/page.tsx's own simpler ETAT styling. Shared now so
// both pages render the same ETAT value identically. Kept as a thin local
// alias (not inlining every call site) since etatStyle's name is already
// used at both call sites below and in comments referencing it.
const etatStyle = etatBadgeClass;

function f(label: string, val?: string) {
  return val ? (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 whitespace-normal break-words text-sm font-semibold text-card-foreground">
        {val}
      </div>
    </div>
  ) : null;
}

// ─── BDD row (editable) ───────────────────────────────────────────────────────
//
// Same 6 BDD_EDITABLE_FIELDS, same InlineEdit* components, same
// useUpdateBddRow/useOptimisticBddUpdate mutation as app/suivi-rl/page.tsx —
// this card and Suivi RL edit the exact same sheet row (matched by `_row`),
// now via the same shared react-query cache (see useBddRows()), so a write
// from either page is reflected in the other. One component per row (not
// inlined in a .map()) because the commit hooks must be called at a stable
// position — same reason Suivi RL's BddCard is its own component.
function BddEditableRow({ row }: { row: BddRow }) {
  const updateMutation = useUpdateBddRow();
  const applyOptimisticUpdate = useOptimisticBddUpdate();
  const zone = useVehicleZone(row.IMM);
  const { options } = useSheetFieldOptions();

  function commitField(field: FieldKey) {
    return async (value: string) => {
      await updateMutation.mutateAsync({ row: row._row, updates: { [field]: value }, imm: row.IMM });
      applyOptimisticUpdate(row._row, { [field]: value } as Partial<BddRow>);
    };
  }

  const dot = getPrestataireDotClass(row.prestataire, options.PRESTATAIRE_OPTIONS);
  // WARNING: Emplacement is admin-editable at /admin/config — if
  // EMPLACEMENT_INTROUVABLE's exact value is ever renamed or removed
  // there, this comparison silently stops matching anything and the alert
  // styling disappears with no error (see its comment in lib/types.ts).
  const isIntrouvable = row.Emplacement === EMPLACEMENT_INTROUVABLE;

  return (
    <div
      className={`px-5 py-4 ${
        isIntrouvable ? "border border-red-400 bg-red-50 dark:border-red-700 dark:bg-red-950/20" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <InlineEditSelect
          value={row.ETAT}
          options={options.ETAT_OPTIONS}
          label="État"
          onCommit={commitField("ETAT")}
          renderTrigger={({ value, pending, justSaved, onOpen }) => (
            <button
              type="button"
              onClick={onOpen}
              disabled={pending}
              className={`flex min-h-11 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-60 ${etatStyle(value)} ${justSaved ? "ring-2 ring-emerald-400" : ""}`}
            >
              {value || "—"}
              <Pencil className="h-3 w-3 opacity-60" />
            </button>
          )}
        />
        <InlineEditSelect
          value={row.flag}
          options={optionValues(options.FLAG_OPTIONS)}
          label="Flag"
          onCommit={commitField("flag")}
          renderTrigger={({ value, pending, justSaved, onOpen }) => (
            <button type="button" onClick={onOpen} disabled={pending} className="disabled:opacity-60">
              {value && getFlagStyle(value, options.FLAG_OPTIONS) ? (
                <Badge className={`${getFlagStyle(value, options.FLAG_OPTIONS)!.badge} ${justSaved ? "ring-2 ring-emerald-400" : ""}`}>{value}</Badge>
              ) : (
                <span className={`rounded-lg border border-dashed border-border px-1.5 py-0.5 text-micro text-muted-foreground ${justSaved ? "ring-2 ring-emerald-400" : ""}`}>
                  + Flag
                </span>
              )}
            </button>
          )}
        />
        <ZoneBadges {...zone} />
        {isIntrouvable && <Badge variant="error">⚠ Introuvable</Badge>}
        {row.date && <span className="text-xs text-muted-foreground">{row.date}</span>}
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <InlineEditSelect
          value={row.Emplacement}
          options={options.EMPLACEMENT_OPTIONS}
          label="Emplacement"
          onCommit={commitField("Emplacement")}
          renderTrigger={(state) => <FieldRowTrigger label="Emplacement" placeholder="— Choisir —" {...state} />}
        />
        <InlineEditCombobox
          value={row.prestataire}
          options={optionValues(options.PRESTATAIRE_OPTIONS)}
          onCommit={commitField("prestataire")}
          placeholder="Prestataire…"
          renderTrigger={(state) => <FieldRowTrigger label="Prestataire" placeholder="— Aucun —" dot={dot} {...state} />}
        />
        <InlineEditSelect
          value={row["Catégorie"]}
          options={options.CATEGORIE_OPTIONS}
          label="Catégorie"
          onCommit={commitField("Catégorie")}
          renderTrigger={(state) => <FieldRowTrigger label="Catégorie" placeholder="— Choisir —" {...state} />}
        />
        <InlineEditSelect
          value={row.Technicien}
          options={options.TECHNICIEN_OPTIONS}
          label="Technicien"
          onCommit={commitField("Technicien")}
          renderTrigger={(state) => <FieldRowTrigger label="Technicien" placeholder="— Choisir —" {...state} />}
        />
        {f("Réunion N-1", row["Reunion N-1"])}
      </div>

      <div className="mt-3">
        <InlineEditText
          value={row.commentaire}
          resyncDeps={[row._row, row.commentaire]}
          onCommit={commitField("commentaire")}
          placeholder="Commentaire…"
        />
      </div>

      <ReadonlyFieldList
        fields={[
          { label: "RDV", value: row.RDV },
          { label: "CONVOYEUR", value: row.CONVOYEUR },
          { label: "Intervention", value: row.Intervention },
        ]}
      />
      <ReadonlyFieldList
        title="Détection de zone (auto)"
        fields={BDD_ZONE_DETECTION_HEADERS.map((h) => ({ label: h, value: String(row[h] ?? "") }))}
      />
    </div>
  );
}

function SheetCard({ bddRows, rlRows, importRows }: { bddRows: BddRow[]; rlRows: RlRow[]; importRows: ImportRow[] }) {
  if (!bddRows.length && !rlRows.length && !importRows.length) return null;

  const hasRl = rlRows.length > 0;

  return (
    <div className={`rounded-2xl border shadow-sm ${hasRl ? "border-red-400 bg-red-50 dark:border-red-700 dark:bg-red-950/20" : "border-border bg-card dark:border-border dark:bg-card"}`}>
      {/* Header */}
      <div className={`flex items-center gap-2 border-b px-5 py-3 ${hasRl ? "border-red-200 dark:border-red-800/50" : "border-border"}`}>
        <svg className={`h-4 w-4 ${hasRl ? "text-red-500" : "text-muted-foreground"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
        <span className={`text-xs font-semibold uppercase tracking-widest ${hasRl ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
          {hasRl && "⚠ "}Immobilisation BDD {bddRows.length > 0 && `(${bddRows.length})`}
        </span>
        <span className="ml-auto text-xs italic text-muted-foreground">Source Google Sheets</span>
      </div>

      <div className="divide-y divide-border">
        {/* BDD rows */}
        {bddRows.map((row) => (
          <BddEditableRow key={row._row} row={row} />
        ))}

        {/* RL rows */}
        {rlRows.map((row, i) => (
          <div key={`rl-${i}`} className="px-5 py-4">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-xs font-bold text-red-600 dark:text-red-400 uppercase tracking-wide">Véhicule de remplacement</span>
              <span className="text-xs font-mono text-muted-foreground">{row.Reference}</span>
              {row.Date && <span className="text-xs text-muted-foreground">{row.Date}</span>}
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
            <div className="border-t border-border">
              <div className="flex items-center gap-2 px-5 py-2">
                <svg className="h-3.5 w-3.5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/>
                </svg>
                <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Assistance Import ({filteredRows.length}/{importRows.length})
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full table-fixed text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="w-[20%] px-4 py-2 text-left font-medium text-muted-foreground">Evénement</th>
                      <th className="w-[18%] px-4 py-2 text-left font-medium text-muted-foreground">N° de tel</th>
                      <th className="w-[24%] px-4 py-2 text-left font-medium text-muted-foreground">Date prestation</th>
                      <th className="w-[38%] px-4 py-2 text-left font-medium text-muted-foreground">Lieu de destination</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredRows.map((row, i) => (
                      <tr key={i} className="hover:bg-muted">
                        <td className="whitespace-normal break-words px-4 py-2 text-card-foreground">{row["Evénement"]}</td>
                        <td className="whitespace-normal break-words px-4 py-2 text-muted-foreground">{row["N° de tel"]}</td>
                        <td className="whitespace-normal break-words px-4 py-2 text-muted-foreground">{parseDate(row["DatePrestation"]).replace("T", " ").slice(0, 16)}</td>
                        <td className="whitespace-normal break-words px-4 py-2 text-muted-foreground">{row["Lieu de Destination"]}</td>
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


// ─── RL Card ──────────────────────────────────────────────────────────────────



// ─── Download icon ────────────────────────────────────────────────────────────

function DlIcon({ spinning }: { spinning?: boolean }) {
  return spinning
    ? <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="animate-spin"><circle cx="8" cy="8" r="6" strokeDasharray="28" strokeDashoffset="10"/></svg>
    : <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 12h10M8 2v8M5 7l3 3 3-3" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Home() {
  const queryClient = useQueryClient();

  // Plain onClick instead of <form action={logout}> — see
  // lib/clearClientState.ts's comment: the persisted BDD dataset in
  // localStorage must be cleared client-side before the server action
  // (which only destroys the session cookie) runs.
  async function handleLogout() {
    clearPersistedAppState(queryClient);
    await logout();
  }

  const [imm, setImm] = useState("48070-B-7");

  // Smart search suggestions
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

  // Formatted display label per suggestion (what the shared Combobox
  // renders), mapped back to the underlying SearchResult for onSelect.
  const { suggestionOptions, suggestionByLabel } = useMemo(() => {
    const options: string[] = [];
    const byLabel = new Map<string, SearchResult>();
    for (const s of suggestions) {
      const label = formatSuggestion(s);
      options.push(label);
      byLabel.set(label, s);
    }
    return { suggestionOptions: options, suggestionByLabel: byLabel };
  }, [suggestions]);

  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string>("");
  const fetchIdRef = useRef(0);

  const [data, setData]         = useState<DsApiResponse | null>(null);
  const [vehicle, setVehicle]   = useState<ParcItem | null>(null);
  const [contracts, setContracts] = useState<CpItem[]>([]);


  // ── Google Sheets ──────────────────────────────────────────────────────────
  // BDD rows come from the same useBddRows() react-query cache Suivi RL uses
  // (unfiltered fetch of the whole tab) — filtered here to just the plate(s)
  // currently being viewed, by IMM/WW variant, the same matching logic
  // /api/sheet?sheet=bdd used to apply server-side (see lib/plateVariants.ts).
  // Sharing the cache (not just the sheet) means an edit made here or on
  // Suivi RL is reflected in the other without a page reload.
  const bddRowsQuery = useBddRows();
  const [bddMatchVariants, setBddMatchVariants] = useState<Set<string> | null>(null);
  const bddRows = useMemo(() => {
    if (!bddMatchVariants || !bddRowsQuery.data) return [];
    return bddRowsQuery.data.filter((r) => bddMatchVariants.has(String(r.IMM ?? "").trim().toUpperCase()));
  }, [bddRowsQuery.data, bddMatchVariants]);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [rlRows, setRlRows] = useState<RlRow[]>([]);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [exportingDocx, setExportingDocx] = useState(false);
  const [exportingPdf,  setExportingPdf]  = useState(false);

  const [visibleCardFields, setVisibleCardFields] = useState<Set<keyof DsHistoryItem>>(() => new Set(DEFAULT_CARD_VISIBLE));
  const [visibleLineFields, setVisibleLineFields] = useState<Set<keyof Line>>(() => new Set(DEFAULT_LINE_VISIBLE));

  // Load cookie preferences after mount (avoids SSR/client hydration mismatch)
  useEffect(() => {
    setVisibleCardFields(loadCardFields());
    setVisibleLineFields(loadLineFields());
  }, []);

  async function fetchAll(nextImm?: string) {
    const rawVal = (nextImm ?? imm).trim();
    if (!rawVal) return;

    // Guards against an earlier, slower search's response overwriting a
    // later one's — whichever fetchAll() call was started last "wins".
    const fetchId = ++fetchIdRef.current;
    const isCurrent = () => fetchIdRef.current === fetchId;

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
        if (!isCurrent()) return;
        if (resolveJson.ok && resolveJson.mode === "suggest") {
          setSuggestions(resolveJson.suggestions ?? []);
          setShowSuggestions(true);
          setData(null); setVehicle(null); setContracts([]); setBddMatchVariants(null); setImportRows([]); setRlRows([]);
          return;
        }
        if (resolveJson.ok && resolveJson.mode === "data") {
          immVal = resolveJson.imm ?? rawVal;
          setImm(immVal);
        }
      }

      const dsQs   = new URLSearchParams({ imm: immVal });
      const parcQs = new URLSearchParams({ imm: immVal });
      const cpQs   = new URLSearchParams({ imm: immVal, ww: immVal });

      // For sheet queries: search by resolved IMM and also original WW input
      // because the sheet may store the WW number as the vehicle identifier
      const sheetImmQs    = new URLSearchParams({ imm: immVal });
      const sheetWwQs     = rawVal !== immVal ? new URLSearchParams({ imm: rawVal }) : null;

      const [dsRes, parcRes, cpRes, importRes, importWwRes, rlRes, rlWwRes] = await Promise.all([
        fetch(`/api/ds/history?${dsQs}`),
        fetch(`/api/parc?${parcQs}`),
        fetch(`/api/cp?${cpQs}`),
        fetch(`/api/sheet?sheet=import&${sheetImmQs}`),
        sheetWwQs ? fetch(`/api/sheet?sheet=import&${sheetWwQs}`) : Promise.resolve(null),
        fetch(`/api/sheet?sheet=rl&${sheetImmQs}`),
        sheetWwQs ? fetch(`/api/sheet?sheet=rl&${sheetWwQs}`) : Promise.resolve(null),
      ]);

      const dsJson     = await dsRes.json()     as DsApiResponse;
      const parcJson   = await parcRes.json()   as ParcApiResponse;
      const cpJson     = await cpRes.json()     as CpApiResponse;
      const importJson   = await importRes.json();
      const importWwJson = importWwRes ? await importWwRes.json() : { ok: false, items: [] };
      const rlJson       = await rlRes.json();
      const rlWwJson     = rlWwRes     ? await rlWwRes.json()     : { ok: false, items: [] };

      if (!isCurrent()) return;

      // BDD rows: filter the shared useBddRows() cache client-side by the
      // same IMM/WW variant set /api/sheet?sheet=bdd used to match
      // server-side, instead of a separate fetch — see bddRows useMemo above.
      setBddMatchVariants(new Set([
        ...buildPlateVariants(immVal),
        ...(rawVal !== immVal ? buildPlateVariants(rawVal) : []),
      ]));

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

      // Merge IMM results + WW results, deduplicate by reference
      const mergeImport = [
        ...(importJson.ok ? importJson.items : []),
        ...(importWwJson.ok ? importWwJson.items : []),
      ].filter((r, i, arr) => arr.findIndex(x => x["Reference dossier"] === r["Reference dossier"] && x["DatePrestation"] === r["DatePrestation"]) === i);
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
      if (!isCurrent()) return;
      setData(null); setVehicle(null); setContracts([]); setBddMatchVariants(null); setImportRows([]); setRlRows([]);
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      if (isCurrent()) setLoading(false);
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
    <div className="min-h-screen bg-background text-foreground">
      <FieldSelector
        visibleCardFields={visibleCardFields} setVisibleCardFields={setVisibleCardFields}
        visibleLineFields={visibleLineFields}  setVisibleLineFields={setVisibleLineFields}
        open={selectorOpen} onClose={() => setSelectorOpen(false)}
      />

      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">

        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link href="/" className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition hover:text-foreground">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 3L5 8l5 5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Accueil
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight">DS History</h1>
            <p className="mt-1 text-sm text-muted-foreground">Recherche par immatriculation / WW</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground dark:border-border dark:bg-card dark:text-card-foreground">
              {data ? `${data.count} DS` : "—"}
            </span>
            <span className="inline-flex items-center rounded-full border border-border bg-card px-2.5 py-1 text-xs dark:border-border dark:bg-card">
              {loading ? "⏳ Chargement…" : "✓ Prêt"}
            </span>

            {/* Champs */}
            <button onClick={() => setSelectorOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-foreground transition hover:bg-muted/70">
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

            <ThemeToggle className="border-border bg-muted text-foreground hover:bg-muted/70" />

            {/* Logout */}
            <button type="button" onClick={handleLogout}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-foreground transition hover:bg-muted/70"
              title="Se déconnecter">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" strokeLinecap="round" strokeLinejoin="round"/><path d="M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Déconnexion
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
        <div className={`mt-6 rounded-2xl border p-4 shadow-sm ${rlRows.length > 0 && !loading ? "border-red-400 bg-red-50 dark:border-red-700 dark:bg-red-950/20" : "border-border bg-card dark:border-border dark:bg-card"}`}>
          <div className="grid gap-3 sm:grid-cols-12 sm:items-end">
            <div className="sm:col-span-10" ref={searchRef}>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Immatriculation / WW</label>
              <Combobox
                value={imm}
                onValueChange={handleImmChange}
                open={showSuggestions}
                onOpenChange={setShowSuggestions}
                options={suggestionOptions}
                onSelect={(label) => {
                  const s = suggestionByLabel.get(label);
                  if (s) selectSuggestion(s);
                }}
                loading={searchLoading}
                placeholder="ex: 48070 / 832223WW"
                inputMode="numeric"
                onKeyDownCapture={(e) => {
                  if (e.key === "Enter" && suggestions.length === 0) {
                    e.preventDefault();
                    setShowSuggestions(false);
                    fetchAll();
                  }
                }}
              />
            </div>
            <div className="sm:col-span-2">
              <button onClick={() => fetchAll()} disabled={loading || !imm.trim()}
                className="h-11 w-full rounded-xl bg-foreground px-4 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
                Rechercher
              </button>
            </div>
          </div>

          {error && (
            <Alert className="mt-3">{error}</Alert>
          )}
        </div>

        {/* Vehicle metadata (from parc) */}
        {vehicle && !loading && <div className="mt-4"><VehicleCard parc={vehicle} contracts={contracts} hasRl={rlRows.length > 0} /></div>}
        {(bddRows.length > 0 || rlRows.length > 0 || importRows.length > 0) && !loading && <div className="mt-3"><SheetCard bddRows={bddRows} rlRows={rlRows} importRows={importRows} /></div>}

        {/* Results */}
        <div className="mt-4 space-y-3">
          {!data && !loading && (
            <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground dark:border-border dark:bg-card">
              Entrez une immatriculation et cliquez sur Rechercher.
            </div>
          )}

          {loading && (
            <div className="rounded-2xl border border-border bg-card p-6 dark:border-border dark:bg-card">
              <div className="h-5 w-48 animate-pulse rounded-lg bg-muted" />
              <div className="mt-4 space-y-3">
                {[0,1,2,3].map(i => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />)}
              </div>
            </div>
          )}

          {data && !loading && data.items.map(it => {
            const nds = it["N°DS"];

            // All card fields always visible (no collapse for DS cards)
            const allCardFields = orderedCardFields;

            return (
            <div key={nds} className="rounded-2xl border border-border bg-card shadow-sm dark:border-border dark:bg-card">

              {/* Top bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3 dark:border-border">
                {/* LEFT: date · KM */}
                <div className="flex flex-wrap items-center gap-2">
                  {visibleCardFields.has("Date DS") && (
                    <span className="text-sm font-bold tabular-nums text-card-foreground">{fmtDate(it["Date DS"])}</span>
                  )}
                  {visibleCardFields.has("KM") && it.KM != null && (
                    <><span className="text-muted-foreground">•</span>
                    <span className="text-sm font-bold tabular-nums text-card-foreground">{fmtNum(it.KM)} km</span></>
                  )}
                </div>
                {/* RIGHT: MAD · Site · N°DS · Type DS · Affectation */}
                <div className="flex flex-wrap items-center gap-2">
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
                        <div className="text-xs text-muted-foreground">{f.label}</div>
                        <div className={`text-sm font-medium text-card-foreground ${f.key === "Description" ? "whitespace-pre-wrap" : "truncate"}`}>
                          {val}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Lines — always visible */}
              {it.lines?.length && orderedLineFields.length > 0 ? (
                <div className="border-t border-border px-5 pb-4 pt-3 dark:border-border">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Lignes ({it.lines.length})
                  </div>
                  <LinesTable
                    lines={it.lines}
                    orderedLineFields={orderedLineFields}
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