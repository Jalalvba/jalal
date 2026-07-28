"use client";

import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import type { RdvAddInput } from "@/lib/types";
import { RDV_CONVOYEURS, RDV_MATRICULE_REGEX } from "@/lib/types";
import { useAddRdvRow } from "@/hooks/useRdvRows";
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/fleet/Field";
import { Alert } from "@/components/ui/alert";

const REQUIRED_FIELDS: (keyof RdvAddInput)[] = [
  "date",
  "heure",
  "clients",
  "vehicule",
  "matricule",
  "intervention",
  "contact",
  "convoyeur",
];

const BLANK_FORM: RdvAddInput = {
  date: "",
  heure: "9h",
  clients: "",
  vehicule: "",
  matricule: "",
  intervention: "",
  contact: "",
  convoyeur: "",
};

const selectClass =
  "h-11 w-full rounded-xl border border-border bg-input px-3 text-sm text-foreground outline-none focus:border-fuchsia-500";

/** yyyy-mm-dd, current month's 1st through next month's last day — matches
 *  addAppointmentToMonthlyTab()'s own accepted window exactly (current +
 *  next calendar month only), so the date picker's min/max give the same
 *  guidance the server will actually enforce. */
function dateWindow(): { min: string; max: string } {
  const now = new Date();
  const min = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const max = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { min: iso(min), max: iso(max) };
}

export function AddRdvDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<RdvAddInput>(BLANK_FORM);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const addMutation = useAddRdvRow();
  const { min, max } = dateWindow();

  function set<K extends keyof RdvAddInput>(key: K, value: RdvAddInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function resetAndClose() {
    setForm(BLANK_FORM);
    setError("");
    setWarning("");
    setOpen(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setWarning("");

    const missing = REQUIRED_FIELDS.filter((f) => !form[f].trim());
    if (missing.length > 0) {
      setError("Tous les champs sont obligatoires.");
      return;
    }
    if (!RDV_MATRICULE_REGEX.test(form.matricule.trim().toUpperCase())) {
      setError(
        'Format Matricule incorrect — exemples valides : "980867WW" (6 chiffres + 2 lettres) ou "79421-B-7" (4-5 chiffres-1 lettre-1 chiffre).'
      );
      return;
    }

    try {
      const result = await addMutation.mutateAsync(form);
      if (result.warning) {
        setWarning(result.warning);
        // Monthly tab (the durable write) succeeded — keep the dialog open
        // just long enough to show the warning, then close, rather than
        // silently discarding it.
        setTimeout(resetAndClose, 4000);
      } else {
        resetAndClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setForm(BLANK_FORM);
          setError("");
          setWarning("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" className="bg-fuchsia-600 text-white hover:bg-fuchsia-500">
          <Plus className="h-4 w-4" />
          Nouveau rendez-vous
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Nouveau rendez-vous</DialogTitle>
        <DialogDescription>
          Enregistré dans le calendrier mensuel (mois actuel ou suivant uniquement) et dans le miroir rapide de l&apos;app.
        </DialogDescription>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <Input type="date" min={min} max={max} value={form.date} onChange={(e) => set("date", e.target.value)} required />
            </Field>
            <Field label="Heure">
              <Input value={form.heure} onChange={(e) => set("heure", e.target.value)} placeholder="9h" required />
            </Field>
          </div>

          <Field label="Clients">
            <Input value={form.clients} onChange={(e) => set("clients", e.target.value)} required />
          </Field>

          <Field label="Véhicule">
            <Input value={form.vehicule} onChange={(e) => set("vehicule", e.target.value)} required />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Matricule">
              <Input
                value={form.matricule}
                onChange={(e) => set("matricule", e.target.value)}
                placeholder="980867WW"
                className="font-mono uppercase"
                required
              />
            </Field>
            <Field label="Contact">
              <Input value={form.contact} onChange={(e) => set("contact", e.target.value)} required />
            </Field>
          </div>

          <Field label="Intervention">
            <textarea
              value={form.intervention}
              onChange={(e) => set("intervention", e.target.value)}
              rows={3}
              required
              className="w-full rounded-xl border border-border bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-fuchsia-500"
            />
          </Field>

          <Field label="Convoyeur">
            <select value={form.convoyeur} onChange={(e) => set("convoyeur", e.target.value)} required className={selectClass}>
              <option value="">— Sélectionner —</option>
              {RDV_CONVOYEURS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </Field>

          {error && <Alert>{error}</Alert>}
          {warning && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              {warning}
            </div>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Annuler
              </Button>
            </DialogClose>
            <Button type="submit" disabled={addMutation.isPending} className="bg-fuchsia-600 text-white hover:bg-fuchsia-500">
              {addMutation.isPending ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
