"use client";

// DELIBERATE (2026-08-09): despite the "Suivi RL" name, this page reads/writes the
// BDD sheet tab (src/lib/sheets/googleSheetsBdd.ts), not a separate "RL" tab — none exists.
// "RL" is a business/UI label for a view over BDD's RL-related columns.

import { useMemo, useState } from "react";
import {
  BDD_HEADERS,
  BDD_ZONE_DETECTION_HEADERS,
  getFlagStyle,
  getPrestataireDotClass,
  EMPLACEMENT_INTROUVABLE,
  ETAT_INTERNE,
  ETAT_EXTERNE,
  etatBadgeClass,
  type BddRow,
  type ReformulateCommentContext,
  type CostInfo,
} from "@/types";
import { ZONE_COLORS } from "@/config/zones";
import { ListPageHeader } from "@/components/fleet/ListPageHeader";
import { LoadingSkeleton } from "@/components/fleet/LoadingSkeleton";
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
import { cn } from "@/lib/utils/cn";
import {
  useBddRows,
  useUpdateBddRow,
  useOptimisticBddUpdate,
  useDeleteBddRow,
  useRefreshBddRows,
  useReformulateComment,
} from "@/hooks/useBddRows";
import { AddBddPlateDialog } from "@/components/fleet/AddBddPlateDialog";
import { useVehicleZone } from "@/hooks/useVehicleZone";
import { ZoneBadges } from "@/components/fleet/ZoneBadges";
import { CostBadge } from "@/components/fleet/CostBadge";
import { useSheetFieldOptions, optionValues } from "@/hooks/useSheetFieldOptions";
import { Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

function formatAge(dataUpdatedAt: number): string {
  if (!dataUpdatedAt) return "";
  const minutes = Math.round((Date.now() - dataUpdatedAt) / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes}m`;
  return `il y a ${Math.floor(minutes / 60)}h`;
}

// "TOUS" ("clear this axis") lives outside each multi-select ToggleGroup,
// since Radix's type="multiple" ToggleGroup value is the set of pressed
// *individual* items — folding a "clear all" pseudo-value into that same
// array would fight the group's own on/off semantics per real item. Same
// visual language as ToggleGroupItem's own on/off classes
// (src/components/ui/toggle-group.tsx) so it reads as part of the same chip row.
function AllChip({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-shrink-0 whitespace-nowrap rounded-full border border-border bg-card px-2.5 py-1.5 text-micro font-medium text-muted-foreground transition",
        active && "border-amber-500 bg-amber-500/10 text-amber-400"
      )}
    >
      TOUS
    </button>
  );
}

function DlIcon({ spinning }: { spinning?: boolean }) {
  return spinning
    ? <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="animate-spin"><circle cx="8" cy="8" r="6" strokeDasharray="28" strokeDashoffset="10"/></svg>
    : <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 12h10M8 2v8M5 7l3 3 3-3" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

// ─── PDF export (server-side via /api/bdd/export) — sends exactly the rows
// currently on screen (post-cascade, post-search), never the full dataset.
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function downloadBddPdf(
  rows: BddRow[],
  activeFilters: { label: string; value: string }[],
  searchTerm: string,
  setExporting: (v: boolean) => void
) {
  setExporting(true);
  try {
    const res = await fetch("/api/bdd/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: rows.map((r) => ({
          IMM: String(r.IMM ?? ""),
          client: String(r.client ?? ""),
          // Some real vehicle models (Peugeot 208/508/2008/3008, ...) are
          // literal digit strings, and the sheet sometimes stores them as a
          // raw number rather than text — formatCellValue() passes numeric
          // cells through as-is (only date-like headers get converted), so
          // r.modele can genuinely be a `number` here despite BddRow's `string`
          // type. String() below is the fix; without it, one such row's
          // non-string modele fails the export route's strict isValidRow()
          // check and rejects the WHOLE batch, not just that row.
          modele: String(r.modele ?? ""),
          // Same field/source as the Excel export's Emplacement column
          // (downloadBddExcel below) — kept in sync deliberately, not
          // derived, since the two routes validate independently.
          Emplacement: String(r.Emplacement ?? ""),
          commentaire: String(r.commentaire ?? ""),
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
    const filterSlug = [...activeFilters.map((f) => f.value), searchTerm]
      .filter(Boolean)
      .map(slugify)
      .filter(Boolean)
      .join("-");
    a.download = `bdd-export-${dateSlug}${filterSlug ? `-${filterSlug}` : ""}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(`Erreur export PDF: ${e instanceof Error ? e.message : e}`);
  } finally {
    setExporting(false);
  }
}

// Mirrors downloadBddPdf above, against /api/bdd/export-excel instead —
// same filtered-rows-only behavior, same activeFilters/searchTerm header
// info, and the same five columns. Both exports include Emplacement: this
// one got it first (12bdc5e), the PDF export followed in e3bc354 — see that
// route's BddExportRow comment for which fields are excluded and why.
async function downloadBddExcel(
  rows: BddRow[],
  activeFilters: { label: string; value: string }[],
  searchTerm: string,
  setExporting: (v: boolean) => void
) {
  setExporting(true);
  try {
    const res = await fetch("/api/bdd/export-excel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: rows.map((r) => ({
          IMM: String(r.IMM ?? ""),
          client: String(r.client ?? ""),
          modele: String(r.modele ?? ""),
          Emplacement: String(r.Emplacement ?? ""),
          commentaire: String(r.commentaire ?? ""),
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
    const filterSlug = [...activeFilters.map((f) => f.value), searchTerm]
      .filter(Boolean)
      .map(slugify)
      .filter(Boolean)
      .join("-");
    a.download = `bdd-export-${dateSlug}${filterSlug ? `-${filterSlug}` : ""}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(`Erreur export Excel: ${e instanceof Error ? e.message : e}`);
  } finally {
    setExporting(false);
  }
}

// Server allowlist (src/types/index.ts's BDD_EDITABLE_FIELDS) is unchanged — this
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
  const { options } = useSheetFieldOptions();

  function commitField(field: FieldKey) {
    return async (value: string) => {
      await updateMutation.mutateAsync({ row: row._row, updates: { [field]: value }, imm: row.IMM });
      applyOptimisticUpdate(row._row, { [field]: value } as Partial<BddRow>);
    };
  }

  const flagStyle = getFlagStyle(row.flag, options.FLAG_OPTIONS);
  const dot = getPrestataireDotClass(row.prestataire, options.PRESTATAIRE_OPTIONS);
  // Emplacement is a human's manual assessment (see src/types/index.ts) —
  // EMPLACEMENT_INTROUVABLE means someone has flagged this vehicle as
  // genuinely not located, a real alert worth the same red treatment
  // ds-history's SheetCard gives RL rows. WARNING: Emplacement is
  // admin-editable at /admin/config — if that exact value is ever renamed
  // or removed there, this comparison silently stops matching anything and
  // the alert styling disappears with no error (see EMPLACEMENT_INTROUVABLE's
  // own comment in src/types/index.ts).
  const isIntrouvable = row.Emplacement === EMPLACEMENT_INTROUVABLE;

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
            options={optionValues(options.FLAG_OPTIONS)}
            label="Flag"
            onCommit={commitField("flag")}
            renderTrigger={({ value, pending, justSaved, onOpen }: InlineEditTriggerState) => (
              <button
                type="button"
                onClick={onOpen}
                disabled={pending}
                className="flex min-h-8 items-center py-1 disabled:opacity-60"
              >
                {value && getFlagStyle(value, options.FLAG_OPTIONS) ? (
                  <Badge className={cn(getFlagStyle(value, options.FLAG_OPTIONS)!.badge, justSaved && "ring-2 ring-emerald-400")}>{value}</Badge>
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
          options={options.ETAT_OPTIONS}
          label="État"
          onCommit={commitField("ETAT")}
          renderTrigger={({ value, pending, justSaved, onOpen }: InlineEditTriggerState) => (
            <button
              type="button"
              onClick={onOpen}
              disabled={pending}
              className={cn(
                "flex min-h-8 flex-shrink-0 items-center rounded-lg px-2 py-1 text-micro font-bold uppercase transition disabled:opacity-60",
                // etatBadgeClass (src/types/index.ts) — shared with ds-history's
                // ETAT badge, replaces this page's own two-branch
                // (EXTERNE-vs-everything-else) ternary, which silently
                // rendered DISPONIBLE/ANNULE/ANNULEE the same as INTERNE.
                etatBadgeClass(value),
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
          options={options.EMPLACEMENT_OPTIONS}
          label="Emplacement"
          onCommit={commitField("Emplacement")}
          renderTrigger={(state) => (
            <FieldRowTrigger label="Emplacement" placeholder="— Choisir —" {...state} />
          )}
        />
        <InlineEditSelect
          value={row["Catégorie"]}
          options={options.CATEGORIE_OPTIONS}
          label="Catégorie"
          onCommit={commitField("Catégorie")}
          renderTrigger={(state) => (
            <FieldRowTrigger label="Catégorie" placeholder="— Choisir —" {...state} />
          )}
        />
        <InlineEditSelect
          value={row.Technicien}
          options={options.TECHNICIEN_OPTIONS}
          label="Technicien"
          onCommit={commitField("Technicien")}
          renderTrigger={(state) => (
            <FieldRowTrigger label="Technicien" placeholder="— Choisir —" {...state} />
          )}
        />
        <InlineEditCombobox
          value={row.prestataire}
          options={optionValues(options.PRESTATAIRE_OPTIONS)}
          onCommit={commitField("prestataire")}
          placeholder="Prestataire…"
          renderTrigger={(state) => (
            <FieldRowTrigger label="Prestataire" placeholder="— Aucun —" dot={dot} {...state} />
          )}
        />
        <div className="flex items-start gap-1.5">
          <InlineEditText
            value={row.commentaire}
            resyncDeps={[row._row, row.commentaire]}
            onCommit={commitField("commentaire")}
            placeholder="Commentaire…"
            className="flex-1"
          />
          <ReformulateCommentButton
            comment={row.commentaire}
            context={{
              // BDD field values can be raw non-string Sheet cells (e.g.
              // modele as a bare number) — coerced the same way
              // downloadBddPdf does above.
              modele: String(row.modele ?? ""),
              etat: String(row.ETAT ?? ""),
              prestataire: String(row.prestataire ?? ""),
              flag: String(row.flag ?? ""),
              categorie: String(row["Catégorie"] ?? ""),
              technicien: String(row.Technicien ?? ""),
            }}
            onAccept={commitField("commentaire")}
          />
        </div>
      </div>

      <ReadonlyFieldList fields={READONLY_HEADERS.map((h) => ({ label: h, value: String(row[h] ?? "") }))} />
      <ReadonlyFieldList
        title="Détection de zone (auto)"
        fields={BDD_ZONE_DETECTION_HEADERS.map((h) => ({ label: h, value: String(row[h] ?? "") }))}
      />
    </RecordCard>
  );
}

// ─── Reformulate Commentaire (Gemini) ──────────────────────────────────────
//
// Suggestion-only: /api/bdd/reformulate-comment never touches the Sheet.
// Confirm reuses the row's own commitField("commentaire") (same save path
// as a manual edit) — Cancel just closes the dialog, no mutation call.
function ReformulateCommentButton({
  comment,
  context,
  onAccept,
}: {
  comment: string;
  context: ReformulateCommentContext;
  onAccept: (value: string) => Promise<void>;
}) {
  const reformulateMutation = useReformulateComment();
  const [open, setOpen] = useState(false);
  const [suggestion, setSuggestion] = useState("");
  const [costInfo, setCostInfo] = useState<CostInfo | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleClick() {
    if (!comment.trim()) {
      setError("Aucun commentaire à reformuler.");
      setSuggestion("");
      setOpen(true);
      return;
    }
    setError("");
    setSuggestion("");
    setCostInfo(null);
    setOpen(true);
    try {
      const res = await reformulateMutation.mutateAsync({ comment, context });
      setSuggestion(res.reformulated);
      setCostInfo(res.costInfo);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de la reformulation");
    }
  }

  async function handleConfirm() {
    setSaving(true);
    try {
      await onAccept(suggestion);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'enregistrement");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={handleClick}
        title="Reformuler avec l'IA"
        aria-label="Reformuler avec l'IA"
        className="mt-0.5"
      >
        <Sparkles className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Reformuler le commentaire</DialogTitle>
          <DialogDescription>
            Suggestion générée par IA — vérifiez avant d&apos;enregistrer.
          </DialogDescription>

          {error && <div className="mt-3 text-xs text-red-400">{error}</div>}

          {!error && (
            <div className="mt-3 space-y-3">
              <div>
                <div className="text-micro font-medium uppercase tracking-wide text-muted-foreground">
                  Original
                </div>
                <div className="mt-1 rounded-lg border border-border bg-muted px-2.5 py-2 text-xs text-foreground">
                  {comment}
                </div>
              </div>
              <div>
                <div className="text-micro font-medium uppercase tracking-wide text-muted-foreground">
                  Suggestion
                </div>
                {reformulateMutation.isPending ? (
                  <div className="mt-1 text-xs text-muted-foreground">Génération…</div>
                ) : (
                  <>
                    <textarea
                      value={suggestion}
                      onChange={(e) => setSuggestion(e.target.value)}
                      rows={3}
                      className="mt-1 w-full resize-none rounded-lg border border-amber-500/60 bg-muted px-2.5 py-2 text-xs leading-snug text-foreground outline-none"
                    />
                    {/* Cost of the call that produced this suggestion, returned
                        inline by /api/bdd/reformulate-comment in the same
                        response — nothing extra is fetched here. */}
                    {costInfo && (
                      <div className="mt-2">
                        <CostBadge costInfo={costInfo} />
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            {!error && (
              <Button
                type="button"
                onClick={handleConfirm}
                disabled={reformulateMutation.isPending || !suggestion.trim() || saving}
              >
                {saving ? "Enregistrement…" : "Confirmer"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

// "TOUS" has no corresponding src/types/index.ts constant — it's a filter-only
// sentinel meaning "no ETAT filter applied", not a real ETAT value, so
// there's nothing to rename-drift against. ETAT itself is admin-editable
// at /admin/config (options.ETAT_OPTIONS, live set as of 2026-08:
// INTERNE/EXTERNE/DISPONIBLE, plus ANNULE/ANNULEE in the fallback with no
// live rows currently) — see the comment in src/types/index.ts for the
// rename-drift risk.
//
// Fleet is a plain string (not a literal union) because the chip row below
// renders visibleFleetValues — the distinct ETAT values actually present in
// the loaded rows (c0d5965), not a fixed list. Those come straight from live
// sheet data, so no union could enumerate them ahead of time. (This comment
// previously said the chips render every options.ETAT_OPTIONS value, which
// was true only before c0d5965 switched Flotte to the data-derived,
// cascade-narrowing pattern Prestataire/Flag already used.)
type Fleet = string;

const EMPTY_ROWS: BddRow[] = [];

// Sentinel for the "Non renseigné" chip on each filter axis — matches rows
// where that field is blank, never a real field value (real values are
// always filtered through .filter(Boolean) before becoming chips, so this
// string can't collide with one). Kept out of BDD_HEADERS/BddRow entirely;
// purely a filter-axis UI concept.
const NON_RENSEIGNE = "__NON_RENSEIGNE__";

function displayAxisValue(v: string): string {
  return v === NON_RENSEIGNE ? "Non renseigné" : v;
}

// One predicate shared by all four axes: a selected NON_RENSEIGNE matches a
// blank field, any other selected value is an exact (optionally normalized,
// e.g. ETAT's uppercase compare) match — OR'd across whatever's selected in
// this axis, same "multi-select within an axis" semantics as before.
function axisMatches(value: string | undefined, selected: string[], normalize?: (v: string) => string): boolean {
  const v = normalize ? normalize(value ?? "") : value ?? "";
  return selected.some((s) => (s === NON_RENSEIGNE ? !v.trim() : v === s));
}

export default function SuiviRlPage() {
  const rowsQuery = useBddRows();
  const deleteMutation = useDeleteBddRow();
  const refreshMutation = useRefreshBddRows();

  const rows = rowsQuery.data ?? EMPTY_ROWS;
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  // Multi-select per axis (empty array = "TOUS"/no filter on that axis) —
  // axes still combine with AND, same as before (Flotte ∩ Emplacement ∩
  // Prestataire ∩ Flag), but each axis can now hold more than one selected
  // value, ORed together within that axis. Selecting/deselecting an
  // upstream axis still resets every downstream axis to "TOUS" (see
  // selectFleet/selectEmplacement/selectPrestataire below) — same cascade
  // as before, just operating on arrays now.
  const [activeFleet, setActiveFleet] = useState<Fleet[]>([ETAT_INTERNE]);
  const [activeEmplacement, setActiveEmplacement] = useState<string[]>([]);
  const [activePrestataire, setActivePrestataire] = useState<string[]>([]);
  const [activeFlag, setActiveFlag] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);

  async function handleDelete(row: number, imm: string) {
    try {
      await deleteMutation.mutateAsync({ row, imm });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
      setTimeout(() => setError(""), 5000);
    }
  }

  // "TOUS" (empty selection) deliberately stays scoped to INTERNE+EXTERNE
  // (the page's default active-fleet view), not every ETAT value —
  // DISPONIBLE/ANNULE/ANNULEE vehicles aren't under RL/immobilisation
  // tracking and shouldn't flood the default view. They're reachable via
  // their own explicit chip instead. Multi-select: any selected value
  // matches (OR within the axis).
  const fleetFiltered = useMemo(() => {
    if (activeFleet.length === 0) {
      return rows.filter((r) => r.ETAT?.toUpperCase() === ETAT_INTERNE || r.ETAT?.toUpperCase() === ETAT_EXTERNE);
    }
    return rows.filter((r) => axisMatches(r.ETAT, activeFleet, (v) => v.toUpperCase()));
  }, [rows, activeFleet]);

  // Flotte/Emplacement chip options used to come from admin-config lists
  // (options.ETAT_OPTIONS/EMPLACEMENT_OPTIONS) rather than the live data —
  // unlike Prestataire/Flag below, which already derive from what's
  // currently in scope. That meant a config-only value with zero live rows
  // (e.g. ANNULE/ANNULEE, confirmed via live data to currently have none)
  // still rendered as a clickable, always-empty chip. Switched to the same
  // cascade-narrowing, data-derived pattern Prestataire/Flag already use:
  // Flotte from the full dataset (top of the cascade, nothing upstream of
  // it), Emplacement from fleetFiltered (narrowed by the Flotte selection).
  // options.ETAT_OPTIONS/EMPLACEMENT_OPTIONS are untouched elsewhere — the
  // per-row InlineEditSelect editors still need the full admin-config list,
  // since editing a row can set a value no other row currently has.
  const visibleFleetValues = useMemo(
    () => [...new Set(rows.map((r) => r.ETAT?.toUpperCase()).filter(Boolean) as string[])].sort(),
    [rows]
  );
  const hasBlankFleet = useMemo(() => rows.some((r) => !r.ETAT?.trim()), [rows]);

  const emplacementFiltered = useMemo(
    () => (activeEmplacement.length === 0 ? fleetFiltered : fleetFiltered.filter((r) => axisMatches(r.Emplacement, activeEmplacement))),
    [fleetFiltered, activeEmplacement]
  );

  const visibleEmplacements = useMemo(
    () => [...new Set(fleetFiltered.map((r) => r.Emplacement).filter(Boolean))].sort(),
    [fleetFiltered]
  );
  const hasBlankEmplacement = useMemo(() => fleetFiltered.some((r) => !r.Emplacement?.trim()), [fleetFiltered]);

  const visiblePrestataires = useMemo(
    () => [...new Set(emplacementFiltered.map((r) => r.prestataire).filter(Boolean))].sort(),
    [emplacementFiltered]
  );
  const hasBlankPrestataire = useMemo(() => emplacementFiltered.some((r) => !r.prestataire?.trim()), [emplacementFiltered]);

  const prestataireFiltered = useMemo(
    () => (activePrestataire.length === 0 ? emplacementFiltered : emplacementFiltered.filter((r) => axisMatches(r.prestataire, activePrestataire))),
    [emplacementFiltered, activePrestataire]
  );

  const visibleFlags = useMemo(
    () => [...new Set(prestataireFiltered.map((r) => r.flag).filter(Boolean))].sort(),
    [prestataireFiltered]
  );
  const hasBlankFlag = useMemo(() => prestataireFiltered.some((r) => !r.flag?.trim()), [prestataireFiltered]);

  const flagFiltered = useMemo(
    () => (activeFlag.length === 0 ? prestataireFiltered : prestataireFiltered.filter((r) => axisMatches(r.flag, activeFlag))),
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

  // Mirrors what's actually applied to `searched`: a non-empty search term
  // bypasses the chip cascade entirely (see the comment above), so the
  // filter summary shown in the exported PDF must too — otherwise it would
  // claim chips were applied when they weren't.
  // Multiple selected values within one axis are joined with " ou " in the
  // exported header line/filename slug — e.g. "Emplacement: Atelier ou
  // Dépôt" — rather than one filter entry per value, so it still reads as
  // a single filter per axis.
  const activeFilters = useMemo(() => {
    if (search.trim()) return [];
    const filters: { label: string; value: string }[] = [];
    if (activeFleet.length > 0) filters.push({ label: "Flotte", value: activeFleet.map(displayAxisValue).join(" ou ") });
    if (activeEmplacement.length > 0) filters.push({ label: "Emplacement", value: activeEmplacement.map(displayAxisValue).join(" ou ") });
    if (activePrestataire.length > 0) filters.push({ label: "Prestataire", value: activePrestataire.map(displayAxisValue).join(" ou ") });
    if (activeFlag.length > 0) filters.push({ label: "Flag", value: activeFlag.map(displayAxisValue).join(" ou ") });
    return filters;
  }, [search, activeFleet, activeEmplacement, activePrestataire, activeFlag]);

  function handleExportPdf() {
    downloadBddPdf(searched, activeFilters, search.trim(), setExportingPdf);
  }
  function handleExportExcel() {
    downloadBddExcel(searched, activeFilters, search.trim(), setExportingExcel);
  }

  // Multi-select within each axis (OR), still ANDed across axes — selecting
  // an upstream axis still resets every downstream axis to "TOUS" (empty
  // array), same cascade as the single-select version this replaced: the
  // "visible*" lists (visiblePrestataires/visibleFlags) are computed from
  // whatever's still in scope upstream, so a stale downstream selection
  // could otherwise reference a value no longer reachable.
  function selectFleet(f: Fleet[]) {
    setActiveFleet(f);
    setActiveEmplacement([]);
    setActivePrestataire([]);
    setActiveFlag([]);
  }
  function selectEmplacement(e: string[]) {
    setActiveEmplacement(e);
    setActivePrestataire([]);
    setActiveFlag([]);
  }
  function selectPrestataire(p: string[]) {
    setActivePrestataire(p);
    setActiveFlag([]);
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
        onRefresh={() => refreshMutation.mutateAsync()}
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

        <div className="mt-2">
          <AddBddPlateDialog />
        </div>

        <div className="mt-2 flex items-center gap-1.5 overflow-x-auto">
          <span className="mr-1 flex-shrink-0 text-micro font-bold uppercase text-muted-foreground">Flotte</span>
          <AllChip active={activeFleet.length === 0} onClick={() => selectFleet([])} />
          <ToggleGroup
            type="multiple"
            value={activeFleet}
            onValueChange={(v) => selectFleet(v)}
          >
            {visibleFleetValues.map((f) => (
              <ToggleGroupItem key={f} value={f}>
                {f}
              </ToggleGroupItem>
            ))}
            {hasBlankFleet && (
              <ToggleGroupItem key={NON_RENSEIGNE} value={NON_RENSEIGNE}>
                Non renseigné
              </ToggleGroupItem>
            )}
          </ToggleGroup>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 overflow-x-auto">
          <span className="mr-1 flex-shrink-0 text-micro font-bold uppercase text-muted-foreground">Emplacement</span>
          <AllChip active={activeEmplacement.length === 0} onClick={() => selectEmplacement([])} />
          <ToggleGroup
            type="multiple"
            value={activeEmplacement}
            onValueChange={(v) => selectEmplacement(v)}
          >
            {visibleEmplacements.map((e) => (
              <ToggleGroupItem key={e} value={e}>
                {e}
              </ToggleGroupItem>
            ))}
            {hasBlankEmplacement && (
              <ToggleGroupItem key={NON_RENSEIGNE} value={NON_RENSEIGNE}>
                Non renseigné
              </ToggleGroupItem>
            )}
          </ToggleGroup>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 overflow-x-auto">
          <AllChip active={activePrestataire.length === 0} onClick={() => selectPrestataire([])} />
          <ToggleGroup
            type="multiple"
            value={activePrestataire}
            onValueChange={(v) => selectPrestataire(v)}
          >
            {visiblePrestataires.map((p) => (
              <ToggleGroupItem key={p} value={p}>
                {p}
              </ToggleGroupItem>
            ))}
            {hasBlankPrestataire && (
              <ToggleGroupItem key={NON_RENSEIGNE} value={NON_RENSEIGNE}>
                Non renseigné
              </ToggleGroupItem>
            )}
          </ToggleGroup>
        </div>
        {(visibleFlags.length > 0 || hasBlankFlag) && (
          <div className="mt-1.5 flex items-center gap-1.5 overflow-x-auto">
            <AllChip active={activeFlag.length === 0} onClick={() => setActiveFlag([])} />
            <ToggleGroup
              type="multiple"
              value={activeFlag}
              onValueChange={(v) => setActiveFlag(v)}
            >
              {visibleFlags.map((f) => (
                <ToggleGroupItem key={f} value={f}>
                  {f}
                </ToggleGroupItem>
              ))}
              {hasBlankFlag && (
                <ToggleGroupItem key={NON_RENSEIGNE} value={NON_RENSEIGNE}>
                  Non renseigné
                </ToggleGroupItem>
              )}
            </ToggleGroup>
          </div>
        )}

        <div className="mt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={searched.length === 0 || exportingExcel}
            title={searched.length === 0 ? "Aucune ligne à exporter" : "Exporter la liste filtrée en Excel"}
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-400"
          >
            <DlIcon spinning={exportingExcel} />
            {exportingExcel ? "Génération…" : `Export Excel (${searched.length})`}
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={searched.length === 0 || exportingPdf}
            title={searched.length === 0 ? "Aucune ligne à exporter" : "Exporter la liste filtrée en PDF"}
            className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-800/40 dark:bg-red-950/30 dark:text-red-400"
          >
            <DlIcon spinning={exportingPdf} />
            {exportingPdf ? "Génération…" : `Export PDF (${searched.length})`}
          </button>
        </div>
      </ListPageHeader>

      <div className="px-3 py-3">
        {displayError && (
          <Alert className="mb-3">{displayError}</Alert>
        )}

        {rowsQuery.isPending && <LoadingSkeleton />}

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
