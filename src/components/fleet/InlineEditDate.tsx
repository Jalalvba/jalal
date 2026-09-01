"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useInlineFieldCommit } from "@/hooks/useInlineFieldCommit";
import { displayDateToIso } from "@/lib/utils/sheetDate";
import type { InlineEditTriggerState } from "@/components/fleet/InlineEditSelect";

/**
 * Tap the compact trigger -> reveals a native date input (auto-focused) in
 * its place -> pick a date or blur with a changed value -> commits and
 * collapses back to the trigger. Structurally identical to
 * InlineEditCombobox: same editing/display switch, same renderTrigger
 * contract, same useInlineFieldCommit state, so Délai reads as one of the
 * labeled rows next to Emplacement and Prestataire rather than a loose
 * control sitting on the card.
 *
 * The trigger shows the dd/mm/yyyy the BDD reader already produces — the
 * yyyy-mm-dd the `<input type="date">` speaks never reaches the display
 * state. onCommit emits yyyy-mm-dd; the server turns that into a real date
 * serial (see updateSheetRow).
 */
export function InlineEditDate({
  value,
  onCommit,
  renderTrigger,
}: {
  value: string;
  onCommit: (value: string) => Promise<void>;
  renderTrigger: (state: InlineEditTriggerState) => React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [iso, setIso] = useState("");
  const { pending, justSaved, error, commit } = useInlineFieldCommit(onCommit);

  function startEditing() {
    setIso(displayDateToIso(value));
    setEditing(true);
  }

  function finishAndCommit(next: string) {
    setEditing(false);
    if (next !== displayDateToIso(value)) commit(next);
  }

  if (!editing) {
    return renderTrigger({ value, pending, justSaved, error, onOpen: startEditing });
  }

  return (
    <Input
      type="date"
      autoFocus
      value={iso}
      onChange={(e) => setIso(e.target.value)}
      onBlur={() => finishAndCommit(iso)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finishAndCommit(iso);
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setEditing(false);
        }
      }}
      className="h-10 text-xs"
    />
  );
}
