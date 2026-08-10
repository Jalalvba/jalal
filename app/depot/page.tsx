"use client";

import { useMemo, useState } from "react";
import type { DepotRow, ParkingAddResultItem } from "@/lib/types";
import { ZONE_COLORS } from "@/lib/constants/zones";
import { ListPageHeader } from "@/components/fleet/ListPageHeader";
import { PlateSearchInput } from "@/components/fleet/PlateSearchInput";
import { PlateFilterInput } from "@/components/fleet/PlateFilterInput";
import { AddResultsList } from "@/components/fleet/AddResultsList";
import { RecordCard } from "@/components/fleet/RecordCard";
import { ReadonlyFieldList } from "@/components/fleet/ReadonlyFieldList";
import { Field } from "@/components/fleet/Field";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { useEditableState } from "@/hooks/useEditableState";
import { useVehicleSuggestionList } from "@/hooks/useVehicleSuggestionList";
import {
  useDepotRows,
  useAddDepotPlates,
  useUpdateDepotAction,
  useDeleteDepotRow,
  useClearDepotAll,
} from "@/hooks/useDepotRows";

// ─── Read-only reference fields — the 9 sheet-side XLOOKUP columns, exact
// header spelling (TECHNICEIN/FOUNISSEUR are sic, matching the real sheet,
// same as Parking's — confirmed byte-for-byte identical formulas) ──────────

const READONLY_FIELDS: { key: keyof Pick<DepotRow, "rlReunion" | "motif" | "etatVehicule" | "bdd" | "dateDs" | "ds" | "parts" | "technicein" | "founisseur">; label: string }[] = [
  { key: "rlReunion", label: "RL_REUNION" },
  { key: "motif", label: "MOTIF" },
  { key: "etatVehicule", label: "ETAT VÉHICULE" },
  { key: "bdd", label: "BDD" },
  { key: "dateDs", label: "DATE_DS" },
  { key: "ds", label: "DS" },
  { key: "parts", label: "PARTS" },
  { key: "technicein", label: "TECHNICEIN" },
  { key: "founisseur", label: "FOUNISSEUR" },
];

// ─── Depot card (per row) ───────────────────────────────────────────────────

function DepotCard({
  row,
  onActionCommit,
  onDelete,
}: {
  row: DepotRow;
  onActionCommit: (rowIndex: number, action: string, imm: string) => void;
  onDelete: (rowIndex: number, imm: string) => void;
}) {
  const [action, setAction] = useEditableState(row.action, [row.rowIndex, row.action, row.timestamp]);

  return (
    <RecordCard
      imm={row.imm}
      subtitle={[row.marque, row.model].filter(Boolean).join(" ") + (row.client ? ` | ${row.client}` : "")}
      timestamp={row.timestamp}
      onDelete={() => onDelete(row.rowIndex, row.imm)}
      deleteTitle="Supprimer cette ligne ?"
    >
      <Field label="Action">
        <Input
          value={action}
          placeholder="Décrire l'action…"
          onChange={(e) => setAction(e.target.value)}
          onBlur={() => {
            if (action !== row.action) onActionCommit(row.rowIndex, action, row.imm);
          }}
          className="h-auto py-2 text-micro"
        />
      </Field>
      <ReadonlyFieldList fields={READONLY_FIELDS.map((f) => ({ label: f.label, value: row[f.key] }))} />
    </RecordCard>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function DepotPage() {
  const rowsQuery = useDepotRows();
  const vehicleSuggestionsQuery = useVehicleSuggestionList(); // shared parc+cp plate universe, one fetch across all four plate-input pages
  const addMutation = useAddDepotPlates();
  const actionMutation = useUpdateDepotAction();
  const deleteMutation = useDeleteDepotRow();
  const clearAllMutation = useClearDepotAll();

  const [search, setSearch] = useState("");
  const [rawInput, setRawInput] = useState("");
  const [error, setError] = useState("");
  const [addResults, setAddResults] = useState<ParkingAddResultItem[] | null>(null);

  const rows = rowsQuery.data ?? [];
  const immList = useMemo(() => (vehicleSuggestionsQuery.data ?? []).map((v) => v.imm), [vehicleSuggestionsQuery.data]);

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

  async function handleActionCommit(rowIndex: number, action: string, imm: string) {
    try {
      await actionMutation.mutateAsync({ rowIndex, action, imm });
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

  const searched = (() => {
    const term = search.trim().toUpperCase();
    if (!term) return rows;
    return rows.filter((r) => r.imm.includes(term));
  })();

  const displayError = error || (rowsQuery.error instanceof Error ? rowsQuery.error.message : "");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ListPageHeader
        title="DEPOT"
        subtitle="AVIS Maroc"
        accentClassName={ZONE_COLORS.depot.accentText}
        countClassName={ZONE_COLORS.depot.count}
        count={searched.length}
        onRefresh={() => rowsQuery.refetch()}
        onClearAll={handleClearAll}
        clearAllTitle="Vider tout le Dépôt ?"
      >
        <PlateSearchInput
          value={rawInput}
          onChange={setRawInput}
          immList={immList}
          onSubmit={submitIMMs}
          submitting={addMutation.isPending}
          accentBorderClassName="border-lime-600/60 focus:border-lime-500"
          accentButtonClassName="bg-lime-600 hover:bg-lime-500"
        />

        {addResults && <AddResultsList results={addResults} />}

        <PlateFilterInput value={search} onChange={setSearch} />
      </ListPageHeader>

      <div className="px-3 py-3">
        {displayError && (
          <Alert className="mb-3">{displayError}</Alert>
        )}

        {rowsQuery.isPending && (
          <div className="py-16 text-center text-sm text-muted-foreground">Chargement…</div>
        )}

        {!rowsQuery.isPending && searched.length === 0 && !displayError && (
          <div className="py-16 text-center text-sm text-muted-foreground">Aucun véhicule au dépôt</div>
        )}

        <div className="flex flex-col gap-2.5">
          {searched.map((row) => (
            <DepotCard key={row.rowIndex} row={row} onActionCommit={handleActionCommit} onDelete={handleDelete} />
          ))}
        </div>
      </div>
    </div>
  );
}
