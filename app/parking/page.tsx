"use client";

import { useState } from "react";
import type { ParkingRow, ParkingAddResultItem } from "@/lib/types";
import { ListPageHeader } from "@/components/fleet/ListPageHeader";
import { PlateSearchInput } from "@/components/fleet/PlateSearchInput";
import { PlateFilterInput } from "@/components/fleet/PlateFilterInput";
import { AddResultsList } from "@/components/fleet/AddResultsList";
import { RecordCard } from "@/components/fleet/RecordCard";
import { Field } from "@/components/fleet/Field";
import { Input } from "@/components/ui/input";
import { useEditableState } from "@/hooks/useEditableState";
import {
  useParkingRows,
  useParkingImmList,
  useAddParkingPlates,
  useUpdateParkingAction,
  useDeleteParkingRow,
  useClearParkingAll,
} from "@/hooks/useParkingRows";

// ─── Parking card (per row) ────────────────────────────────────────────────

function ParkingCard({
  row,
  onActionCommit,
  onDelete,
}: {
  row: ParkingRow;
  onActionCommit: (rowIndex: number, action: string) => void;
  onDelete: (rowIndex: number) => void;
}) {
  const [action, setAction] = useEditableState(row.action, [row.rowIndex, row.action, row.timestamp]);

  return (
    <RecordCard
      imm={row.imm}
      subtitle={[row.marque, row.model].filter(Boolean).join(" ") + (row.client ? ` | ${row.client}` : "")}
      timestamp={row.timestamp}
      onDelete={() => onDelete(row.rowIndex)}
      deleteTitle="Supprimer cette ligne ?"
    >
      <Field label="Action">
        <Input
          value={action}
          placeholder="Décrire l'action…"
          onChange={(e) => setAction(e.target.value)}
          onBlur={() => {
            if (action !== row.action) onActionCommit(row.rowIndex, action);
          }}
          className="h-auto py-2 text-[11px]"
        />
      </Field>
    </RecordCard>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function ParkingPage() {
  const rowsQuery = useParkingRows();
  const immListQuery = useParkingImmList();
  const addMutation = useAddParkingPlates();
  const actionMutation = useUpdateParkingAction();
  const deleteMutation = useDeleteParkingRow();
  const clearAllMutation = useClearParkingAll();

  const [search, setSearch] = useState("");
  const [rawInput, setRawInput] = useState("");
  const [error, setError] = useState("");
  const [addResults, setAddResults] = useState<ParkingAddResultItem[] | null>(null);

  const rows = rowsQuery.data ?? [];
  const immList = immListQuery.data ?? [];

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

  async function handleActionCommit(rowIndex: number, action: string) {
    try {
      await actionMutation.mutateAsync({ rowIndex, action });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    }
  }

  async function handleDelete(rowIndex: number) {
    try {
      await deleteMutation.mutateAsync(rowIndex);
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
    <div className="min-h-screen bg-black text-zinc-50">
      <ListPageHeader
        title="PARKING"
        subtitle="AVIS Maroc"
        accentClassName="text-sky-400"
        countClassName="border-sky-500/20 bg-sky-500/10 text-sky-400"
        count={searched.length}
        onRefresh={() => rowsQuery.refetch()}
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
          <div className="mb-3 rounded-lg border border-red-900/40 bg-red-950/30 px-3 py-2 text-sm text-red-300">
            {displayError}
          </div>
        )}

        {rowsQuery.isPending && (
          <div className="py-16 text-center text-sm text-zinc-500">Chargement…</div>
        )}

        {!rowsQuery.isPending && searched.length === 0 && !displayError && (
          <div className="py-16 text-center text-sm text-zinc-500">Aucun véhicule en parking</div>
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
