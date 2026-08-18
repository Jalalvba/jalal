// Shared list-loading placeholder — originally DS History's inline
// skeleton (a title bar + N pulsing blocks), extracted so every list page
// (Parking/Atelier/Depot/RDV/Suivi RL) shows the same considered loading
// state instead of a plain "Chargement…" text flash.
export function LoadingSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="h-5 w-48 animate-pulse rounded-lg bg-muted" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    </div>
  );
}
