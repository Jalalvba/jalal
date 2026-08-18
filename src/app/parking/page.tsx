"use client";

import { useMemo, useState } from "react";
import type { ParkingRow, ParkingAddResultItem } from "@/types";
import { ZONE_COLORS } from "@/config/zones";
import { ListPageHeader } from "@/components/fleet/ListPageHeader";
import { LoadingSkeleton } from "@/components/fleet/LoadingSkeleton";
import { PlateSearchInput } from "@/components/fleet/PlateSearchInput";
import { PlateFilterInput } from "@/components/fleet/PlateFilterInput";
import { AddResultsList } from "@/components/fleet/AddResultsList";
import { RecordCard } from "@/components/fleet/RecordCard";
import { ReadonlyFieldList } from "@/components/fleet/ReadonlyFieldList";
import { Field } from "@/components/fleet/Field";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { useEditableState } from "@/hooks/useEditableState";
import {
  useParkingRows,
  useAddParkingPlates,
  useUpdateParkingAction,
  useDeleteParkingRow,
  useClearParkingAll,
  useRefreshParkingRows,
} from "@/hooks/useParkingRows";
import { useVehicleSuggestionList } from "@/hooks/useVehicleSuggestionList";
import { useStableRowOrder } from "@/hooks/useStableRowOrder";

// ─── Read-only reference fields — the 9 sheet-side XLOOKUP columns, exact
// header spelling (TECHNICEIN/FOUNISSEUR are sic, matching the real sheet) ──

const READONLY_FIELDS: { key: keyof Pick<ParkingRow, "rlReunion" | "motif" | "etatVehicule" | "bdd" | "dateDs" | "ds" | "parts" | "technicein" | "founisseur">; label: string }[] = [
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

// ─── Parking card (per row) ────────────────────────────────────────────────

function ParkingCard({
  row,
  onActionCommit,
  onDelete,
}: {
  row: ParkingRow;
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

export default function ParkingPage() {
  const rowsQuery = useParkingRows();
  const vehicleSuggestionsQuery = useVehicleSuggestionList();
  const addMutation = useAddParkingPlates();
  const actionMutation = useUpdateParkingAction();
  const deleteMutation = useDeleteParkingRow();
  const clearAllMutation = useClearParkingAll();
  const refreshMutation = useRefreshParkingRows();

  const [search, setSearch] = useState("");
  const [rawInput, setRawInput] = useState("");
  const [error, setError] = useState("");
  const [addResults, setAddResults] = useState<ParkingAddResultItem[] | null>(null);
  // Bumped only by the hard-refresh button below — re-adopts the server's
  // canonical (TIMESTAMP-sorted) order at that point; a plain field-edit
  // refetch leaves this unchanged, see useStableRowOrder()'s own comment.
  const [orderResetToken, setOrderResetToken] = useState(0);

  const rawRows = rowsQuery.data ?? [];
  const rows = useStableRowOrder(rawRows, (r) => r.imm, orderResetToken);
  // usePlateAutocomplete (inside PlateSearchInput) only needs bare plate
  // strings — derived client-side from the one shared full parc+cp fetch,
  // no separate network call.
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
        title="PARKING"
        subtitle="AVIS Maroc"
        accentClassName={ZONE_COLORS.parking.accentText}
        countClassName={ZONE_COLORS.parking.count}
        count={searched.length}
        onRefresh={async () => {
          await refreshMutation.mutateAsync();
          setOrderResetToken((t) => t + 1);
        }}
        onClearAll={handleClearAll}
        clearAllTitle="Vider tout le Parking ?"
      >
        <PlateSearchInput
          value={rawInput}
          onChange={setRawInput}
          immList={immList}
          onSubmit={submitIMMs}
          submitting={addMutation.isPending}
          accentBorderClassName="border-sky-600/60 focus:border-sky-500"
          accentButtonClassName="bg-sky-600 hover:bg-sky-500"
        />

        {addResults && <AddResultsList results={addResults} />}

        <PlateFilterInput value={search} onChange={setSearch} />
      </ListPageHeader>

      <div className="px-3 py-3">
        {displayError && (
          <Alert className="mb-3">{displayError}</Alert>
        )}

        {rowsQuery.isPending && <LoadingSkeleton />}

        {!rowsQuery.isPending && searched.length === 0 && !displayError && (
          <div className="py-16 text-center text-sm text-muted-foreground">Aucun véhicule en parking</div>
        )}

        <div className="flex flex-col gap-2.5">
          {searched.map((row) => (
            <ParkingCard key={row.rowIndex} row={row} onActionCommit={handleActionCommit} onDelete={handleDelete} />
          ))}
        </div>
      </div>
    </div>
  );
}
