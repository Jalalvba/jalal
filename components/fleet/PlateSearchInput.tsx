"use client";

import { useState } from "react";
import { Combobox } from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import { usePlateAutocomplete } from "@/hooks/usePlateAutocomplete";

/**
 * Shared comma-separated plate-add input with autocomplete on the trailing
 * token — Parking's and Atelier's add-input were identical except for the
 * accent color. Enter submits directly when no suggestion list is showing
 * (matching the original behavior exactly); when suggestions ARE showing,
 * cmdk's own keyboard navigation takes over (arrow keys + Enter-to-select),
 * which neither original hand-rolled version had — only click-to-select did.
 */
export function PlateSearchInput({
  value,
  onChange,
  immList,
  onSubmit,
  submitting,
  accentBorderClassName,
  accentButtonClassName,
  placeholder = "Immatriculation(s), séparées par virgule — ex: 48070, 832223WW",
}: {
  value: string;
  onChange: (v: string) => void;
  immList: string[];
  onSubmit: () => void;
  submitting: boolean;
  accentBorderClassName: string;
  accentButtonClassName: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const { suggestions, applySelection } = usePlateAutocomplete(value, immList);

  function selectSuggestion(selected: string) {
    onChange(applySelection(selected));
    setOpen(false);
  }

  return (
    <div>
      <Combobox
        value={value}
        onValueChange={(v) => {
          onChange(v);
          setOpen(true);
        }}
        open={open}
        onOpenChange={setOpen}
        options={suggestions}
        onSelect={selectSuggestion}
        placeholder={placeholder}
        inputClassName={`border-2 ${accentBorderClassName}`}
        onKeyDownCapture={(e) => {
          if (e.key === "Enter" && suggestions.length === 0) {
            e.preventDefault();
            setOpen(false);
            onSubmit();
          }
        }}
      />
      <Button
        type="button"
        onClick={onSubmit}
        disabled={submitting || !value.trim()}
        className={`mt-2 h-10 w-full font-bold text-white ${accentButtonClassName}`}
      >
        {submitting ? "Traitement…" : "➕ Ajouter / Actualiser"}
      </Button>
    </div>
  );
}
