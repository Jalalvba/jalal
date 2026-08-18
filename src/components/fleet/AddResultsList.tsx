import { Badge } from "@/components/ui/badge";
import type { ParkingAddResultItem } from "@/types";

export function AddResultsList({ results }: { results: ParkingAddResultItem[] }) {
  if (results.length === 0) return null;
  return (
    <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-xl border border-border bg-card p-3 text-xs">
      {results.map((r, i) => (
        <div key={i} className="flex items-center justify-between border-b border-border py-0.5 last:border-0">
          <span className="font-mono">{r.imm}</span>
          {r.status === "updated" ? (
            <Badge variant="warning">⚠ Date actualisée (doublon)</Badge>
          ) : r.inParc ? (
            <Badge variant="success">✓ Ajouté (Parc OK)</Badge>
          ) : (
            <Badge variant="error">✗ Ajouté (inconnu Parc)</Badge>
          )}
        </div>
      ))}
    </div>
  );
}
