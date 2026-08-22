"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { toast } from "sonner";
import type { ParkingRow, ParkingAddResultItem } from "@/types";
import { ZONE_COLORS } from "@/config/zones";
import { ListPageHeader } from "@/components/fleet/ListPageHeader";
import { LoadingSkeleton } from "@/components/fleet/LoadingSkeleton";
import { PlateSearchInput } from "@/components/fleet/PlateSearchInput";
import { PlateFilterInput } from "@/components/fleet/PlateFilterInput";
import { AddResultsList } from "@/components/fleet/AddResultsList";
import { RecordCard } from "@/components/fleet/RecordCard";
import { GeminiSummaryBlock } from "@/components/fleet/GeminiSummaryBlock";
import { GenerateActionsButton } from "@/components/fleet/GenerateActionsButton";
import { ParkingRowAiButtons } from "@/components/fleet/ParkingRowAiButtons";
import { ReadonlyFieldList } from "@/components/fleet/ReadonlyFieldList";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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

// ─── Read-only reference fields — the sheet-side columns, exact header
// spelling (TECHNICEIN/FOUNISSEUR are sic, matching the real sheet). ZONING is
// the tab's own column, added to the live sheet 2026-08, and is also the
// page's chip filter. ──

const READONLY_FIELDS: { key: keyof Pick<ParkingRow, "rlReunion" | "motif" | "etatVehicule" | "bdd" | "dateDs" | "ds" | "zoning" | "parts" | "technicein" | "founisseur">; label: string }[] = [
  { key: "rlReunion", label: "RL_REUNION" },
  { key: "motif", label: "MOTIF" },
  { key: "etatVehicule", label: "ETAT VÉHICULE" },
  { key: "bdd", label: "BDD" },
  { key: "dateDs", label: "DATE_DS" },
  { key: "ds", label: "DS" },
  { key: "zoning", label: "ZONING" },
  { key: "parts", label: "PARTS" },
  { key: "technicein", label: "TECHNICEIN" },
  { key: "founisseur", label: "FOUNISSEUR" },
];

/**
 * Exports exactly what is on screen — the filtered, searched list — as a PDF.
 *
 * Seven columns (IMM, TIMESTAMP, ACTION, ZONING, MARQUE, MODEL, gemini), which
 * is why the report is landscape; see /api/parking/export. Sends only those
 * fields, String()-coerced: sheet cells do not honour their declared types (a
 * numeric MODEL comes through as a number, and one such row would fail the
 * route's strict row check and reject the WHOLE batch — the same footgun
 * 77f9eef fixed in the BDD export).
 */
async function downloadParkingPdf(
  rows: ParkingRow[],
  activeFilters: { label: string; value: string }[],
  searchTerm: string,
  setExporting: (v: boolean) => void
) {
  setExporting(true);
  try {
    const res = await fetch("/api/parking/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: rows.map((r) => ({
          imm: String(r.imm ?? ""),
          timestamp: String(r.timestamp ?? ""),
          action: String(r.action ?? ""),
          zoning: String(r.zoning ?? ""),
          marque: String(r.marque ?? ""),
          model: String(r.model ?? ""),
          gemini: String(r.gemini ?? ""),
        })),
        activeFilters,
        searchTerm: searchTerm || undefined,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error ?? `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const dateSlug = new Date().toISOString().slice(0, 10);
    const filterSlug = activeFilters
      .map((f) => f.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))
      .filter(Boolean)
      .join("-");
    a.download = `parking-${dateSlug}${filterSlug ? `-${filterSlug}` : ""}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    toast.error(`Erreur export PDF : ${e instanceof Error ? e.message : e}`);
  } finally {
    setExporting(false);
  }
}

// A value no real ZONING cell can hold, so it can share the single-select
// chip group with the real ones. Same device as Atelier's UNASSIGNED_TECHNICIEN.
const UNASSIGNED_ZONING = "__UNASSIGNED__";

// ─── Parking card (per row) ────────────────────────────────────────────────

function ParkingCard({
  row,
  onActionCommit,
  onDelete,
  onAiDone,
}: {
  row: ParkingRow;
  onActionCommit: (rowIndex: number, action: string, imm: string) => void;
  onDelete: (rowIndex: number, imm: string) => void;
  /** Refetch after an AI button wrote into this row's ACTION or gemini cell. */
  onAiDone: () => void;
}) {
  const [action, setAction] = useEditableState(row.action, [row.rowIndex, row.action, row.timestamp]);

  return (
    <RecordCard
      imm={row.imm}
      subtitle={[row.marque, row.model].filter(Boolean).join(" ") + (row.client ? ` | ${row.client}` : "")}
      timestamp={row.timestamp}
      // AVIS's own fleet is handled differently from a customer's vehicle
      // (it goes to the Pierre Parent garage after a part change), so it is
      // called out where the eye lands first, not buried in the field list.
      headerLeft={
        row.isAvis ? (
          <span className="rounded-full bg-amber-500 px-2 py-0.5 text-micro font-bold uppercase tracking-wide text-white shadow-sm dark:bg-amber-600">
            AVIS
          </span>
        ) : undefined
      }
      onDelete={() => onDelete(row.rowIndex, row.imm)}
      deleteTitle="Supprimer cette ligne ?"
    >
      {/* Both AI actions for this vehicle, together: one fills ACTION (the work
          order), the other fills gemini (the DS analysis). */}
      <div className="flex justify-end">
        <ParkingRowAiButtons
          imm={row.imm}
          hasAction={Boolean(String(row.action ?? "").trim())}
          hasSummary={Boolean(String(row.gemini ?? "").trim())}
          onDone={onAiDone}
        />
      </div>

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
      <ReadonlyFieldList
        fields={READONLY_FIELDS.map((f) => ({ label: f.label, value: String(row[f.key] ?? "") }))}
      />
      {/* This tab has its own gemini column, so the value is passed straight
          in — no BDD lookup, and it shows even for a vehicle with no BDD row. */}
      <GeminiSummaryBlock imm={row.imm} summary={row.gemini} className="mt-2" saveTo="parking" hideButton />
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
  const [activeZoning, setActiveZoning] = useState("TOUS");
  const [exportingPdf, setExportingPdf] = useState(false);
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

  // Distinct ZONING values actually present, so the chip row shows what the
  // tab holds rather than a fixed roster that drifts from it. Live today:
  // DISPONIBLE_À LIVERER (66), depot-ATV (8), depot-rempalcmemnt (6),
  // AVIS-PIERRE-PARENT (3).
  // String(... ?? "") throughout, NOT r.zoning.trim(): ParkingRow says
  // `zoning: string`, but that type describes the CURRENT server. Rows
  // restored from the persisted client cache were written before the column
  // existed and carry no `zoning` at all — which crashed this page on load
  // with "Cannot read properties of undefined (reading 'trim')". Same rule as
  // the rest of the app: a payload field is runtime-optional whatever its type
  // says (see docs/cross-cutting.md §8.1).
  const visibleZonings = useMemo(
    () => [...new Set(rows.map((r) => String(r.zoning ?? "").trim()).filter(Boolean))].sort(),
    [rows]
  );

  const zoningFiltered = useMemo(() => {
    if (activeZoning === "TOUS") return rows;
    // "Non assigné" is offered even when no row is currently unassigned: a
    // vehicle losing its zone is exactly what someone would come here to find,
    // and a chip that only appears once the problem exists cannot be used to
    // check for it.
    if (activeZoning === UNASSIGNED_ZONING) return rows.filter((r) => !String(r.zoning ?? "").trim());
    return rows.filter((r) => String(r.zoning ?? "").trim() === activeZoning);
  }, [rows, activeZoning]);

  // What the report's "Filtres actifs" line says. A search term bypasses the
  // chip (see below), so the chip is only reported when it is what actually
  // shaped the list.
  const activeFilters = useMemo(() => {
    if (search.trim() || activeZoning === "TOUS") return [];
    return [{ label: "Zoning", value: activeZoning === UNASSIGNED_ZONING ? "Non assigné" : activeZoning }];
  }, [search, activeZoning]);

  // Plate search bypasses the ZONING chip entirely — same convention as the
  // other list pages: chips browse, search finds one specific plate whatever
  // is currently selected.
  const searched = (() => {
    const term = search.trim().toUpperCase();
    if (!term) return zoningFiltered;
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

        {rows.length > 0 && (
          <div className="mt-1.5 flex items-center gap-1.5 overflow-x-auto">
            <span className="mr-1 flex-shrink-0 text-micro font-bold uppercase text-muted-foreground">
              Zoning
            </span>
            <ToggleGroup type="single" value={activeZoning} onValueChange={(v) => v && setActiveZoning(v)}>
              <ToggleGroupItem value="TOUS">TOUS</ToggleGroupItem>
              {/* Offered even when every row is currently assigned: a vehicle
                  losing its zone is exactly what someone would come here to
                  check, and a chip that only appears once the problem exists
                  cannot be used to look for it. */}
              <ToggleGroupItem value={UNASSIGNED_ZONING}>Non assigné</ToggleGroupItem>
              {visibleZonings.map((z) => (
                <ToggleGroupItem key={z} value={z}>
                  {z}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        )}

        {/* Acts on what is CURRENTLY listed, not on the whole tab: with a
            filter applied, "Actions IA" means "these vehicles", which is what
            the count next to it says. */}
        {/* Two columns, two questions. "Analyse DS" fills `gemini` (what the
            vehicle's history says); "Actions IA" fills `ACTION` (what the
            workshop should do). Both act on what is CURRENTLY listed, which is
            what the count beside the title says. */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => void downloadParkingPdf(searched, activeFilters, search.trim(), setExportingPdf)}
            disabled={searched.length === 0 || exportingPdf}
            title={searched.length === 0 ? "Aucune ligne à exporter" : "Exporter la liste filtrée en PDF"}
            className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-800/40 dark:bg-red-950/30 dark:text-red-400"
          >
            {exportingPdf ? "Génération…" : `Export PDF (${searched.length})`}
          </button>
          <GenerateActionsButton
            imms={searched.map((r) => r.imm)}
            variant="analyse"
            onDone={() => void refreshMutation.mutateAsync()}
          />
          <GenerateActionsButton
            imms={searched.map((r) => r.imm)}
            variant="actions"
            onDone={() => void refreshMutation.mutateAsync()}
          />
        </div>
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
          {deferredRows.map((row) => (
            <ParkingCard
              key={row.rowIndex}
              row={row}
              onActionCommit={handleActionCommit}
              onDelete={handleDelete}
              onAiDone={() => void refreshMutation.mutateAsync()}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
