/**
 * Dimmed, populated-only list of read-only reference fields — no background,
 * no edit affordance, visually de-emphasized from the editable fields above
 * it. Same treatment originally built for Suivi RL's BddCard, extracted here
 * so Parking/Atelier's cards can reuse it instead of re-implementing it.
 *
 * `title`, when given, renders a small uppercase label above the list —
 * lets a card render two of these back to back (e.g. general reference
 * fields vs. a distinctly-sourced "automated zone detection" block) without
 * the two blending together.
 */
export function ReadonlyFieldList({ fields, title }: { fields: { label: string; value: string }[]; title?: string }) {
  // String(... ?? "") rather than f.value.trim(): the values come from network
  // payloads whose declared types describe the current server, not the deploy
  // (or the persisted client cache) that produced the row in hand. A column
  // added after a cache entry was written arrives as undefined here and used to
  // throw, taking the whole list down with it.
  const populated = fields.filter((f) => String(f.value ?? "").trim());
  if (populated.length === 0) return null;

  return (
    <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
      {title && <div className="text-micro font-bold uppercase tracking-wide text-muted-foreground/70">{title}</div>}
      {populated.map((f) => (
        <div key={f.label} className="whitespace-pre-line text-micro leading-snug text-muted-foreground">
          <span className="mr-1 text-micro font-bold uppercase text-muted-foreground">{f.label}:</span>
          {String(f.value ?? "")}
        </div>
      ))}
    </div>
  );
}
