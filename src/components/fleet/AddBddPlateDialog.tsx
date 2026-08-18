"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import type { ParkingAddResultItem } from "@/types";
import { useAddBddRow } from "@/hooks/useBddRows";
import { useVehicleSuggestionList } from "@/hooks/useVehicleSuggestionList";
import { useSheetFieldOptions } from "@/hooks/useSheetFieldOptions";
import { usePlateAutocomplete } from "@/hooks/usePlateAutocomplete";
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Field } from "@/components/fleet/Field";
import { Alert } from "@/components/ui/alert";
import { AddResultsList } from "@/components/fleet/AddResultsList";

const selectClass =
  "h-11 w-full rounded-xl border border-border bg-input px-3 text-sm text-foreground outline-none focus:border-violet-500";

/**
 * BDD's add-plate form, matching Parking/Atelier/Depot's add-plate feature
 * (same shared parc+cp autocomplete via useVehicleSuggestionList, same
 * server-side typo-resolution + "not found in parc" warning badge via
 * ParkingAddResultItem/AddResultsList) with one deliberate difference: ETAT
 * is a second required field, since BDD's default Flotte filter hides any
 * row whose ETAT isn't INTERNE/EXTERNE (see src/lib/sheets/googleSheetsBdd.ts's
 * addBddRow() docstring) -- a plate added with a blank ETAT would be
 * invisible in the UI even though it exists in the sheet. Everything else
 * (prestataire/flag/Emplacement/Catégorie/Technicien/commentaire) is left
 * blank, filled in later via the existing inline-edit UI on each card.
 */
export function AddBddPlateDialog() {
  const [open, setOpen] = useState(false);
  const [imm, setImm] = useState("");
  const [immOpen, setImmOpen] = useState(false);
  const [etat, setEtat] = useState("");
  const [error, setError] = useState("");
  const [results, setResults] = useState<ParkingAddResultItem[] | null>(null);

  const addMutation = useAddBddRow();
  const vehicleSuggestionsQuery = useVehicleSuggestionList();
  const { options } = useSheetFieldOptions();

  const immList = useMemo(() => (vehicleSuggestionsQuery.data ?? []).map((v) => v.imm), [vehicleSuggestionsQuery.data]);
  const { suggestions } = usePlateAutocomplete(imm, immList);

  function resetAndClose() {
    setImm("");
    setEtat("");
    setError("");
    setResults(null);
    setOpen(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!imm.trim()) {
      setError("Immatriculation obligatoire.");
      return;
    }
    if (!etat) {
      setError("ETAT obligatoire.");
      return;
    }

    try {
      const result = await addMutation.mutateAsync({ imm: imm.trim(), etat });
      setResults(result.results);
      setTimeout(resetAndClose, 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetAndClose();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" className="bg-violet-600 text-white hover:bg-violet-500">
          <Plus className="h-4 w-4" />
          Ajouter une plaque
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Ajouter une plaque à BDD</DialogTitle>
        <DialogDescription>
          Seuls IMM et ETAT sont requis — les autres champs (prestataire, flag, emplacement, catégorie, technicien,
          commentaire) se renseignent ensuite depuis la fiche.
        </DialogDescription>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <Field label="Immatriculation">
            <Combobox
              value={imm}
              onValueChange={(v) => {
                setImm(v);
                setImmOpen(true);
              }}
              open={immOpen}
              onOpenChange={setImmOpen}
              options={suggestions}
              onSelect={(selected) => {
                setImm(selected);
                setImmOpen(false);
              }}
              placeholder="ex: 48070 ou 832223WW"
              inputMode="numeric"
              inputClassName="border-2 border-violet-600/60 focus:border-violet-500"
            />
          </Field>

          <Field label="ETAT">
            <select value={etat} onChange={(e) => setEtat(e.target.value)} required className={selectClass}>
              <option value="">— Sélectionner —</option>
              {options.ETAT_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>

          {error && <Alert>{error}</Alert>}
          {results && <AddResultsList results={results} />}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Annuler
              </Button>
            </DialogClose>
            <Button type="submit" disabled={addMutation.isPending} className="bg-violet-600 text-white hover:bg-violet-500">
              {addMutation.isPending ? "Ajout…" : "Ajouter"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
