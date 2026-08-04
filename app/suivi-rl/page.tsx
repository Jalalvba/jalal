"use client";

import { useMemo, useState } from "react";
import {
  BDD_HEADERS,
  BDD_ZONE_DETECTION_HEADERS,
  FLAG_STYLE,
  ETAT_OPTIONS,
  FLAG_OPTIONS,
  CATEGORIE_OPTIONS,
  TECHNICIEN_OPTIONS,
  PRESTATAIRE_OPTIONS,
  EMPLACEMENT_OPTIONS,
  prestataireDotClass,
  type BddRow,
} from "@/lib/types";
import { ZONE_COLORS } from "@/lib/constants/zones";
import { ListPageHeader } from "@/components/fleet/ListPageHeader";
import { RecordCard } from "@/components/fleet/RecordCard";
import { ReadonlyFieldList } from "@/components/fleet/ReadonlyFieldList";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { usePlateAutocomplete } from "@/hooks/usePlateAutocomplete";
import { InlineEditSelect, type InlineEditTriggerState } from "@/components/fleet/InlineEditSelect";
import { InlineEditText } from "@/components/fleet/InlineEditText";
import { InlineEditCombobox } from "@/components/fleet/InlineEditCombobox";
import { FieldRowTrigger } from "@/components/fleet/FieldRowTrigger";
import { cn } from "@/components/ui/utils";
import { useBddRows, useUpdateBddRow, useOptimisticBddUpdate, useDeleteBddRow } from "@/hooks/useBddRows";
import { useVehicleZone } from "@/hooks/useVehicleZone";
import { ZoneBadges } from "@/components/fleet/ZoneBadges";

function formatAge(dataUpdatedAt: number): string {
  if (!dataUpdatedAt) return "";
  const minutes = Math.round((Date.now() - dataUpdatedAt) / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes}m`;
  return `il y a ${Math.floor(minutes / 60)}h`;
}

// Server allowlist (lib/types.ts's BDD_EDITABLE_FIELDS) is unchanged — this
// page just commits one of these keys at a time now instead of bundling
// all of them into one form submit.
type FieldKey = "ETAT" | "prestataire" | "flag" | "Emplacement" | "Catégorie" | "commentaire" | "Technicien";

// Everything shown once, either as one of the always-visible editable rows
// below or promoted into the client/modele subtitle — the remainder is
// read-only reference data, rendered dimmer/unlabeled-background to read as
// clearly non-interactive. ATELIER/DEPOT/PARKING (BDD_ZONE_DETECTION_HEADERS)
// are excluded here too — they get their own separately-labeled section
// below rather than being folded into this generic list, since they're a
// distinct signal (automated) from everything else in here (manual/static).
const READONLY_HEADERS = BDD_HEADERS.filter(
  (h) =>
    h !== "IMM" &&
    h !== "date" &&
    h !== "client" &&
    h !== "modele" &&
    h !== "ETAT" &&
    h !== "prestataire" &&
    h !== "flag" &&
    h !== "Emplacement" &&
    h !== "commentaire" &&
    h !== "Catégorie" &&
    h !== "Technicien" &&
    !(BDD_ZONE_DETECTION_HEADERS as readonly string[]).includes(h)
);

// ─── Card ───────────────────────────────────────────────────────────────────

function BddCard({ row, onDelete }: { row: BddRow; onDelete: (row: number, imm: string) => void }) {
  const updateMutation = useUpdateBddRow();
  const applyOptimisticUpdate = useOptimisticBddUpdate();
  const zone = useVehicleZone(row.IMM);

  function commitField(field: FieldKey) {
    return async (value: string) => {
      await updateMutation.mutateAsync({ row: row._row, updates: { [field]: value } });
      applyOptimisticUpdate(row._row, { [field]: value } as Partial<BddRow>);
    };
  }

  const flagStyle = FLAG_STYLE[row.flag] ?? null;
  const dot = prestataireDotClass(row.prestataire);
  // Emplacement is a human's manual assessment (see lib/types.ts) — INTROUVABLE
  // means someone has flagged this vehicle as genuinely not located, a real
  // alert worth the same red treatment ds-history's SheetCard gives RL rows.
  const isIntrouvable = row.Emplacement === "INTROUVABLE";

  return (
    <RecordCard
      imm={row.IMM}
      subtitle={[row.client, row.modele].filter(Boolean).join(" · ")}
      className={cn(
        flagStyle && `border-l-4 ${flagStyle.border}`,
        isIntrouvable && "border-red-400 bg-red-50 dark:border-red-700 dark:bg-red-950/20"
      )}
      onDelete={() => onDelete(row._row, row.IMM)}
      headerLeft={
        <>
          {row.date && <span className="font-mono text-xs text-muted-foreground">{row.date}</span>}
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
                      "rounded-lg border border-dashed border-border px-1.5 py-0.5 text-micro text-muted-foreground",
                      justSaved && "ring-2 ring-emerald-400"
                    )}
                  >
                    + Flag
                  </span>
                )}
              </button>
            )}
          />
          <ZoneBadges {...zone} />
          {isIntrouvable && <Badge variant="error">⚠ Introuvable</Badge>}
        </>
      }
      headerRight={
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
                "flex min-h-8 flex-shrink-0 items-center rounded-lg px-2 py-1 text-micro font-bold uppercase transition disabled:opacity-60",
                value?.toUpperCase() === "EXTERNE" ? "bg-blue-500/10 text-blue-400" : "bg-amber-500/10 text-amber-400",
                justSaved && "ring-2 ring-emerald-400"
              )}
            >
              {value || "—"}
            </button>
          )}
        />
      }
    >
      <div className="flex flex-col gap-2">
        <InlineEditSelect
          value={row.Emplacement}
          options={EMPLACEMENT_OPTIONS}
          label="Emplacement"
          onCommit={commitField("Emplacement")}
          renderTrigger={(state) => (
            <FieldRowTrigger label="Emplacement" placeholder="— Choisir —" {...state} />
          )}
        />
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

      <ReadonlyFieldList fields={READONLY_HEADERS.map((h) => ({ label: h, value: String(row[h] ?? "") }))} />
      <ReadonlyFieldList
        title="Détection de zone (auto)"
        fields={BDD_ZONE_DETECTION_HEADERS.map((h) => ({ label: h, value: String(row[h] ?? "") }))}
      />
    </RecordCard>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

type Fleet = "TOUS" | "INTERNE" | "EXTERNE";

const EMPTY_ROWS: BddRow[] = [];

export default function SuiviRlPage() {
  const rowsQuery = useBddRows();
  const deleteMutation = useDeleteBddRow();

  const rows = rowsQuery.data ?? EMPTY_ROWS;
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeFleet, setActiveFleet] = useState<Fleet>("INTERNE");
  const [activeEmplacement, setActiveEmplacement] = useState("TOUS");
  const [activePrestataire, setActivePrestataire] = useState("TOUS");
  const [activeFlag, setActiveFlag] = useState("TOUS");
  const [error, setError] = useState("");

  async function handleDelete(row: number, imm: string) {
    try {
      await deleteMutation.mutateAsync({ row, imm });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
      setTimeout(() => setError(""), 5000);
    }
  }

  const fleetFiltered = useMemo(() => {
    if (activeFleet === "TOUS") {
      return rows.filter((r) => r.ETAT?.toUpperCase() === "INTERNE" || r.ETAT?.toUpperCase() === "EXTERNE");
    }
    return rows.filter((r) => r.ETAT?.toUpperCase() === activeFleet);
  }, [rows, activeFleet]);

  // Fixed 5-value dropdown (EMPLACEMENT_OPTIONS), not derived from what's
  // currently visible — unlike Prestataire/Flag below, so this chip row
  // doesn't need its own "visible*" list.
  const emplacementFiltered = useMemo(
    () => (activeEmplacement === "TOUS" ? fleetFiltered : fleetFiltered.filter((r) => r.Emplacement === activeEmplacement)),
    [fleetFiltered, activeEmplacement]
  );

  const visiblePrestataires = useMemo(
    () => [...new Set(emplacementFiltered.map((r) => r.prestataire).filter(Boolean))].sort(),
    [emplacementFiltered]
  );

  const prestataireFiltered = useMemo(
    () => (activePrestataire === "TOUS" ? emplacementFiltered : emplacementFiltered.filter((r) => r.prestataire === activePrestataire)),
    [emplacementFiltered, activePrestataire]
  );

  const visibleFlags = useMemo(
    () => [...new Set(prestataireFiltered.map((r) => r.flag).filter(Boolean))].sort(),
    [prestataireFiltered]
  );

  const flagFiltered = useMemo(
    () => (activeFlag === "TOUS" ? prestataireFiltered : prestataireFiltered.filter((r) => r.flag === activeFlag)),
    [prestataireFiltered, activeFlag]
  );

  // Plate-only search, standardized on the same shared autocomplete pattern
  // as Parking/Atelier — client/modele/prestataire/commentaire free-text
  // matching was removed by explicit product decision. By design, this
  // bypasses the Flotte/Prestataire/Flag chip cascade entirely: chips are a
  // separate browsing filter, while search is for finding a specific real
  // plate regardless of what chips currently happen to be set. Chips only
  // apply when the search box is empty.
  const immList = useMemo(
    () => [...new Set(rows.map((r) => r.IMM).filter(Boolean))],
    [rows]
  );
  const { suggestions } = usePlateAutocomplete(search, immList);

  const searched = useMemo(() => {
    const term = search.trim().toUpperCase();
    if (!term) return flagFiltered;
    return rows.filter((r) => String(r.IMM ?? "").toUpperCase().includes(term));
  }, [flagFiltered, rows, search]);

  function selectFleet(f: Fleet) {
    setActiveFleet(f);
    setActiveEmplacement("TOUS");
    setActivePrestataire("TOUS");
    setActiveFlag("TOUS");
  }
  function selectEmplacement(e: string) {
    setActiveEmplacement(e);
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
  // `error` (delete-action failures) is surfaced unconditionally, same as
  // Parking/Atelier/Depot's `error || fetchError` pattern.
  const fetchError = rows.length === 0 && rowsQuery.error instanceof Error ? rowsQuery.error.message : "";
  const displayError = error || fetchError;
  const updatedLabel = rowsQuery.dataUpdatedAt
    ? `${rowsQuery.isFetching ? "cache · " : ""}${formatAge(rowsQuery.dataUpdatedAt)}`
    : "";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ListPageHeader
        title="AVIS"
        subtitle="Suivi RL"
        accentClassName={ZONE_COLORS.bdd.accentText}
        countClassName={ZONE_COLORS.bdd.count}
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
          <span className="mr-1 flex-shrink-0 text-micro font-bold uppercase text-muted-foreground">Flotte</span>
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
          <span className="mr-1 flex-shrink-0 text-micro font-bold uppercase text-muted-foreground">Emplacement</span>
          <ToggleGroup
            type="single"
            value={activeEmplacement}
            onValueChange={(v) => v && selectEmplacement(v)}
          >
            <ToggleGroupItem value="TOUS">TOUS</ToggleGroupItem>
            {EMPLACEMENT_OPTIONS.map((e) => (
              <ToggleGroupItem key={e} value={e}>
                {e}
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
          <Alert className="mb-3">{displayError}</Alert>
        )}

        {rowsQuery.isPending && (
          <div className="py-16 text-center text-sm text-muted-foreground">Chargement…</div>
        )}

        {!rowsQuery.isPending && searched.length === 0 && !displayError && (
          <div className="py-16 text-center text-sm text-muted-foreground">Aucun véhicule</div>
        )}

        <div className="flex flex-col gap-2">
          {searched.map((row) => (
            <BddCard key={row._row} row={row} onDelete={handleDelete} />
          ))}
        </div>

        {updatedLabel && <div className="mt-4 text-center font-mono text-micro text-muted-foreground">Sync: {updatedLabel}</div>}
      </div>
    </div>
  );
}
