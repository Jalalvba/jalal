"use client";

import { useMemo, useState } from "react";
import { BDD_HEADERS, type BddRow } from "@/lib/types";
import { ListPageHeader } from "@/components/fleet/ListPageHeader";
import { Field } from "@/components/fleet/Field";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useEditableState } from "@/hooks/useEditableState";
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

// ─── Edit form ──────────────────────────────────────────────────────────────

type EditableValues = {
  ETAT: string;
  prestataire: string;
  flag: string;
  "Catégorie": string;
  commentaire: string;
  Technicien: string;
};

function editableValuesFromRow(row: BddRow): EditableValues {
  return {
    ETAT: row.ETAT ?? "",
    prestataire: row.prestataire ?? "",
    flag: row.flag ?? "",
    "Catégorie": row["Catégorie"] ?? "",
    commentaire: row.commentaire ?? "",
    Technicien: row.Technicien ?? "",
  };
}

const fieldControlClass =
  "h-auto w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-amber-500";

const DISPLAY_HEADERS = BDD_HEADERS.filter(
  (h) => h !== "IMM" && h !== "date" && h !== "prestataire" && h !== "flag" && h !== "ETAT"
);

function BddCard({
  row,
  expanded,
  onToggleExpand,
  onSaved,
}: {
  row: BddRow;
  expanded: boolean;
  onToggleExpand: () => void;
  onSaved: (updatedFields: EditableValues) => void;
}) {
  const [form, setForm] = useEditableState(editableValuesFromRow(row), [row, expanded]);
  const updateMutation = useUpdateBddRow();
  const [saveMsg, setSaveMsg] = useState("");

  const flagStyle = FLAG_STYLE[row.flag] ?? null;
  const dot = prestataireDotClass(row.prestataire);

  async function handleSave() {
    setSaveMsg("");
    try {
      await updateMutation.mutateAsync({ row: row._row, updates: form });
      onSaved(form);
      setSaveMsg("✓ Enregistré");
      setTimeout(() => setSaveMsg(""), 2000);
    } catch (e) {
      setSaveMsg(`❌ ${e instanceof Error ? e.message : "Erreur réseau"}`);
    }
  }

  return (
    <Card className={flagStyle ? `border-l-4 ${flagStyle.border}` : ""}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold text-amber-400">{row.IMM}</span>
          {(row.date || row.prestataire) && (
            <span className="font-mono text-xs text-zinc-500">
              {[row.date, row.prestataire].filter(Boolean).join(" · ")}
            </span>
          )}
          {row.flag && flagStyle && <Badge className={flagStyle.badge}>{row.flag}</Badge>}
        </div>
        <span
          className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
            row.ETAT?.toUpperCase() === "EXTERNE" ? "bg-blue-500/10 text-blue-400" : "bg-amber-500/10 text-amber-400"
          }`}
        >
          {row.ETAT || "—"}
        </span>
      </div>

      <div className="mb-2 flex flex-col gap-1">
        {DISPLAY_HEADERS.map((h) => {
          const val = row[h];
          const str = val == null ? "" : String(val);
          if (!str.trim()) return null;
          return (
            <div key={h} className="whitespace-pre-line text-xs leading-snug text-zinc-300">
              <span className="mr-1 text-[9px] font-bold uppercase text-zinc-500">{h}:</span>
              {str}
            </div>
          );
        })}
      </div>

      {row.prestataire && (
        <div className="mb-2 flex items-center gap-1.5 text-xs text-zinc-400">
          {dot && <span className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${dot}`} />}
          {row.prestataire}
        </div>
      )}

      <Button type="button" variant="secondary" size="sm" onClick={onToggleExpand}>
        {expanded ? "✕ Fermer" : "✎ Modifier"}
      </Button>

      {expanded && (
        <div className="mt-3 flex flex-col gap-2 border-t border-dashed border-zinc-800 pt-3">
          <Field label="État">
            <select
              value={form.ETAT}
              onChange={(e) => setForm({ ...form, ETAT: e.target.value })}
              className={fieldControlClass}
            >
              <option value="">— Aucun —</option>
              {ETAT_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Prestataire">
            <Input
              list="prestataire-options"
              value={form.prestataire}
              onChange={(e) => setForm({ ...form, prestataire: e.target.value })}
              className="h-auto bg-zinc-800 py-1.5 text-xs focus:border-amber-500"
            />
            <datalist id="prestataire-options">
              {PRESTATAIRE_OPTIONS.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </Field>

          <Field label="Flag">
            <select
              value={form.flag}
              onChange={(e) => setForm({ ...form, flag: e.target.value })}
              className={fieldControlClass}
            >
              <option value="">— Aucun —</option>
              {FLAG_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Catégorie">
            <select
              value={form["Catégorie"]}
              onChange={(e) => setForm({ ...form, "Catégorie": e.target.value })}
              className={fieldControlClass}
            >
              <option value="">— Aucun —</option>
              {CATEGORIE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Technicien">
            <select
              value={form.Technicien}
              onChange={(e) => setForm({ ...form, Technicien: e.target.value })}
              className={fieldControlClass}
            >
              <option value="">— Aucun —</option>
              {TECHNICIEN_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Commentaire">
            <textarea
              value={form.commentaire}
              onChange={(e) => setForm({ ...form, commentaire: e.target.value })}
              className={`${fieldControlClass} min-h-[60px] resize-none`}
            />
          </Field>

          <div className="mt-1 flex items-center gap-2">
            <Button
              type="button"
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className="h-10 flex-1 bg-amber-500 text-xs font-bold text-zinc-950 hover:bg-amber-400"
            >
              {updateMutation.isPending ? "Enregistrement…" : "Enregistrer"}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={onToggleExpand}>
              Annuler
            </Button>
          </div>
          {saveMsg && <div className="mt-1 text-xs">{saveMsg}</div>}
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
  const applyOptimisticUpdate = useOptimisticBddUpdate();

  const rows = rowsQuery.data ?? EMPTY_ROWS;
  const [search, setSearch] = useState("");
  const [activeFleet, setActiveFleet] = useState<Fleet>("INTERNE");
  const [activePrestataire, setActivePrestataire] = useState("TOUS");
  const [activeFlag, setActiveFlag] = useState("TOUS");
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  function toggleExpand(rowNum: number) {
    setExpandedRows((prev) => {
      const n = new Set(prev);
      if (n.has(rowNum)) n.delete(rowNum);
      else n.add(rowNum);
      return n;
    });
  }

  function handleRowSaved(rowNum: number, updatedFields: EditableValues) {
    applyOptimisticUpdate(rowNum, updatedFields);
  }

  const fleetFiltered = useMemo(() => {
    if (activeFleet === "TOUS") {
      return rows.filter((r) => r.ETAT?.toUpperCase() === "INTERNE" || r.ETAT?.toUpperCase() === "EXTERNE");
    }
    return rows.filter((r) => r.ETAT?.toUpperCase() === activeFleet);
  }, [rows, activeFleet]);

  const visiblePrestataires = useMemo(
    () => [...new Set(fleetFiltered.map((r) => r.prestataire).filter(Boolean))].sort(),
    [fleetFiltered]
  );

  const prestataireFiltered = useMemo(
    () => (activePrestataire === "TOUS" ? fleetFiltered : fleetFiltered.filter((r) => r.prestataire === activePrestataire)),
    [fleetFiltered, activePrestataire]
  );

  const visibleFlags = useMemo(
    () => [...new Set(prestataireFiltered.map((r) => r.flag).filter(Boolean))].sort(),
    [prestataireFiltered]
  );

  const flagFiltered = useMemo(
    () => (activeFlag === "TOUS" ? prestataireFiltered : prestataireFiltered.filter((r) => r.flag === activeFlag)),
    [prestataireFiltered, activeFlag]
  );

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return flagFiltered;
    return flagFiltered.filter((r) => BDD_HEADERS.some((h) => String(r[h] ?? "").toLowerCase().includes(q)));
  }, [flagFiltered, search]);

  function selectFleet(f: Fleet) {
    setActiveFleet(f);
    setActivePrestataire("TOUS");
    setActiveFlag("TOUS");
  }
  function selectPrestataire(p: string) {
    setActivePrestataire(p);
    setActiveFlag("TOUS");
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
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Recherche globale…"
          className="bg-zinc-900"
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
        <div className="mt-1.5 flex items-center gap-1.5 overflow-x-auto">
          <ToggleGroup
            type="single"
            value={activePrestataire}
            onValueChange={(v) => v && selectPrestataire(v)}
          >
            <ToggleGroupItem value="TOUS">TOUS</ToggleGroupItem>
            {visiblePrestataires.map((p) => (
              <ToggleGroupItem key={p} value={p}>
                {p}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        {visibleFlags.length > 0 && (
          <div className="mt-1.5 flex items-center gap-1.5 overflow-x-auto">
            <ToggleGroup
              type="single"
              value={activeFlag}
              onValueChange={(v) => v && setActiveFlag(v)}
            >
              <ToggleGroupItem value="TOUS">TOUS</ToggleGroupItem>
              {visibleFlags.map((f) => (
                <ToggleGroupItem key={f} value={f}>
                  {f}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        )}
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
            <BddCard
              key={row._row}
              row={row}
              expanded={expandedRows.has(row._row)}
              onToggleExpand={() => toggleExpand(row._row)}
              onSaved={(updated) => handleRowSaved(row._row, updated)}
            />
          ))}
        </div>

        {updatedLabel && <div className="mt-4 text-center font-mono text-[9px] text-zinc-600">Sync: {updatedLabel}</div>}
      </div>
    </div>
  );
}
