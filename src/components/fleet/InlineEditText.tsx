"use client";

import { useEditableState } from "@/hooks/useEditableState";
import { useInlineFieldCommit } from "@/hooks/useInlineFieldCommit";
import { cn } from "@/lib/utils/cn";

/**
 * Always-editable free text (Commentaire) — no tap-to-reveal step, no save
 * button. Commits on blur only if the value actually changed.
 */
export function InlineEditText({
  value,
  resyncDeps,
  onCommit,
  placeholder,
  className,
  rows = 2,
}: {
  value: string;
  resyncDeps: React.DependencyList;
  onCommit: (value: string) => Promise<void>;
  placeholder?: string;
  /** Merged onto the textarea's default classes — lets a caller emphasize a
   *  specific field (e.g. a fuchsia font-mono matricule) without forking
   *  this component. */
  className?: string;
  rows?: number;
}) {
  const [local, setLocal] = useEditableState(value, resyncDeps);
  const { pending, justSaved, error, commit } = useInlineFieldCommit(onCommit);

  function handleBlur() {
    if (local !== value) commit(local);
  }

  return (
    <div>
      <textarea
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={pending}
        rows={rows}
        className={cn(
          "w-full resize-none rounded-lg border bg-muted px-2.5 py-2 text-xs leading-snug text-foreground outline-none transition-colors placeholder:text-muted-foreground disabled:opacity-60",
          justSaved ? "border-emerald-500/60" : error ? "border-red-500/60" : "border-border focus:border-amber-500",
          className
        )}
      />
      {error && <div className="mt-1 text-micro text-red-400">{error}</div>}
    </div>
  );
}
