"use client";

import { useState } from "react";
import { SelectSheet } from "@/components/ui/select-sheet";
import { useInlineFieldCommit } from "@/hooks/useInlineFieldCommit";

export type InlineEditTriggerState = {
  value: string;
  pending: boolean;
  justSaved: boolean;
  error: string;
  onOpen: () => void;
};

/**
 * Tap the trigger -> bottom SelectSheet opens -> tap an option -> commits
 * immediately and closes. No confirm step. The trigger's exact look (badge,
 * labeled row, ghost placeholder chip) is fully up to the caller — this
 * component only owns the sheet + commit-state wiring, reused across
 * ÉTAT/FLAG/CATÉGORIE/TECHNICIEN on the Suivi RL card.
 */
export function InlineEditSelect({
  value,
  options,
  label,
  onCommit,
  renderTrigger,
}: {
  value: string;
  options: string[];
  label: string;
  onCommit: (value: string) => Promise<void>;
  renderTrigger: (state: InlineEditTriggerState) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { pending, justSaved, error, commit } = useInlineFieldCommit(onCommit);

  function handleSelect(option: string) {
    setOpen(false);
    if (option !== value) commit(option);
  }

  return (
    <>
      {renderTrigger({ value, pending, justSaved, error, onOpen: () => setOpen(true) })}
      <SelectSheet open={open} onOpenChange={setOpen} title={label} options={options} value={value} onSelect={handleSelect} />
    </>
  );
}
