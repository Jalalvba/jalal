"use client";

import { useRef, useState } from "react";
import { Combobox } from "@/components/ui/combobox";
import { useInlineFieldCommit } from "@/hooks/useInlineFieldCommit";
import type { InlineEditTriggerState } from "@/components/fleet/InlineEditSelect";

/**
 * Tap the compact trigger -> reveals the shared Combobox (free text +
 * suggestions, auto-focused) in its place -> pick a suggestion or blur with
 * changed text -> commits and collapses back to the trigger. Prestataire was
 * always free text with suggestions (never a hard enum, unlike ÉTAT/FLAG/
 * CATÉGORIE/TECHNICIEN), so this stays typeable rather than sheet-picker-only.
 */
export function InlineEditCombobox({
  value,
  options,
  onCommit,
  renderTrigger,
  placeholder,
}: {
  value: string;
  options: string[];
  onCommit: (value: string) => Promise<void>;
  renderTrigger: (state: InlineEditTriggerState) => React.ReactNode;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const { pending, justSaved, error, commit } = useInlineFieldCommit(onCommit);
  const justSelectedRef = useRef(false);

  // Show the full list until the user actually types something — otherwise
  // opening the combobox pre-fills `text` with the current value, which
  // would immediately self-filter the suggestions down to just that one
  // entry (e.g. opening on "SCAL" would only ever suggest "SCAL").
  const filtered = text === value
    ? options
    : options.filter((o) => o.toLowerCase().includes(text.trim().toLowerCase()));

  function startEditing() {
    setText(value);
    setEditing(true);
    setOpen(true);
  }

  function finishAndCommit(next: string) {
    setEditing(false);
    setOpen(false);
    if (next !== value) commit(next);
  }

  function handleSelect(option: string) {
    justSelectedRef.current = true;
    finishAndCommit(option);
  }

  function handleContainerBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    if (justSelectedRef.current) {
      justSelectedRef.current = false;
      return;
    }
    finishAndCommit(text.trim());
  }

  if (!editing) {
    return renderTrigger({ value, pending, justSaved, error, onOpen: startEditing });
  }

  return (
    <div onBlur={handleContainerBlur}>
      <Combobox
        value={text}
        onValueChange={(v) => {
          setText(v);
          setOpen(true);
        }}
        open={open}
        onOpenChange={setOpen}
        options={filtered}
        onSelect={handleSelect}
        placeholder={placeholder}
        autoFocus
        inputClassName="h-10 text-xs"
        onKeyDownCapture={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            finishAndCommit(text.trim());
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
            setOpen(false);
          }
        }}
      />
    </div>
  );
}
