"use client";

import { useMemo, useRef, useState } from "react";
import { Trash2, ImageDown, Search, Check } from "lucide-react";
import type { RdvRow, RdvEditableField } from "@/types";
import { RDV_MATRICULE_REGEX, RDV_HEADERS } from "@/types";
import { useSheetFieldOptions } from "@/hooks/useSheetFieldOptions";
import { ZONE_COLORS } from "@/config/zones";
import { ListPageHeader } from "@/components/fleet/ListPageHeader";
import { LoadingSkeleton } from "@/components/fleet/LoadingSkeleton";
import { AddRdvDialog } from "@/components/fleet/AddRdvDialog";
import { InlineEditText } from "@/components/fleet/InlineEditText";
import { InlineEditSelect, type InlineEditTriggerState } from "@/components/fleet/InlineEditSelect";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils/cn";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useRdvRows, useUpdateRdvField, useClearRdvRow, useRefreshRdvRows, rdvRowToIdentity } from "@/hooks/useRdvRows";

// Read-only Date column intentionally not offered here — see
// src/lib/sheets/googleSheetsRdvMonthly.ts's updateAppointmentInMonthlyTab(): editing
// Date in place would be a move to a different day-block (and possibly a
// different monthly tab), materially more than a same-row field write.
// Clear + re-add via AddRdvDialog is the workaround for moving a date.

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** "dd/mm/yyyy" (RdvRow.date's shape) -> "yyyy-mm-dd" (the date picker's shape). */
function toIso(displayDate: string): string {
  const [d, m, y] = displayDate.split("/");
  return `${y}-${m}-${d}`;
}

/** Inverse of toIso — "yyyy-mm-dd" -> "dd/mm/yyyy", for the export image's heading. */
function toDisplayDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function TableCellTrigger({ value, pending, justSaved, error, onOpen }: InlineEditTriggerState) {
  return (
    <div>
      <button
        type="button"
        onClick={onOpen}
        disabled={pending}
        className={cn(
          "w-full rounded-lg border px-2 py-1.5 text-left text-xs transition disabled:opacity-60",
          justSaved
            ? "border-emerald-500/60 bg-emerald-500/5"
            : error
              ? "border-red-500/60 bg-red-500/5"
              : "border-transparent hover:border-border hover:bg-muted"
        )}
      >
        {value ? <span className="text-card-foreground">{value}</span> : <span className="italic text-muted-foreground">—</span>}
      </button>
      {error && <div className="mt-1 text-micro text-red-400">{error}</div>}
    </div>
  );
}

const COLUMNS: { label: string; className?: string }[] = [
  { label: "Heure" },
  { label: "Clients" },
  { label: "Véhicule" },
  { label: "Matricule" },
  { label: "Intervention" },
  { label: "Contact" },
  { label: "Convoyeur" },
  { label: "", className: "w-11" },
];

// Same columns as the live table, minus "Date" (shown once in the title
// bar above, not repeated per-row) and the actions column — this is a
// dedicated plain-markup render for image export, not the interactive
// table (no InlineEdit widgets, no hover states, no delete button), and
// it deliberately doesn't reuse the live table's overflow-x-auto wrapper:
// that wrapper's clipped viewport width is exactly what would get baked
// into the exported image if captured directly, cutting off columns on
// narrow screens. This one is rendered off-screen at its natural width
// instead — see ExportTable/handleExportImage below.
//
// Derived from src/types/index.ts's RDV_HEADERS rather than hand-copied — the
// hand-copied version had already drifted ("Convoyeur" vs the sheet's real
// header text "CONVOYEUR") with no error anywhere. The <td>s below are
// still positional/hand-written (row.heure, row.clients, ... in that
// order) with no compile-time link to this list — if RDV_HEADERS' column
// *order* ever changes, the headers and cells would silently misalign.
// Full field-driven rendering (mapping each header to its RdvRow accessor)
// is a bigger structural change than this pass — flagged here, not fixed.
// Exported so src/lib/__tests__/rdvExportColumns.test.ts can lock in that this
// stays derived (and stays byte-identical to the real sheet header text)
// rather than drifting back into a hand-copied literal.
export const EXPORT_COLUMNS = RDV_HEADERS.filter((h) => h !== "Date");

function ExportTable({ dayRows, dateIso }: { dayRows: RdvRow[]; dateIso: string }) {
  return (
    <div className="inline-block bg-card p-5">
      <div className="mb-3">
        <div className="text-base font-bold text-card-foreground">RDV — {toDisplayDate(dateIso)}</div>
        <div className="text-xs text-muted-foreground">AVIS Maroc</div>
      </div>
      <table className="border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-semibold text-muted-foreground">
            {EXPORT_COLUMNS.map((label) => (
              <th key={label} className="px-3 py-2">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dayRows.map((row) => (
            <tr key={row.rowIndex} className="border-b border-border align-top">
              <td className="min-w-[5rem] px-3 py-2 text-card-foreground">{row.heure || "—"}</td>
              <td className="min-w-[9rem] px-3 py-2 text-card-foreground">{row.clients || "—"}</td>
              <td className="min-w-[9rem] px-3 py-2 text-card-foreground">{row.vehicule || "—"}</td>
              <td className="min-w-[8rem] px-3 py-2 text-card-foreground">{row.matricule || "—"}</td>
              <td className="min-w-[14rem] px-3 py-2 text-card-foreground">{row.intervention || "—"}</td>
              <td className="min-w-[8rem] px-3 py-2 text-card-foreground">{row.contact || "—"}</td>
              <td className="min-w-[9rem] px-3 py-2 text-card-foreground">{row.convoyeur || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Replaces the old per-row trash icon (both table and card layout): selecting
 * an appointment here is what enables the top action bar's "Effacer" button
 * — there is no other per-row delete control anywhere.
 */
function SelectToggle({ selected, onToggle }: { selected: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      title={selected ? "Désélectionner" : "Sélectionner"}
      aria-label={selected ? "Désélectionner" : "Sélectionner"}
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition",
        selected
          ? "border-fuchsia-500 bg-fuchsia-500/15 text-fuchsia-500"
          : "border-border text-muted-foreground hover:border-fuchsia-500/50 hover:text-fuchsia-500"
      )}
    >
      <Check className={cn("h-4 w-4", !selected && "invisible")} />
    </button>
  );
}

/**
 * Stacked mobile card (< sm:), rendered alongside (not instead of) the
 * desktop table — same rows, same InlineEditText/InlineEditSelect wiring, so
 * editing behavior is identical on both layouts; only the arrangement and
 * per-field typography differ. Intervention deliberately keeps this
 * component's default (unstyled) wrapping — no truncation, no fixed height.
 */
function MobileRdvCard({
  row,
  selected,
  onToggleSelect,
  commitField,
  commitMatricule,
}: {
  row: RdvRow;
  selected: boolean;
  onToggleSelect: () => void;
  commitField: (row: RdvRow, field: RdvEditableField) => (value: string) => Promise<void>;
  commitMatricule: (row: RdvRow) => (value: string) => Promise<void>;
}) {
  const { options } = useSheetFieldOptions();
  return (
    <div
      className={cn(
        "rounded-xl border p-3 transition",
        selected ? "border-fuchsia-500 bg-fuchsia-500/5 ring-1 ring-inset ring-fuchsia-500/40" : "border-border bg-card"
      )}
    >
      <div className="mb-2 flex items-start gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <InlineEditText
            value={row.heure}
            resyncDeps={[row.rowIndex, row.heure]}
            onCommit={commitField(row, "Heure")}
            rows={1}
            className="w-16 shrink-0 text-sm font-semibold"
          />
          <InlineEditText
            value={row.matricule}
            resyncDeps={[row.rowIndex, row.matricule]}
            onCommit={commitMatricule(row)}
            rows={1}
            className="min-w-0 flex-1 font-mono text-sm font-semibold text-fuchsia-500"
          />
        </div>
        <SelectToggle selected={selected} onToggle={onToggleSelect} />
      </div>

      <div className="mb-2 flex gap-2 text-muted-foreground">
        <div className="min-w-0 flex-1">
          <InlineEditText
            value={row.clients}
            resyncDeps={[row.rowIndex, row.clients]}
            onCommit={commitField(row, "Clients")}
            rows={1}
            placeholder="Client"
          />
        </div>
        <div className="min-w-0 flex-1">
          <InlineEditText
            value={row.vehicule}
            resyncDeps={[row.rowIndex, row.vehicule]}
            onCommit={commitField(row, "Véhicule")}
            rows={1}
            placeholder="Véhicule"
          />
        </div>
      </div>

      <div className="mb-2 min-w-0">
        <InlineEditText
          value={row.intervention}
          resyncDeps={[row.rowIndex, row.intervention]}
          onCommit={commitField(row, "Intervention")}
          placeholder="Intervention"
        />
      </div>

      <div className="flex min-w-0 gap-2 border-t border-border pt-2">
        <div className="min-w-0 flex-1">
          <InlineEditText
            value={row.contact}
            resyncDeps={[row.rowIndex, row.contact]}
            onCommit={commitField(row, "Contact")}
            rows={1}
            className="text-muted-foreground"
            placeholder="Contact"
          />
        </div>
        <div className="min-w-0 flex-1">
          <InlineEditSelect
            value={row.convoyeur}
            options={options.RDV_CONVOYEURS}
            label="Convoyeur"
            onCommit={commitField(row, "CONVOYEUR")}
            renderTrigger={(state) => <TableCellTrigger {...state} />}
          />
        </div>
      </div>
    </div>
  );
}

export default function RdvPage() {
  const rowsQuery = useRdvRows();
  const updateMutation = useUpdateRdvField();
  const clearMutation = useClearRdvRow();
  const refreshMutation = useRefreshRdvRows();
  const { options } = useSheetFieldOptions();

  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [pageError, setPageError] = useState("");
  const [pageWarning, setPageWarning] = useState("");
  const [exporting, setExporting] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  // The one appointment the top action bar's "Effacer" button acts on — set
  // by tapping a row/card (SelectToggle) or by resolving a plate search to a
  // single appointment. Identified by rowIndex (this flat tab's own row
  // number, unique per appointment) purely for UI selection state; the
  // actual clear/edit mutations never trust it — see commitField/handleClear
  // below, which always re-derive an identity snapshot from the row's own
  // current field values.
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  // Non-null only while the multi-match date-grouped picker is showing.
  const [searchMatches, setSearchMatches] = useState<RdvRow[] | null>(null);

  function flashError(msg: string) {
    setPageError(msg);
    setTimeout(() => setPageError(""), 6000);
  }
  function flashWarning(msg: string) {
    setPageWarning(msg);
    setTimeout(() => setPageWarning(""), 6000);
  }

  const rows = rowsQuery.data ?? [];
  const dayRows = rows.filter((r) => toIso(r.date) === selectedDate);
  const selectedRow = rows.find((r) => r.rowIndex === selectedRowIndex) ?? null;

  const groupedSearchMatches = useMemo(() => {
    if (!searchMatches) return [];
    const map = new Map<string, RdvRow[]>();
    for (const row of searchMatches) {
      const list = map.get(row.date) ?? [];
      list.push(row);
      map.set(row.date, list);
    }
    return Array.from(map.entries());
  }, [searchMatches]);

  function toggleSelect(row: RdvRow) {
    setSelectedRowIndex((cur) => (cur === row.rowIndex ? null : row.rowIndex));
  }

  /** Jumps the date picker to the match's day and selects it there — the day view then renders it with inline editing exactly as any other appointment. */
  function jumpToMatch(row: RdvRow) {
    setSelectedDate(toIso(row.date));
    setSelectedRowIndex(row.rowIndex);
    setSearchMatches(null);
    setSearchTerm("");
  }

  /** Searches ALL loaded appointments (every day, not just the selected one) by plate — the full flat-tab dataset is already in `rows`, so this is a pure client-side filter, no extra request. */
  function runPlateSearch() {
    const term = searchTerm.trim().toUpperCase();
    if (!term) {
      setSearchMatches(null);
      return;
    }
    const matches = rows.filter((r) => r.matricule.includes(term));
    if (matches.length === 0) {
      setSearchMatches(null);
      flashError(`Aucun rendez-vous trouvé pour "${term}".`);
      return;
    }
    if (matches.length === 1) {
      jumpToMatch(matches[0]);
      return;
    }
    setSearchMatches(matches);
  }

  // useUpdateRdvField/useClearRdvRow's fetchJson() already throws on an
  // { ok: false } response (see src/hooks/useRdvRows.ts) — mutateAsync only
  // ever resolves with the `ok: true` variant, so there's no separate
  // "ok: false" branch to handle here beyond the warning field.

  function commitField(row: RdvRow, field: RdvEditableField) {
    return async (value: string) => {
      const identity = rdvRowToIdentity(row);
      const result = await updateMutation.mutateAsync({ identity, field, value });
      if (result.warning) flashWarning(result.warning);
    };
  }

  function commitMatricule(row: RdvRow) {
    return async (value: string) => {
      const trimmed = value.trim().toUpperCase();
      if (!RDV_MATRICULE_REGEX.test(trimmed)) {
        throw new Error('Format Matricule incorrect — exemples valides : "980867WW" ou "79421-B-7".');
      }
      const identity = rdvRowToIdentity(row);
      const result = await updateMutation.mutateAsync({ identity, field: "Matricule", value: trimmed });
      if (result.warning) flashWarning(result.warning);
    };
  }

  async function handleClear(row: RdvRow) {
    try {
      const result = await clearMutation.mutateAsync(rdvRowToIdentity(row));
      setSelectedRowIndex(null);
      if (result.warning) flashWarning(result.warning);
    } catch (e) {
      flashError(e instanceof Error ? e.message : "Erreur réseau");
    }
  }

  async function handleExportImage() {
    if (!exportRef.current || dayRows.length === 0) return;
    setExporting(true);
    try {
      const { toPng } = await import("html-to-image");
      const node = exportRef.current;
      // Bake the current theme's resolved background in explicitly — belt
      // and suspenders against a transparent/broken background in the PNG,
      // on top of the card bg already set via className on the node itself.
      const backgroundColor = getComputedStyle(node).backgroundColor;
      // skipFonts: true — html-to-image otherwise tries to fetch this app's
      // Google Fonts @import to embed it, which the CSP's connect-src blocks
      // (console error, no visual effect since it silently falls back to a
      // system sans-serif either way — confirmed the fallback already reads
      // cleanly, so there's no reason to let it attempt the blocked fetch).
      const dataUrl = await toPng(node, { pixelRatio: 2, cacheBust: true, backgroundColor, skipFonts: true });
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `rdv-${selectedDate}.png`;
      link.click();
    } catch (e) {
      flashError(e instanceof Error ? e.message : "Échec de l'export de l'image");
    } finally {
      setExporting(false);
    }
  }

  const displayError = pageError || (rowsQuery.error instanceof Error ? rowsQuery.error.message : "");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ListPageHeader
        title="RDV"
        subtitle="AVIS Maroc"
        accentClassName={ZONE_COLORS.rdv.accentText}
        countClassName={ZONE_COLORS.rdv.count}
        count={dayRows.length}
        onRefresh={() => refreshMutation.mutateAsync()}
      >
        <div className="flex flex-wrap items-center gap-2">
          <AddRdvDialog />
          <Input
            type="date"
            value={selectedDate}
            onChange={(e) => {
              setSelectedDate(e.target.value);
              setSelectedRowIndex(null);
            }}
            className="max-w-[10rem]"
          />
          <Button
            type="button"
            variant="secondary"
            onClick={handleExportImage}
            disabled={exporting || dayRows.length === 0}
            title="Exporter le tableau du jour en image"
          >
            <ImageDown className="h-4 w-4" />
            {exporting ? "Export…" : "Exporter"}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="destructive"
                disabled={!selectedRow}
                title={selectedRow ? "Effacer le rendez-vous sélectionné" : "Sélectionnez un rendez-vous à effacer"}
              >
                <Trash2 className="h-4 w-4" />
                Effacer
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>Effacer ce rendez-vous ?</AlertDialogTitle>
              <AlertDialogDescription>
                {selectedRow &&
                  `${selectedRow.heure} — ${selectedRow.matricule} — ${selectedRow.clients || "—"}. `}
                Le créneau redevient disponible dans le calendrier mensuel et le miroir rapide. Cette action est
                irréversible.
              </AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogCancel />
                <AlertDialogAction onClick={() => selectedRow && handleClear(selectedRow)}>Effacer</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              if (searchMatches) setSearchMatches(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runPlateSearch();
              }
            }}
            placeholder="Rechercher une plaque sur tous les jours…"
            className="bg-muted/60 pl-10"
          />
        </div>

        {groupedSearchMatches.length > 0 && (
          <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-micro text-muted-foreground">
              <span>{searchMatches?.length} rendez-vous trouvés — choisissez-en un</span>
              <button type="button" onClick={() => setSearchMatches(null)} className="text-muted-foreground hover:text-foreground">
                Fermer
              </button>
            </div>
            {groupedSearchMatches.map(([date, group]) => (
              <div key={date}>
                <div className="bg-muted px-3 py-1 text-micro font-semibold text-muted-foreground">{date}</div>
                {group.map((row) => (
                  <button
                    key={row.rowIndex}
                    type="button"
                    onClick={() => jumpToMatch(row)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-muted"
                  >
                    <span className="font-mono text-fuchsia-500">{row.matricule}</span>
                    <span className="truncate text-muted-foreground">
                      {row.heure} — {row.clients || "—"}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </ListPageHeader>

      <div className="px-3 py-3">
        {displayError && <Alert className="mb-3">{displayError}</Alert>}
        {pageWarning && (
          <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            {pageWarning}
          </div>
        )}

        {rowsQuery.isPending && <LoadingSkeleton />}

        {!rowsQuery.isPending && dayRows.length === 0 && !displayError && (
          <div className="py-16 text-center text-sm text-muted-foreground">Aucun rendez-vous pour cette date</div>
        )}

        {dayRows.length > 0 && (
          <>
            {/* Mobile (<640px): stacked cards, one per appointment. */}
            <div className="space-y-2 sm:hidden">
              {dayRows.map((row) => (
                <MobileRdvCard
                  key={row.rowIndex}
                  row={row}
                  selected={selectedRowIndex === row.rowIndex}
                  onToggleSelect={() => toggleSelect(row)}
                  commitField={commitField}
                  commitMatricule={commitMatricule}
                />
              ))}
            </div>

            {/* Desktop (>=640px): the original multi-column table. */}
            <div className="hidden overflow-x-auto rounded-xl border border-border sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted text-left text-xs font-semibold text-muted-foreground border-b border-border">
                    {COLUMNS.map((c) => (
                      <th key={c.label || "actions"} className={cn("px-3 py-2 whitespace-nowrap", c.className)}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {dayRows.map((row) => {
                    const isSelected = selectedRowIndex === row.rowIndex;
                    return (
                      <tr key={row.rowIndex} className={cn("hover:bg-muted align-top", isSelected && "bg-fuchsia-500/5")}>
                        <td className="px-3 py-2 min-w-[5rem]">
                          <InlineEditText value={row.heure} resyncDeps={[row.rowIndex, row.heure]} onCommit={commitField(row, "Heure")} />
                        </td>
                        <td className="px-3 py-2 min-w-[9rem]">
                          <InlineEditText value={row.clients} resyncDeps={[row.rowIndex, row.clients]} onCommit={commitField(row, "Clients")} />
                        </td>
                        <td className="px-3 py-2 min-w-[9rem]">
                          <InlineEditText value={row.vehicule} resyncDeps={[row.rowIndex, row.vehicule]} onCommit={commitField(row, "Véhicule")} />
                        </td>
                        <td className="px-3 py-2 min-w-[8rem]">
                          <InlineEditText
                            value={row.matricule}
                            resyncDeps={[row.rowIndex, row.matricule]}
                            onCommit={commitMatricule(row)}
                            className="font-mono text-fuchsia-500"
                          />
                        </td>
                        <td className="px-3 py-2 min-w-[14rem]">
                          <InlineEditText value={row.intervention} resyncDeps={[row.rowIndex, row.intervention]} onCommit={commitField(row, "Intervention")} />
                        </td>
                        <td className="px-3 py-2 min-w-[8rem]">
                          <InlineEditText value={row.contact} resyncDeps={[row.rowIndex, row.contact]} onCommit={commitField(row, "Contact")} />
                        </td>
                        <td className="px-3 py-2 min-w-[9rem]">
                          <InlineEditSelect
                            value={row.convoyeur}
                            options={options.RDV_CONVOYEURS}
                            label="Convoyeur"
                            onCommit={commitField(row, "CONVOYEUR")}
                            renderTrigger={(state) => <TableCellTrigger {...state} />}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <SelectToggle selected={isSelected} onToggle={() => toggleSelect(row)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {dayRows.length > 0 && (
        // Rendered off-screen (not display:none/visibility:hidden — either
        // would be cloned verbatim into the captured image and produce a
        // blank PNG) purely so html-to-image can measure and capture it at
        // its own natural, unclipped size regardless of viewport width.
        // w-max is load-bearing, not cosmetic: a `position: fixed` box with
        // only `left` set and `width: auto` resolves its width via
        // shrink-to-fit bounded by the *viewport* width (confirmed via
        // testing — the exported image came out narrower on a 375px mobile
        // viewport than on desktop, despite being translated off-screen).
        // width: max-content bypasses that, sizing to the content's own
        // intrinsic width regardless of viewport.
        <div aria-hidden="true" className="pointer-events-none fixed left-0 top-0 w-max" style={{ transform: "translate(-10000px, 0)" }}>
          <div ref={exportRef}>
            <ExportTable dayRows={dayRows} dateIso={selectedDate} />
          </div>
        </div>
      )}
    </div>
  );
}
