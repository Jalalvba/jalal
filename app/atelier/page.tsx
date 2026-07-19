"use client";

import { useState } from "react";
import type { AtelierRow, ParkingAddResultItem, AtelierEditableField } from "@/lib/types";
import { ListPageHeader } from "@/components/fleet/ListPageHeader";
import { PlateSearchInput } from "@/components/fleet/PlateSearchInput";
import { PlateFilterInput } from "@/components/fleet/PlateFilterInput";
import { AddResultsList } from "@/components/fleet/AddResultsList";
import { RecordCard } from "@/components/fleet/RecordCard";
import { ReadonlyFieldList } from "@/components/fleet/ReadonlyFieldList";
import { Field } from "@/components/fleet/Field";
import { Input } from "@/components/ui/input";
import { useEditableState } from "@/hooks/useEditableState";
import { useParkingImmList } from "@/hooks/useParkingRows";
import {
  useAtelierRows,
  useAddAtelierPlates,
  useUpdateAtelierField,
  useDeleteAtelierRow,
  useClearAtelierAll,
} from "@/hooks/useAtelierRows";

// ─── Option lists — exact, same values already used by app/suivi-rl/page.tsx's
// getDropdownLists() equivalent (CFG_PARKING_SHEET.CATEGORIES_LIST / TECHNICIENS_LIST) ──

const CATEGORIE_OPTIONS = [
  "Atelier chargé — en attente diagnostic",
  "En cours diagnostic par technicien",
  "En réparation atelier",
  "En réparation externe — décision validée",
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

const selectClass =
  "h-auto w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[11px] font-medium text-zinc-200 outline-none focus:border-amber-500";

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
  onFieldCommit: (rowIndex: number, field: AtelierEditableField, value: string) => void;
  onDelete: (rowIndex: number) => void;
}) {
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
      onDelete={() => onDelete(row.rowIndex)}
    >
      <div className="grid grid-cols-1 gap-2.5 text-[11px] sm:grid-cols-2">
        <Field label="Catégorie">
          <select
            value={categorie}
            onChange={(e) => {
              setCategorie(e.target.value);
              onFieldCommit(row.rowIndex, "CATÉGORIE", e.target.value);
            }}
            className={selectClass}
          >
            <option value="">— Sélectionner —</option>
            {CATEGORIE_OPTIONS.map((o) => (
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
              onFieldCommit(row.rowIndex, "TECHNICIEN", e.target.value);
            }}
            className={selectClass}
          >
            <option value="">— Sélectionner —</option>
            {TECHNICIEN_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-2.5 text-[11px] sm:grid-cols-2">
        <Field label="Suivi (Commentaire)">
          <Input
            value={commentaire}
            placeholder="Taper le suivi…"
            onChange={(e) => setCommentaire(e.target.value)}
            onBlur={() => {
              if (commentaire !== row.commentaire) onFieldCommit(row.rowIndex, "COMMENTAIRE", commentaire);
            }}
            className="h-auto py-1.5 text-[11px] focus:border-amber-500"
          />
        </Field>
        <Field label="Besoin Pièce">
          <Input
            value={besoinPiece}
            placeholder="Pièce requise…"
            onChange={(e) => setBesoinPiece(e.target.value)}
            onBlur={() => {
              if (besoinPiece !== row.besoinPiece) onFieldCommit(row.rowIndex, "BESOIN PIÈCE", besoinPiece);
            }}
            className="h-auto py-1.5 text-[11px] focus:border-amber-500"
          />
        </Field>
      </div>

      <ReadonlyFieldList fields={READONLY_FIELDS.map((f) => ({ label: f.label, value: row[f.key] }))} />
    </RecordCard>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function AtelierPage() {
  const rowsQuery = useAtelierRows();
  const immListQuery = useParkingImmList(); // shared parc plate list, same underlying resource as Parking
  const addMutation = useAddAtelierPlates();
  const fieldMutation = useUpdateAtelierField();
  const deleteMutation = useDeleteAtelierRow();
  const clearAllMutation = useClearAtelierAll();

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

  async function handleFieldCommit(rowIndex: number, field: AtelierEditableField, value: string) {
    try {
      await fieldMutation.mutateAsync({ rowIndex, field, value });
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
        title="🔧 ATELIER"
        subtitle="AVIS Maroc"
        accentClassName="text-amber-400"
        countClassName="border-amber-500/20 bg-amber-500/10 text-amber-400"
        count={searched.length}
        onRefresh={() => rowsQuery.refetch()}
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
          <div className="py-16 text-center text-sm text-zinc-500">Aucun véhicule en atelier</div>
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
