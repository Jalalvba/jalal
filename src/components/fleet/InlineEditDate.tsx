"use client";

import { Input } from "@/components/ui/input";
import { useEditableState } from "@/hooks/useEditableState";
import { useInlineFieldCommit } from "@/hooks/useInlineFieldCommit";
import { cn } from "@/lib/utils/cn";
import { displayDateToIso } from "@/lib/utils/sheetDate";

/**
 * Always-editable date field (Délai) — the date-shaped sibling of
 * InlineEditText, sharing its useEditableState + useInlineFieldCommit
 * machinery so the pending/justSaved/error behavior has one implementation.
 *
 * Deliberately an `<input type="date">` (the same native picker /rdv and
 * AddRdvDialog already use) rather than a text field or a dropdown: the
 * column is a real date on the sheet side, with GAS-side date validation on
 * it, so a free-typed "15/9" or a stale dropdown option would be a value the
 * sheet refuses.
 *
 * `value` arrives as the dd/mm/yyyy the BDD reader produces; the input needs
 * yyyy-mm-dd, and yyyy-mm-dd is what onCommit emits — the server converts
 * that to a real date serial (see updateSheetRow).
 */
export function InlineEditDate({
  value,
  resyncDeps,
  onCommit,
  className,
}: {
  value: string;
  resyncDeps: React.DependencyList;
  onCommit: (value: string) => Promise<void>;
  className?: string;
}) {
  const iso = displayDateToIso(value);
  const [local, setLocal] = useEditableState(iso, resyncDeps);
  const { pending, justSaved, error, commit } = useInlineFieldCommit(onCommit);

  return (
    <div>
      <Input
        type="date"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          if (local !== iso) commit(local);
        }}
        disabled={pending}
        className={cn(
          "h-8 text-xs",
          justSaved ? "border-emerald-500/60" : error ? "border-red-500/60" : undefined,
          className
        )}
      />
      {error && <div className="mt-1 text-micro text-red-400">{error}</div>}
    </div>
  );
}
