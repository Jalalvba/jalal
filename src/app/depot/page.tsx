"use client";

import { useDeferredValue, useMemo, useState } from "react";
import type { DepotRow, ParkingAddResultItem } from "@/types";
import { ZONE_COLORS } from "@/config/zones";
import { ListPageHeader } from "@/components/fleet/ListPageHeader";
import { LoadingSkeleton } from "@/components/fleet/LoadingSkeleton";
import { PlateSearchInput } from "@/components/fleet/PlateSearchInput";
import { PlateFilterInput } from "@/components/fleet/PlateFilterInput";
import { AddResultsList } from "@/components/fleet/AddResultsList";
import { RecordCard } from "@/components/fleet/RecordCard";
import { GeminiSummaryBlock } from "@/components/fleet/GeminiSummaryBlock";
import { ReadonlyFieldList } from "@/components/fleet/ReadonlyFieldList";
import { Field } from "@/components/fleet/Field";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { useEditableState } from "@/hooks/useEditableState";
import { useVehicleSuggestionList } from "@/hooks/useVehicleSuggestionList";
import { useStableRowOrder } from "@/hooks/useStableRowOrder";
import {
  useDepotRows,
  useAddDepotPlates,
  useUpdateDepotAction,
  useDeleteDepotRow,
  useClearDepotAll,
  useRefreshDepotRows,
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
      {/* Summary + its button. Looked up from BDD by plate — this tab has
          no gemini column of its own. The reference fields are nested so the
          card has ONE detail toggle rather than a control per section. */}
      <GeminiSummaryBlock imm={row.imm} className="mt-2">
        <ReadonlyFieldList fields={READONLY_FIELDS.map((f) => ({ label: f.label, value: row[f.key] }))} />
      </GeminiSummaryBlock>
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
  const refreshMutation = useRefreshDepotRows();

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

  // Rendered at lower priority than the keystroke that changed it — same
  // reasoning as Suivi RL's: this page renders one dense card per vehicle (84
  // live today), and re-rendering them all inside the keystroke's own commit
  // is what made typing feel late. Only the render is deferred; `searched`
  // itself is still computed synchronously.
  const deferredRows = useDeferredValue(searched);


  const displayError = error || (rowsQuery.error instanceof Error ? rowsQuery.error.message : "");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ListPageHeader
        title="DEPOT"
        subtitle="AVIS Maroc"
        accentClassName={ZONE_COLORS.depot.accentText}
        countClassName={ZONE_COLORS.depot.count}
        count={searched.length}
        onRefresh={async () => {
          await refreshMutation.mutateAsync();
          setOrderResetToken((t) => t + 1);
        }}
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

        {rowsQuery.isPending && <LoadingSkeleton />}

        {!rowsQuery.isPending && searched.length === 0 && !displayError && (
          <div className="py-16 text-center text-sm text-muted-foreground">Aucun véhicule au dépôt</div>
        )}

        <div className="flex flex-col gap-2.5">
          {deferredRows.map((row) => (
            <DepotCard key={row.rowIndex} row={row} onActionCommit={handleActionCommit} onDelete={handleDelete} />
          ))}
        </div>
      </div>
    </div>
  );
}
