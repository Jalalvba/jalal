"use client";

import { useMemo, useState } from "react";
import type { RdvRow, RdvEditableField, RdvAddInput } from "@/lib/types";
import { ListPageHeader } from "@/components/fleet/ListPageHeader";
import { PlateFilterInput } from "@/components/fleet/PlateFilterInput";
import { RecordCard } from "@/components/fleet/RecordCard";
import { Field } from "@/components/fleet/Field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { useEditableState } from "@/hooks/useEditableState";
import { useParkingImmList } from "@/hooks/useParkingRows";
import { useVehicleZone } from "@/hooks/useVehicleZone";
import { ZoneBadges } from "@/components/fleet/ZoneBadges";
import { useRdvRows, useAddRdvRow, useUpdateRdvField, useDeleteRdvRow } from "@/hooks/useRdvRows";

function stripAlnum(s: string): string {
  return s.replace(/[^A-Z0-9]/g, "");
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** rawDate is midnight-UTC for date-only values (see lib/googleSheetsRdv.ts) — converting straight back to yyyy-mm-dd needs no re-parsing of the display string. */
function rawDateToIso(rawDate: number): string {
  return rawDate ? new Date(rawDate).toISOString().slice(0, 10) : todayIso();
}

// ─── RDV card (per row) — every field is editable, this tab has no
// formula/read-only columns (confirmed live, see lib/types.ts) ─────────────

function RdvCard({
  row,
  onFieldCommit,
  onDelete,
}: {
  row: RdvRow;
  onFieldCommit: (rowIndex: number, field: RdvEditableField, value: string) => void;
  onDelete: (rowIndex: number) => void;
}) {
  const zone = useVehicleZone(row.matricule);
  const resyncDeps = [
    row.rowIndex,
    row.date,
    row.heure,
    row.clients,
    row.vehicule,
    row.matricule,
    row.intervention,
    row.contact,
    row.convoyeur,
  ];
  const [date, setDate] = useEditableState(rawDateToIso(row.rawDate), resyncDeps);
  const [heure, setHeure] = useEditableState(row.heure, resyncDeps);
  const [clients, setClients] = useEditableState(row.clients, resyncDeps);
  const [vehicule, setVehicule] = useEditableState(row.vehicule, resyncDeps);
  const [matricule, setMatricule] = useEditableState(row.matricule, resyncDeps);
  const [intervention, setIntervention] = useEditableState(row.intervention, resyncDeps);
  const [contact, setContact] = useEditableState(row.contact, resyncDeps);
  const [convoyeur, setConvoyeur] = useEditableState(row.convoyeur, resyncDeps);

  const inputClass = "h-auto py-1.5 text-[11px] focus:border-emerald-500";

  return (
    <RecordCard
      imm={row.matricule || "—"}
      subtitle={[row.clients, row.vehicule].filter(Boolean).join(" · ")}
      timestamp={[row.date, row.heure].filter(Boolean).join(" · ")}
      onDelete={() => onDelete(row.rowIndex)}
    >
      <div className="mb-1.5">
        <ZoneBadges {...zone} />
      </div>

      <div className="grid grid-cols-1 gap-2.5 text-[11px] sm:grid-cols-2">
        <Field label="Date">
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            onBlur={() => {
              if (date !== rawDateToIso(row.rawDate)) onFieldCommit(row.rowIndex, "Date", date);
            }}
            className={inputClass}
          />
        </Field>
        <Field label="Heure">
          <Input
            value={heure}
            placeholder="ex: 9h"
            onChange={(e) => setHeure(e.target.value)}
            onBlur={() => {
              if (heure !== row.heure) onFieldCommit(row.rowIndex, "Heure", heure);
            }}
            className={inputClass}
          />
        </Field>
        <Field label="Clients">
          <Input
            value={clients}
            onChange={(e) => setClients(e.target.value)}
            onBlur={() => {
              if (clients !== row.clients) onFieldCommit(row.rowIndex, "Clients", clients);
            }}
            className={inputClass}
          />
        </Field>
        <Field label="Véhicule">
          <Input
            value={vehicule}
            onChange={(e) => setVehicule(e.target.value)}
            onBlur={() => {
              if (vehicule !== row.vehicule) onFieldCommit(row.rowIndex, "Véhicule", vehicule);
            }}
            className={inputClass}
          />
        </Field>
        <Field label="Matricule">
          <Input
            value={matricule}
            onChange={(e) => setMatricule(e.target.value)}
            onBlur={() => {
              if (matricule !== row.matricule) onFieldCommit(row.rowIndex, "Matricule", matricule);
            }}
            className={`${inputClass} font-mono uppercase`}
          />
        </Field>
        <Field label="Contact">
          <Input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            onBlur={() => {
              if (contact !== row.contact) onFieldCommit(row.rowIndex, "Contact", contact);
            }}
            className={inputClass}
          />
        </Field>
        <Field label="Convoyeur">
          <Input
            value={convoyeur}
            onChange={(e) => setConvoyeur(e.target.value)}
            onBlur={() => {
              if (convoyeur !== row.convoyeur) onFieldCommit(row.rowIndex, "CONVOYEUR", convoyeur);
            }}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="mt-2.5">
        <Field label="Intervention">
          <textarea
            value={intervention}
            onChange={(e) => setIntervention(e.target.value)}
            onBlur={() => {
              if (intervention !== row.intervention) onFieldCommit(row.rowIndex, "Intervention", intervention);
            }}
            rows={2}
            className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-800/50 px-2.5 py-2 text-[11px] leading-snug text-zinc-100 outline-none focus:border-emerald-500"
          />
        </Field>
      </div>
    </RecordCard>
  );
}

// ─── New-appointment form ──────────────────────────────────────────────────

const EMPTY_FORM: RdvAddInput = {
  date: todayIso(),
  heure: "",
  clients: "",
  vehicule: "",
  matricule: "",
  intervention: "",
  contact: "",
  convoyeur: "",
};

function NewRdvForm({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState<RdvAddInput>(EMPTY_FORM);
  const [comboOpen, setComboOpen] = useState(false);
  const [error, setError] = useState("");
  const immListQuery = useParkingImmList();
  const addMutation = useAddRdvRow();

  const matriculeSuggestions = useMemo(() => {
    const frag = stripAlnum(form.matricule.toUpperCase());
    if (!frag) return [];
    return (immListQuery.data ?? []).filter((imm) => stripAlnum(imm).startsWith(frag)).slice(0, 15);
  }, [form.matricule, immListQuery.data]);

  function set<K extends keyof RdvAddInput>(key: K, value: RdvAddInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    setError("");
    try {
      await addMutation.mutateAsync(form);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    }
  }

  return (
    <div className="mt-2 rounded-xl border border-emerald-600/40 bg-zinc-900/60 p-3">
      <div className="grid grid-cols-1 gap-2.5 text-[11px] sm:grid-cols-2">
        <Field label="Date">
          <Input
            type="date"
            value={form.date}
            onChange={(e) => set("date", e.target.value)}
            className="h-auto py-1.5 text-[11px] focus:border-emerald-500"
          />
        </Field>
        <Field label="Heure">
          <Input
            value={form.heure}
            placeholder="ex: 9h"
            onChange={(e) => set("heure", e.target.value)}
            className="h-auto py-1.5 text-[11px] focus:border-emerald-500"
          />
        </Field>
        <Field label="Clients">
          <Input
            value={form.clients}
            onChange={(e) => set("clients", e.target.value)}
            className="h-auto py-1.5 text-[11px] focus:border-emerald-500"
          />
        </Field>
        <Field label="Véhicule">
          <Input
            value={form.vehicule}
            onChange={(e) => set("vehicule", e.target.value)}
            className="h-auto py-1.5 text-[11px] focus:border-emerald-500"
          />
        </Field>
        <Field label="Matricule">
          <Combobox
            value={form.matricule}
            onValueChange={(v) => {
              set("matricule", v);
              setComboOpen(true);
            }}
            open={comboOpen}
            onOpenChange={setComboOpen}
            options={matriculeSuggestions}
            onSelect={(v) => {
              set("matricule", v);
              setComboOpen(false);
            }}
            placeholder="Immatriculation…"
            inputMode="numeric"
            inputClassName="h-10 text-xs font-mono uppercase"
          />
        </Field>
        <Field label="Contact">
          <Input
            value={form.contact}
            onChange={(e) => set("contact", e.target.value)}
            className="h-auto py-1.5 text-[11px] focus:border-emerald-500"
          />
        </Field>
        <Field label="Convoyeur">
          <Input
            value={form.convoyeur}
            onChange={(e) => set("convoyeur", e.target.value)}
            className="h-auto py-1.5 text-[11px] focus:border-emerald-500"
          />
        </Field>
      </div>

      <div className="mt-2.5">
        <Field label="Intervention">
          <textarea
            value={form.intervention}
            onChange={(e) => set("intervention", e.target.value)}
            rows={2}
            className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-800/50 px-2.5 py-2 text-[11px] leading-snug text-zinc-100 outline-none focus:border-emerald-500"
          />
        </Field>
      </div>

      {error && <div className="mt-2 text-[11px] text-red-400">{error}</div>}

      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          onClick={submit}
          disabled={addMutation.isPending}
          className="h-9 flex-1 bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-500"
        >
          {addMutation.isPending ? "Ajout…" : "➕ Ajouter le RDV"}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose} className="h-9 text-xs">
          Annuler
        </Button>
      </div>
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function RdvPage() {
  const rowsQuery = useRdvRows();
  const fieldMutation = useUpdateRdvField();
  const deleteMutation = useDeleteRdvRow();

  const [search, setSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [error, setError] = useState("");

  const rows = rowsQuery.data ?? [];

  async function handleFieldCommit(rowIndex: number, field: RdvEditableField, value: string) {
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

  const searched = (() => {
    const term = search.trim().toUpperCase();
    if (!term) return rows;
    return rows.filter((r) => r.matricule.includes(term));
  })();

  const displayError = error || (rowsQuery.error instanceof Error ? rowsQuery.error.message : "");

  return (
    <div className="min-h-screen bg-black text-zinc-50">
      <ListPageHeader
        title="📅 RDV"
        subtitle="AVIS Maroc"
        accentClassName="text-emerald-400"
        countClassName="border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
        count={searched.length}
        onRefresh={() => rowsQuery.refetch()}
      >
        <Button
          type="button"
          onClick={() => setShowAddForm((s) => !s)}
          className="h-10 w-full bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-500"
        >
          {showAddForm ? "✕ Fermer" : "➕ Nouveau RDV"}
        </Button>

        {showAddForm && <NewRdvForm onClose={() => setShowAddForm(false)} />}

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
          <div className="py-16 text-center text-sm text-zinc-500">Aucun rendez-vous</div>
        )}

        <div className="flex flex-col gap-2.5">
          {searched.map((row) => (
            <RdvCard key={row.rowIndex} row={row} onFieldCommit={handleFieldCommit} onDelete={handleDelete} />
          ))}
        </div>
      </div>
    </div>
  );
}
