"use client";

import { useRef, useState } from "react";
import { Trash2, ImageDown } from "lucide-react";
import type { RdvRow, RdvEditableField } from "@/lib/types";
import { RDV_CONVOYEURS, RDV_MATRICULE_REGEX } from "@/lib/types";
import { ZONE_COLORS } from "@/lib/constants/zones";
import { ListPageHeader } from "@/components/fleet/ListPageHeader";
import { AddRdvDialog } from "@/components/fleet/AddRdvDialog";
import { InlineEditText } from "@/components/fleet/InlineEditText";
import { InlineEditSelect, type InlineEditTriggerState } from "@/components/fleet/InlineEditSelect";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/components/ui/utils";
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
import { useRdvRows, useUpdateRdvField, useClearRdvRow, rdvRowToIdentity } from "@/hooks/useRdvRows";

// Read-only Date column intentionally not offered here — see
// lib/googleSheetsRdvMonthly.ts's updateAppointmentInMonthlyTab(): editing
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

// Same columns as the live table, minus the actions column — this is a
// dedicated plain-markup render for image export, not the interactive
// table (no InlineEdit widgets, no hover states, no delete button), and
// it deliberately doesn't reuse the live table's overflow-x-auto wrapper:
// that wrapper's clipped viewport width is exactly what would get baked
// into the exported image if captured directly, cutting off columns on
// narrow screens. This one is rendered off-screen at its natural width
// instead — see ExportTable/handleExportImage below.
const EXPORT_COLUMNS = ["Heure", "Clients", "Véhicule", "Matricule", "Intervention", "Contact", "Convoyeur"];

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

export default function RdvPage() {
  const rowsQuery = useRdvRows();
  const updateMutation = useUpdateRdvField();
  const clearMutation = useClearRdvRow();

  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [pageError, setPageError] = useState("");
  const [pageWarning, setPageWarning] = useState("");
  const [exporting, setExporting] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

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

  // useUpdateRdvField/useClearRdvRow's fetchJson() already throws on an
  // { ok: false } response (see hooks/useRdvRows.ts) — mutateAsync only
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
        onRefresh={() => rowsQuery.refetch()}
      >
        <div className="flex flex-wrap items-center gap-2">
          <AddRdvDialog />
          <Input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="max-w-[10rem]" />
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
        </div>
      </ListPageHeader>

      <div className="px-3 py-3">
        {displayError && <Alert className="mb-3">{displayError}</Alert>}
        {pageWarning && (
          <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            {pageWarning}
          </div>
        )}

        {rowsQuery.isPending && <div className="py-16 text-center text-sm text-muted-foreground">Chargement…</div>}

        {!rowsQuery.isPending && dayRows.length === 0 && !displayError && (
          <div className="py-16 text-center text-sm text-muted-foreground">Aucun rendez-vous pour cette date</div>
        )}

        {dayRows.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-border">
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
                {dayRows.map((row) => (
                  <tr key={row.rowIndex} className="hover:bg-muted align-top">
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
                      <InlineEditText value={row.matricule} resyncDeps={[row.rowIndex, row.matricule]} onCommit={commitMatricule(row)} />
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
                        options={[...RDV_CONVOYEURS]}
                        label="Convoyeur"
                        onCommit={commitField(row, "CONVOYEUR")}
                        renderTrigger={(state) => <TableCellTrigger {...state} />}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button type="button" variant="ghost" size="icon" className="hover:bg-red-500/10 hover:text-red-400" title="Effacer">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogTitle>Effacer ce rendez-vous ?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Le créneau redevient disponible dans le calendrier mensuel et le miroir rapide. Cette action est
                            irréversible.
                          </AlertDialogDescription>
                          <AlertDialogFooter>
                            <AlertDialogCancel />
                            <AlertDialogAction onClick={() => handleClear(row)}>Effacer</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
