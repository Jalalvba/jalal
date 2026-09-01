"use client";

import { useCallback, useEffect, useRef } from "react";
import { useEditableState } from "@/hooks/useEditableState";
import { useInlineFieldCommit } from "@/hooks/useInlineFieldCommit";
import { cn } from "@/lib/utils/cn";

/**
 * Always-editable free text (Commentaire) — no tap-to-reveal step, no save
 * button. Commits on blur only if the value actually changed. Unlike the
 * other InlineEdit* components there is no display/editing switch here: the
 * textarea IS the display state.
 */
export function InlineEditText({
  value,
  resyncDeps,
  onCommit,
  placeholder,
  className,
  containerClassName,
  rows = 2,
  autoGrow = false,
}: {
  value: string;
  resyncDeps: React.DependencyList;
  onCommit: (value: string) => Promise<void>;
  placeholder?: string;
  /** Merged onto the textarea's default classes — lets a caller emphasize a
   *  specific field (e.g. a fuchsia font-mono matricule) without forking
   *  this component. */
  className?: string;
  /** Merged onto the wrapper instead of the textarea. A flex/grid parent sizes
   *  the WRAPPER, not the control inside it, so a caller that needs this field
   *  to take the remaining width has to reach the wrapper — putting `flex-1`
   *  on `className` lands it on the textarea, whose own `w-full` then resolves
   *  against a wrapper that stayed at its content width. That is exactly how
   *  Commentaire ended up narrower than the rows above it. */
  containerClassName?: string;
  /** Starting height in rows; with `autoGrow` it is the MINIMUM height. */
  rows?: number;
  /** Grow to fit the content instead of scrolling inside `rows`. Opt-in: the
   *  RDV table's cells and Parking's action field are deliberately uniform, and
   *  a row that changes height as it is typed into would jump the table. */
  autoGrow?: boolean;
}) {
  const [local, setLocal] = useEditableState(value, resyncDeps);
  const { pending, justSaved, error, commit } = useInlineFieldCommit(onCommit);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Measure-then-set: the height must be released before scrollHeight is read,
  // or a shrinking edit keeps the taller previous height forever.
  //
  // The border is added back explicitly. Tailwind's preflight sets
  // box-sizing: border-box, so `height` covers the border, while scrollHeight
  // does not — assigning scrollHeight straight across leaves the box exactly
  // its border-width too short and it still clips, by 2px, which reads as a
  // clipped last line rather than as a bug.
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el || !autoGrow) return;
    el.style.height = "auto";
    const border = el.offsetHeight - el.clientHeight;
    el.style.height = `${el.scrollHeight + border}px`;
  }, [autoGrow]);

  // Runs on mount and whenever the text changes — including a resync from the
  // server (useEditableState) and the reformulated suggestion being accepted,
  // neither of which goes through onChange.
  useEffect(resize, [local, resize]);

  function handleBlur() {
    if (local !== value) commit(local);
  }

  return (
    <div className={containerClassName}>
      <textarea
        ref={ref}
        value={local}
        onChange={(e) => {
          setLocal(e.target.value);
          resize();
        }}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={pending}
        rows={rows}
        className={cn(
          "w-full rounded-lg border bg-muted px-2.5 py-2 text-xs leading-snug text-foreground outline-none transition-colors placeholder:text-muted-foreground disabled:opacity-60",
          autoGrow ? "resize-none overflow-hidden" : "resize-none",
          justSaved ? "border-emerald-500/60" : error ? "border-red-500/60" : "border-border focus:border-amber-500",
          className
        )}
      />
      {error && <div className="mt-1 text-micro text-red-400">{error}</div>}
    </div>
  );
}
