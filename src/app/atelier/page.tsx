"use client";

import { useMemo, useState } from "react";
import type { AtelierRow, ParkingAddResultItem, AtelierEditableField } from "@/types";
import { ZONE_COLORS } from "@/config/zones";
import { useSheetFieldOptions } from "@/hooks/useSheetFieldOptions";
import { ListPageHeader } from "@/components/fleet/ListPageHeader";
import { LoadingSkeleton } from "@/components/fleet/LoadingSkeleton";
import { PlateSearchInput } from "@/components/fleet/PlateSearchInput";
import { PlateFilterInput } from "@/components/fleet/PlateFilterInput";
import { AddResultsList } from "@/components/fleet/AddResultsList";
import { RecordCard } from "@/components/fleet/RecordCard";
import { AnalyseAndSaveButton } from "@/components/fleet/AnalyseAndSaveButton";
import { ReadonlyFieldList } from "@/components/fleet/ReadonlyFieldList";
import { Field } from "@/components/fleet/Field";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useEditableState } from "@/hooks/useEditableState";
import { useVehicleSuggestionList } from "@/hooks/useVehicleSuggestionList";
import {
  useAtelierRows,
  useAddAtelierPlates,
  useUpdateAtelierField,
  useDeleteAtelierRow,
  useClearAtelierAll,
  useRefreshAtelierRows,
} from "@/hooks/useAtelierRows";
import { useStableRowOrder } from "@/hooks/useStableRowOrder";

// ─── CATEGORIE_OPTIONS and TECHNICIEN_OPTIONS are Mongo-backed now
// (src/lib/mongo/sheetFieldOptions.ts, admin-editable at /admin/config), loaded via
// useSheetFieldOptions() — shared with src/app/suivi-rl/page.tsx and
// src/app/ds-history/page.tsx through the same hook, one fetch either way. Used
// to be an independently hand-duplicated hardcoded copy here (CATEGORIE_OPTIONS
// had already drifted a stray typo out of sync with src/types/index.ts's static
// list before that was fixed, then briefly a shared static import, now
// config-driven). ──

const selectClass =
  "h-auto w-full rounded-lg border border-border bg-popover px-2 py-1.5 text-micro font-medium text-popover-foreground outline-none focus:border-amber-500";

// ─── Read-only reference fields — same 9 XLOOKUP columns as Parking, plus
// TECHNICEIN_DS (distinct from the editable TECHNICIEN above) ──────────────

const READONLY_FIELDS: { key: keyof Pick<AtelierRow, "rlReunion" | "motif" | "etatVehicule" | "bdd" | "dateDs" | "ds" | "parts" | "techniceinDs" | "founisseur">; label: string }[] = [
  { key: "rlReunion", label: "RL_REUNION" },
  { key: "motif", label: "MOTIF" },
  { key: "etatVehicule", label: "ETAT VÉHICULE" },
  { key: "bdd", label: "BDD" },
  { key: "dateDs", label: "DATE_DS" },
  { key: "ds", label: "DS" },
  { key: "parts", label: "PARTS" },
  { key: "techniceinDs", label: "TECHNICEIN_DS" },
  { key: "founisseur", label: "FOUNISSEUR" },
];

// ─── Atelier card (per row) ────────────────────────────────────────────────

function AtelierCard({
  row,
  onFieldCommit,
  onDelete,
}: {
  row: AtelierRow;
  onFieldCommit: (rowIndex: number, field: AtelierEditableField, value: string, imm: string) => void;
  onDelete: (rowIndex: number, imm: string) => void;
}) {
  const { options } = useSheetFieldOptions();
  const resyncDeps = [row.rowIndex, row.categorie, row.technicien, row.commentaire, row.besoinPiece, row.timestamp];
  const [categorie, setCategorie] = useEditableState(row.categorie, resyncDeps);
  const [technicien, setTechnicien] = useEditableState(row.technicien, resyncDeps);
  const [commentaire, setCommentaire] = useEditableState(row.commentaire, resyncDeps);
  const [besoinPiece, setBesoinPiece] = useEditableState(row.besoinPiece, resyncDeps);

  return (
    <RecordCard
      imm={row.imm}
      subtitle={[row.marque, row.model].filter(Boolean).join(" ") + (row.client ? ` | ${row.client}` : "")}
      timestamp={row.timestamp}
      headerRight={<AnalyseAndSaveButton imm={row.imm} />}
      onDelete={() => onDelete(row.rowIndex, row.imm)}
    >
      <div className="grid grid-cols-1 gap-2.5 text-micro sm:grid-cols-2">
        <Field label="Catégorie">
          <select
            value={categorie}
            onChange={(e) => {
              setCategorie(e.target.value);
              onFieldCommit(row.rowIndex, "CATÉGORIE", e.target.value, row.imm);
            }}
            className={selectClass}
          >
            <option value="">— Sélectionner —</option>
            {options.CATEGORIE_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Technicien">
          <select
            value={technicien}
            onChange={(e) => {
              setTechnicien(e.target.value);
              onFieldCommit(row.rowIndex, "TECHNICIEN", e.target.value, row.imm);
            }}
            className={selectClass}
          >
            <option value="">— Sélectionner —</option>
            {options.TECHNICIEN_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-2.5 text-micro sm:grid-cols-2">
        <Field label="Suivi (Commentaire)">
          <Input
            value={commentaire}
            placeholder="Taper le suivi…"
            onChange={(e) => setCommentaire(e.target.value)}
            onBlur={() => {
              if (commentaire !== row.commentaire) onFieldCommit(row.rowIndex, "COMMENTAIRE", commentaire, row.imm);
            }}
            className="h-auto py-1.5 text-micro focus:border-amber-500"
          />
        </Field>
        <Field label="Besoin Pièce">
          <Input
            value={besoinPiece}
            placeholder="Pièce requise…"
            onChange={(e) => setBesoinPiece(e.target.value)}
            onBlur={() => {
              if (besoinPiece !== row.besoinPiece) onFieldCommit(row.rowIndex, "BESOIN PIÈCE", besoinPiece, row.imm);
            }}
            className="h-auto py-1.5 text-micro focus:border-amber-500"
          />
        </Field>
      </div>

      <ReadonlyFieldList fields={READONLY_FIELDS.map((f) => ({ label: f.label, value: row[f.key] }))} />
    </RecordCard>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

const EMPTY_ROWS: AtelierRow[] = [];

// Sentinel for the Technicien filter chip row — distinct from "TOUS" (no
// filter, shows everything including blank-Technicien rows) and from any
// real technician name (which can never collide with this literal).
const UNASSIGNED_TECHNICIEN = "__UNASSIGNED__";

export default function AtelierPage() {
  const rowsQuery = useAtelierRows();
  const vehicleSuggestionsQuery = useVehicleSuggestionList(); // shared parc+cp plate universe, one fetch across all four plate-input pages
  const addMutation = useAddAtelierPlates();
  const fieldMutation = useUpdateAtelierField();
  const deleteMutation = useDeleteAtelierRow();
  const clearAllMutation = useClearAtelierAll();
  const refreshMutation = useRefreshAtelierRows();

  const [search, setSearch] = useState("");
  const [rawInput, setRawInput] = useState("");
  const [error, setError] = useState("");
  const [addResults, setAddResults] = useState<ParkingAddResultItem[] | null>(null);
  const [activeTechnicien, setActiveTechnicien] = useState("TOUS");
  // Bumped only by the hard-refresh button below — re-adopts the server's
  // canonical (TIMESTAMP-sorted) order at that point; a plain field-edit
  // refetch leaves this unchanged, see useStableRowOrder()'s own comment.
  const [orderResetToken, setOrderResetToken] = useState(0);

  const rawRows = rowsQuery.data ?? EMPTY_ROWS;
  const rows = useStableRowOrder(rawRows, (r) => r.imm, orderResetToken);
  const immList = useMemo(() => (vehicleSuggestionsQuery.data ?? []).map((v) => v.imm), [vehicleSuggestionsQuery.data]);

  // Distinct Technicien values actually present in the loaded rows, not the
  // fixed TECHNICIEN_OPTIONS roster used by the per-card assignment dropdown
  // above — a technician with no vehicles currently in Atelier shouldn't
  // clutter the filter chip row.
  const visibleTechniciens = useMemo(
    () => [...new Set(rows.map((r) => r.technicien).filter(Boolean))].sort(),
    [rows]
  );

  const technicienFiltered = useMemo(() => {
    if (activeTechnicien === "TOUS") return rows;
    if (activeTechnicien === UNASSIGNED_TECHNICIEN) return rows.filter((r) => !r.technicien?.trim());
    return rows.filter((r) => r.technicien === activeTechnicien);
  }, [rows, activeTechnicien]);

  async function submitIMMs() {
    const val = rawInput.trim();
    if (!val) return;
    setAddResults(null);
    try {
      const result = await addMutation.mutateAsync(val);
      setRawInput("");
      setAddResults(result.results);
      setTimeout(() => setAddResults(null), 8000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
      setTimeout(() => setError(""), 5000);
    }
  }

  async function handleFieldCommit(rowIndex: number, field: AtelierEditableField, value: string, imm: string) {
    try {
      await fieldMutation.mutateAsync({ rowIndex, field, value, imm });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    }
  }

  async function handleDelete(rowIndex: number, imm: string) {
    try {
      await deleteMutation.mutateAsync({ rowIndex, imm });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    }
  }

  async function handleClearAll() {
    try {
      await clearAllMutation.mutateAsync();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    }
  }

  // Plate search bypasses the Technicien chip entirely, same convention as
  // suivi-rl's Flotte/Emplacement/Prestataire/Flag chip cascade — chips are a
  // browsing filter, search is for finding one specific plate regardless of
  // which chip is currently active.
  const searched = (() => {
    const term = search.trim().toUpperCase();
    if (!term) return technicienFiltered;
    return rows.filter((r) => r.imm.includes(term));
  })();

  const displayError = error || (rowsQuery.error instanceof Error ? rowsQuery.error.message : "");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ListPageHeader
        title="🔧 ATELIER"
        subtitle="AVIS Maroc"
        accentClassName={ZONE_COLORS.atelier.accentText}
        countClassName={ZONE_COLORS.atelier.count}
        count={searched.length}
        onRefresh={async () => {
          await refreshMutation.mutateAsync();
          setOrderResetToken((t) => t + 1);
        }}
        onClearAll={handleClearAll}
        clearAllTitle="Vider l'atelier ?"
      >
        <PlateSearchInput
          value={rawInput}
          onChange={setRawInput}
          immList={immList}
          onSubmit={submitIMMs}
          submitting={addMutation.isPending}
          accentBorderClassName="border-amber-600/60 focus:border-amber-500"
          accentButtonClassName="bg-amber-600 hover:bg-amber-500"
        />

        {addResults && <AddResultsList results={addResults} />}

        <PlateFilterInput value={search} onChange={setSearch} />

        {rows.length > 0 && (
          <div className="mt-1.5 flex items-center gap-1.5 overflow-x-auto">
            <span className="mr-1 flex-shrink-0 text-micro font-bold uppercase text-muted-foreground">Technicien</span>
            <ToggleGroup
              type="single"
              value={activeTechnicien}
              onValueChange={(v) => v && setActiveTechnicien(v)}
            >
              <ToggleGroupItem value="TOUS">TOUS</ToggleGroupItem>
              <ToggleGroupItem value={UNASSIGNED_TECHNICIEN}>Non assigné</ToggleGroupItem>
              {visibleTechniciens.map((t) => (
                <ToggleGroupItem key={t} value={t}>
                  {t}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        )}
      </ListPageHeader>

      <div className="px-3 py-3">
        {displayError && (
          <Alert className="mb-3">{displayError}</Alert>
        )}

        {rowsQuery.isPending && <LoadingSkeleton />}

        {!rowsQuery.isPending && searched.length === 0 && !displayError && (
          <div className="py-16 text-center text-sm text-muted-foreground">Aucun véhicule en atelier</div>
        )}

        <div className="flex flex-col gap-2.5">
          {searched.map((row) => (
            <AtelierCard key={row.rowIndex} row={row} onFieldCommit={handleFieldCommit} onDelete={handleDelete} />
          ))}
        </div>
      </div>
    </div>
  );
}
