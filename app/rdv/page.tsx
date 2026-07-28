"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import type { RdvRow } from "@/lib/types";
import { ZONE_COLORS } from "@/lib/constants/zones";
import { ListPageHeader } from "@/components/fleet/ListPageHeader";
import { RecordCard } from "@/components/fleet/RecordCard";
import { Field } from "@/components/fleet/Field";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { AddRdvDialog } from "@/components/fleet/AddRdvDialog";
import { useRdvRows } from "@/hooks/useRdvRows";

// Read + add only, deliberately: updateRdvField/deleteRdvRow (pre-existing)
// only touch the flat "RDV" mirror tab, not the monthly calendar tab that's
// now the durable source (see lib/googleSheetsRdvMonthly.ts) — wiring edit/
// delete into this page would silently reintroduce the two-tab
// inconsistency this feature was built to avoid on the add path. Out of
// scope for this pass; the card is intentionally non-interactive besides
// viewing.

function RdvCard({ row }: { row: RdvRow }) {
  return (
    <RecordCard
      imm={row.matricule || "—"}
      subtitle={[row.clients, row.vehicule].filter(Boolean).join(" — ")}
      timestamp={[row.date, row.heure].filter(Boolean).join(" ")}
    >
      <Field label="Intervention">
        <p className="text-sm text-card-foreground">{row.intervention || "—"}</p>
      </Field>
      <div className="grid grid-cols-2 gap-3 text-micro text-muted-foreground">
        <div>
          <span className="font-bold uppercase">Contact</span>
          <div className="text-card-foreground">{row.contact || "—"}</div>
        </div>
        <div>
          <span className="font-bold uppercase">Convoyeur</span>
          <div className="text-card-foreground">{row.convoyeur || "—"}</div>
        </div>
      </div>
    </RecordCard>
  );
}

export default function RdvPage() {
  const rowsQuery = useRdvRows();
  const [search, setSearch] = useState("");

  const rows = rowsQuery.data ?? [];
  const searched = (() => {
    const term = search.trim().toUpperCase();
    if (!term) return rows;
    return rows.filter(
      (r) => r.matricule.includes(term) || r.clients.toUpperCase().includes(term) || r.vehicule.toUpperCase().includes(term)
    );
  })();

  const displayError = rowsQuery.error instanceof Error ? rowsQuery.error.message : "";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ListPageHeader
        title="RDV"
        subtitle="AVIS Maroc"
        accentClassName={ZONE_COLORS.rdv.accentText}
        countClassName={ZONE_COLORS.rdv.count}
        count={searched.length}
        onRefresh={() => rowsQuery.refetch()}
      >
        <div className="flex flex-wrap items-center gap-2">
          <AddRdvDialog />
        </div>

        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par matricule, client, véhicule…"
            className="bg-muted/60 pl-10"
          />
        </div>
      </ListPageHeader>

      <div className="px-3 py-3">
        {displayError && <Alert className="mb-3">{displayError}</Alert>}

        {rowsQuery.isPending && <div className="py-16 text-center text-sm text-muted-foreground">Chargement…</div>}

        {!rowsQuery.isPending && searched.length === 0 && !displayError && (
          <div className="py-16 text-center text-sm text-muted-foreground">Aucun rendez-vous</div>
        )}

        <div className="flex flex-col gap-2.5">
          {searched.map((row) => (
            <RdvCard key={row.rowIndex} row={row} />
          ))}
        </div>
      </div>
    </div>
  );
}
