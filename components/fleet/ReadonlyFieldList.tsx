/**
 * Dimmed, populated-only list of read-only reference fields — no background,
 * no edit affordance, visually de-emphasized from the editable fields above
 * it. Same treatment originally built for Suivi RL's BddCard, extracted here
 * so Parking/Atelier's cards can reuse it instead of re-implementing it.
 */
export function ReadonlyFieldList({ fields }: { fields: { label: string; value: string }[] }) {
  const populated = fields.filter((f) => f.value.trim());
  if (populated.length === 0) return null;

  return (
    <div className="mt-2 flex flex-col gap-1 border-t border-zinc-800/60 pt-2">
      {populated.map((f) => (
        <div key={f.label} className="whitespace-pre-line text-[11px] leading-snug text-zinc-500">
          <span className="mr-1 text-[9px] font-bold uppercase text-zinc-600">{f.label}:</span>
          {f.value}
        </div>
      ))}
    </div>
  );
}
