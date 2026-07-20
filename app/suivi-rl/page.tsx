"use client";

import { useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { BDD_HEADERS, type BddRow } from "@/lib/types";
import { ListPageHeader } from "@/components/fleet/ListPageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { usePlateAutocomplete } from "@/hooks/usePlateAutocomplete";
import { InlineEditSelect, type InlineEditTriggerState } from "@/components/fleet/InlineEditSelect";
import { InlineEditText } from "@/components/fleet/InlineEditText";
import { InlineEditCombobox } from "@/components/fleet/InlineEditCombobox";
import { cn } from "@/components/ui/utils";
import { useBddRows, useUpdateBddRow, useOptimisticBddUpdate } from "@/hooks/useBddRows";

// ─── Dropdown option lists — exact, given verbatim, not invented ──────────────

const ETAT_OPTIONS = ["INTERNE", "EXTERNE", "DISPONIBLE", "ANNULE", "ANNULEE"];

const FLAG_OPTIONS = ["Urgent", "Prêt", "NTR", "INST", "REP", "ESSAI"];

const FLAG_STYLE: Record<string, { border: string; badge: string }> = {
  Urgent: { border: "border-l-red-500", badge: "bg-red-500/10 text-red-400 border-red-500/20" },
  "Prêt": { border: "border-l-emerald-500", badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  NTR: { border: "border-l-zinc-500", badge: "bg-zinc-500/10 text-zinc-300 border-zinc-500/20" },
  INST: { border: "border-l-amber-500", badge: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  REP: { border: "border-l-orange-500", badge: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  ESSAI: { border: "border-l-blue-500", badge: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
};

const CATEGORIE_OPTIONS = [
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

const TECHNICIEN_OPTIONS = [
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
const PRESTATAIRE_OPTIONS = [
  "SCAL", "amine diag", "pres injection", "simo BV", "EMAA", "nabil",
  "ELECTRO DIESEL", "FATR", "OPTIMUM", "HAMID CLIM", "nabil plaque",
  "M-AUTOMOTIV", "CAC", "BUGSHAN", "STELLANTIS", "SMEIA", "BAMOTORS",
  "JAMEEL", "VOVLO", "My cherif Pneu", "FAP",
];

function prestataireDotClass(val: string): string | null {
  if (PRESTATAIRE_GREEN.has(val)) return "bg-emerald-500";
  if (PRESTATAIRE_YELLOW.has(val)) return "bg-amber-400";
  return null;
}

function formatAge(dataUpdatedAt: number): string {
  if (!dataUpdatedAt) return "";
  const minutes = Math.round((Date.now() - dataUpdatedAt) / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes}m`;
  return `il y a ${Math.floor(minutes / 60)}h`;
}

// Server allowlist (lib/types.ts's BDD_EDITABLE_FIELDS) is unchanged — this
// page just commits one of these 6 keys at a time now instead of bundling
// all 6 into one form submit.
type FieldKey = "ETAT" | "prestataire" | "flag" | "Catégorie" | "commentaire" | "Technicien";

// Everything shown once, either as one of the always-visible editable rows
// below or promoted into the client/modele subtitle — the remainder is
// read-only reference data, rendered dimmer/unlabeled-background to read as
// clearly non-interactive.
const READONLY_HEADERS = BDD_HEADERS.filter(
  (h) =>
    h !== "IMM" &&
    h !== "date" &&
    h !== "client" &&
    h !== "modele" &&
    h !== "ETAT" &&
    h !== "prestataire" &&
    h !== "flag" &&
    h !== "commentaire" &&
    h !== "Catégorie" &&
    h !== "Technicien"
);

// ─── Shared trigger look for the "labeled row" editable fields (Catégorie,
// Technicien, Prestataire) — a faint background + pencil affordance marks
// these as tappable, distinct from the plain read-only rows below them. ────

function FieldRowTrigger({
  label,
  value,
  placeholder,
  pending,
  justSaved,
  error,
  onOpen,
  dot,
}: {
  label: string;
  value: string;
  placeholder: string;
  pending: boolean;
  justSaved: boolean;
  error: string;
  onOpen: () => void;
  dot?: string | null;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onOpen}
        disabled={pending}
        className={cn(
          "flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition disabled:opacity-60",
          justSaved
            ? "border-emerald-500/60 bg-emerald-500/5"
            : error
              ? "border-red-500/60 bg-red-500/5"
              : "border-zinc-800 bg-zinc-800/50 active:bg-zinc-800"
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="flex-shrink-0 text-[9px] font-bold uppercase text-zinc-500">{label}</span>
          {dot && <span className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${dot}`} />}
          <span className={cn("truncate", value ? "text-zinc-200" : "italic text-zinc-600")}>{value || placeholder}</span>
        </span>
        <Pencil className="h-3 w-3 flex-shrink-0 text-zinc-600" />
      </button>
      {error && <div className="mt-1 text-[10px] text-red-400">{error}</div>}
    </div>
  );
}

// ─── Card ───────────────────────────────────────────────────────────────────

function BddCard({ row }: { row: BddRow }) {
  const updateMutation = useUpdateBddRow();
  const applyOptimisticUpdate = useOptimisticBddUpdate();

  function commitField(field: FieldKey) {
    return async (value: string) => {
      await updateMutation.mutateAsync({ row: row._row, updates: { [field]: value } });
      applyOptimisticUpdate(row._row, { [field]: value } as Partial<BddRow>);
    };
  }

  const flagStyle = FLAG_STYLE[row.flag] ?? null;
  const dot = prestataireDotClass(row.prestataire);
  const populatedReadonly = READONLY_HEADERS.filter((h) => String(row[h] ?? "").trim());

  return (
    <Card className={flagStyle ? `border-l-4 ${flagStyle.border}` : ""}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold text-amber-400">{row.IMM}</span>
          {row.date && <span className="font-mono text-xs text-zinc-500">{row.date}</span>}
          <InlineEditSelect
            value={row.flag}
            options={FLAG_OPTIONS}
            label="Flag"
            onCommit={commitField("flag")}
            renderTrigger={({ value, pending, justSaved, onOpen }: InlineEditTriggerState) => (
              <button
                type="button"
                onClick={onOpen}
                disabled={pending}
                className="flex min-h-8 items-center py-1 disabled:opacity-60"
              >
                {value && FLAG_STYLE[value] ? (
                  <Badge className={cn(FLAG_STYLE[value].badge, justSaved && "ring-2 ring-emerald-400")}>{value}</Badge>
                ) : (
                  <span
                    className={cn(
                      "rounded-md border border-dashed border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-500",
                      justSaved && "ring-2 ring-emerald-400"
                    )}
                  >
                    + Flag
                  </span>
                )}
              </button>
            )}
          />
        </div>
        <InlineEditSelect
          value={row.ETAT}
          options={ETAT_OPTIONS}
          label="État"
          onCommit={commitField("ETAT")}
          renderTrigger={({ value, pending, justSaved, onOpen }: InlineEditTriggerState) => (
            <button
              type="button"
              onClick={onOpen}
              disabled={pending}
              className={cn(
                "flex min-h-8 flex-shrink-0 items-center rounded px-2 py-1 text-[9px] font-bold uppercase transition disabled:opacity-60",
                value?.toUpperCase() === "EXTERNE" ? "bg-blue-500/10 text-blue-400" : "bg-amber-500/10 text-amber-400",
                justSaved && "ring-2 ring-emerald-400"
              )}
            >
              {value || "—"}
            </button>
          )}
        />
      </div>

      {(row.client || row.modele) && (
        <div className="mb-2 truncate text-xs text-zinc-400">{[row.client, row.modele].filter(Boolean).join(" · ")}</div>
      )}

      <div className="flex flex-col gap-2">
        <InlineEditSelect
          value={row["Catégorie"]}
          options={CATEGORIE_OPTIONS}
          label="Catégorie"
          onCommit={commitField("Catégorie")}
          renderTrigger={(state) => (
            <FieldRowTrigger label="Catégorie" placeholder="— Choisir —" {...state} />
          )}
        />
        <InlineEditSelect
          value={row.Technicien}
          options={TECHNICIEN_OPTIONS}
          label="Technicien"
          onCommit={commitField("Technicien")}
          renderTrigger={(state) => (
            <FieldRowTrigger label="Technicien" placeholder="— Choisir —" {...state} />
          )}
        />
        <InlineEditCombobox
          value={row.prestataire}
          options={PRESTATAIRE_OPTIONS}
          onCommit={commitField("prestataire")}
          placeholder="Prestataire…"
          renderTrigger={(state) => (
            <FieldRowTrigger label="Prestataire" placeholder="— Aucun —" dot={dot} {...state} />
          )}
        />
        <InlineEditText
          value={row.commentaire}
          resyncDeps={[row._row, row.commentaire]}
          onCommit={commitField("commentaire")}
          placeholder="Commentaire…"
        />
      </div>

      {populatedReadonly.length > 0 && (
        <div className="mt-2 flex flex-col gap-1 border-t border-zinc-800/60 pt-2">
          {populatedReadonly.map((h) => (
            <div key={h} className="whitespace-pre-line text-[11px] leading-snug text-zinc-500">
              <span className="mr-1 text-[9px] font-bold uppercase text-zinc-600">{h}:</span>
              {String(row[h])}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

type Fleet = "TOUS" | "INTERNE" | "EXTERNE";

const EMPTY_ROWS: BddRow[] = [];

export default function SuiviRlPage() {
  const rowsQuery = useBddRows();

  const rows = rowsQuery.data ?? EMPTY_ROWS;
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeFleet, setActiveFleet] = useState<Fleet>("INTERNE");

  const fleetFiltered = useMemo(() => {
    if (activeFleet === "TOUS") {
      return rows.filter((r) => r.ETAT?.toUpperCase() === "INTERNE" || r.ETAT?.toUpperCase() === "EXTERNE");
    }
    return rows.filter((r) => r.ETAT?.toUpperCase() === activeFleet);
  }, [rows, activeFleet]);

  // Plate-only search, standardized on the same shared autocomplete pattern
  // as Parking/Atelier — client/modele/prestataire/commentaire free-text
  // matching was removed by explicit product decision.
  const immList = useMemo(
    () => [...new Set(fleetFiltered.map((r) => r.IMM).filter(Boolean))],
    [fleetFiltered]
  );
  const { suggestions } = usePlateAutocomplete(search, immList);

  const searched = useMemo(() => {
    const term = search.trim().toUpperCase();
    if (!term) return fleetFiltered;
    return fleetFiltered.filter((r) => String(r.IMM ?? "").toUpperCase().includes(term));
  }, [fleetFiltered, search]);

  function selectFleet(f: Fleet) {
    setActiveFleet(f);
  }

  // Original page only surfaced fetch errors when it had nothing cached to
  // show (fetchFresh(silent=false) on a cold load); a background refresh
  // failing while stale cached rows were already on screen stayed silent.
  // Mirrored here by only showing the banner when there are no rows to show.
  const displayError = rows.length === 0 && rowsQuery.error instanceof Error ? rowsQuery.error.message : "";
  const updatedLabel = rowsQuery.dataUpdatedAt
    ? `${rowsQuery.isFetching ? "cache · " : ""}${formatAge(rowsQuery.dataUpdatedAt)}`
    : "";

  return (
    <div className="min-h-screen bg-black text-zinc-50">
      <ListPageHeader
        title="AVIS"
        subtitle="Suivi RL"
        accentClassName="text-amber-400"
        countClassName="border-amber-500/20 bg-amber-500/10 text-amber-400"
        count={searched.length}
        onRefresh={() => rowsQuery.refetch()}
      >
        <Combobox
          value={search}
          onValueChange={(v) => { setSearch(v); setSearchOpen(true); }}
          open={searchOpen}
          onOpenChange={setSearchOpen}
          options={suggestions}
          onSelect={(imm) => { setSearch(imm); setSearchOpen(false); }}
          placeholder="Rechercher par immatriculation…"
          inputMode="numeric"
        />

        <div className="mt-2 flex items-center gap-1.5 overflow-x-auto">
          <span className="mr-1 flex-shrink-0 text-[9px] font-bold uppercase text-zinc-500">Flotte</span>
          <ToggleGroup
            type="single"
            value={activeFleet}
            onValueChange={(v) => v && selectFleet(v as Fleet)}
          >
            {(["TOUS", "INTERNE", "EXTERNE"] as const).map((f) => (
              <ToggleGroupItem key={f} value={f}>
                {f}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </ListPageHeader>

      <div className="px-3 py-3">
        {displayError && (
          <div className="mb-3 rounded-lg border border-red-900/40 bg-red-950/30 px-3 py-2 text-sm text-red-300">
            {displayError}
          </div>
        )}

        {rowsQuery.isPending && (
          <div className="py-16 text-center text-sm text-zinc-500">Chargement…</div>
        )}

        {!rowsQuery.isPending && searched.length === 0 && !displayError && (
          <div className="py-16 text-center text-sm text-zinc-500">Aucun véhicule</div>
        )}

        <div className="flex flex-col gap-2">
          {searched.map((row) => (
            <BddCard key={row._row} row={row} />
          ))}
        </div>

        {updatedLabel && <div className="mt-4 text-center font-mono text-[9px] text-zinc-600">Sync: {updatedLabel}</div>}
      </div>
    </div>
  );
}
