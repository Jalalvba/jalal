"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { cn } from "@/components/ui/utils";

/**
 * A text input with a suggestion dropdown underneath it, keyboard-navigable
 * (arrow keys + enter) via cmdk — the shared primitive behind every
 * plate-autocomplete in the app (Parking's and Atelier's comma-separated
 * add-input, DS History's single-plate smart search, Suivi RL's prestataire
 * field). None of those had arrow-key navigation before; only Enter-to-submit
 * was wired up by hand.
 *
 * Deliberately does NOT do its own filtering (`shouldFilter={false}`) —
 * each page computes its own filtered `options` list because their matching
 * rules genuinely differ (Parking/Atelier match only the trailing
 * comma-token via a stripped-alnum prefix; DS History debounces a remote
 * search; Suivi RL matches the whole field against a static list). This
 * component only owns the dropdown/keyboard-nav/selection UI, not the
 * matching logic.
 */
export function Combobox({
  value,
  onValueChange,
  open,
  onOpenChange,
  options,
  onSelect,
  loading,
  emptyMessage,
  placeholder,
  inputClassName,
  className,
  onKeyDownCapture,
  autoFocus,
  inputMode,
}: {
  value: string;
  onValueChange: (v: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: string[];
  onSelect: (option: string) => void;
  loading?: boolean;
  emptyMessage?: string;
  placeholder?: string;
  inputClassName?: string;
  className?: string;
  onKeyDownCapture?: React.KeyboardEventHandler<HTMLInputElement>;
  autoFocus?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  const showList = open && (loading || options.length > 0 || !!emptyMessage);

  return (
    <CommandPrimitive shouldFilter={false} className={cn("relative overflow-visible", className)}>
      <CommandPrimitive.Input
        value={value}
        onValueChange={onValueChange}
        onFocus={() => onOpenChange(true)}
        onKeyDownCapture={onKeyDownCapture}
        placeholder={placeholder}
        autoFocus={autoFocus}
        inputMode={inputMode}
        autoComplete="off"
        className={cn(
          "h-11 w-full rounded-xl border border-border bg-input px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-zinc-500",
          inputClassName
        )}
      />
      {showList && (
        <CommandPrimitive.List className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-border bg-popover shadow-2xl">
          {loading && <div className="px-4 py-3 text-xs text-muted-foreground">Recherche…</div>}
          {!loading && options.length === 0 && emptyMessage && (
            <CommandPrimitive.Empty className="px-4 py-3 text-xs text-muted-foreground">
              {emptyMessage}
            </CommandPrimitive.Empty>
          )}
          {!loading &&
            options.map((option) => (
              <CommandPrimitive.Item
                key={option}
                value={option}
                onSelect={() => onSelect(option)}
                className="cursor-pointer border-b border-border px-4 py-2.5 font-mono text-sm font-semibold tracking-wide text-popover-foreground last:border-0 data-[selected=true]:bg-muted"
              >
                {option}
              </CommandPrimitive.Item>
            ))}
        </CommandPrimitive.List>
      )}
    </CommandPrimitive>
  );
}
