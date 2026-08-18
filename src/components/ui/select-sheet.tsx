"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check } from "lucide-react";

/**
 * Bottom-anchored option picker for short fixed enums (ÉTAT/FLAG/CATÉGORIE/
 * TECHNICIEN on the Suivi RL card) — tap the field, sheet slides up, tap an
 * option, it closes and commits. Not a search/typeahead (that's Combobox);
 * this is a plain tap-to-select list, matching how a native mobile picker
 * behaves.
 *
 * No tailwindcss-animate plugin in this project (src/components/ui/alert-dialog.tsx's
 * animate-in/fade-in classes are actually inert here, pre-existing and out of
 * scope to fix) — the slide/fade below use plain Tailwind transform+opacity
 * transitions gated on Radix's data-state, which work without a plugin.
 */
export function SelectSheet({
  open,
  onOpenChange,
  title,
  options,
  value,
  onSelect,
  clearLabel = "— Aucun —",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  options: string[];
  value: string;
  onSelect: (option: string) => void;
  clearLabel?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-black/70 opacity-0 transition-opacity duration-200 data-[state=open]:opacity-100"
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 max-h-[75vh] translate-y-full overflow-y-auto rounded-t-2xl border-t border-border bg-popover shadow-2xl outline-none transition-transform duration-200 data-[state=open]:translate-y-0"
        >
          <DialogPrimitive.Title className="sticky top-0 border-b border-border bg-popover px-4 py-3 text-sm font-semibold text-popover-foreground">
            {title}
          </DialogPrimitive.Title>
          <div className="flex flex-col py-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={() => onSelect("")}
              className="flex h-12 flex-shrink-0 items-center justify-between px-4 text-left text-sm italic text-muted-foreground active:bg-muted"
            >
              {clearLabel}
              {value === "" && <Check className="h-4 w-4 flex-shrink-0 text-amber-400" />}
            </button>
            {options.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onSelect(option)}
                className="flex h-12 flex-shrink-0 items-center justify-between gap-2 px-4 text-left text-sm text-popover-foreground active:bg-muted"
              >
                <span className="truncate">{option}</span>
                {value === option && <Check className="h-4 w-4 flex-shrink-0 text-amber-400" />}
              </button>
            ))}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
