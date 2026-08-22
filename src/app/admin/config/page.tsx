"use client";

import { useState } from "react";
import { X, Plus } from "lucide-react";
import {
  PALETTE_COLORS,
  DOT_COLOR_CLASSES,
  OPTION_LABELS,
  OPTION_KEYS,
  COLORED_OPTION_KEYS,
  type OptionKey,
  type ColoredOption,
  type PaletteColor,
} from "@/types";
import { useSheetFieldOptions, useUpdateSheetFieldOptions } from "@/hooks/useSheetFieldOptions";
import { ListPageHeader } from "@/components/fleet/ListPageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils/cn";

// ─── /admin/config — Stage 1 of the config-driven sheet-structure proposal
// (config-proposal artifact, 2026-08-06). Edits the 7 Mongo-backed
// sheetFieldOptions documents; every add/remove commits immediately (no
// "Save" button) — same "no card save button, per-field inline commit"
// convention BDD/Atelier/Parking already use throughout this app, applied
// here to option *lists* instead of a single row's fields.

// Derived from src/types/index.ts's OPTION_KEYS/COLORED_OPTION_KEYS rather than
// hand-copied — a hand-copied pair of arrays here compiled fine (both typed
// as the non-exhaustive OptionKey[]) but silently dropped any key added to
// OPTION_KEYS in the future from ever rendering on this page, with no error
// anywhere (audit finding I4). Deriving means a new key is either editable
// here automatically (if plain) or needs one line added to
// COLORED_OPTION_KEYS in src/types/index.ts to route it to the colored variant —
// there's no third, silently-invisible path anymore.
// Exported (not just module-local) so src/lib/__tests__/adminConfigKeys.test.ts
// can assert every key in OPTION_KEYS is reachable through one of these two
// lists — a compile-time-adjacent guard against this exact drift recurring,
// per the audit's I4 finding.
export const COLORED_KEYS: OptionKey[] = [...COLORED_OPTION_KEYS];
export const PLAIN_KEYS: OptionKey[] = OPTION_KEYS.filter((k) => !(COLORED_OPTION_KEYS as readonly OptionKey[]).includes(k));

function ChipButton({
  children,
  onRemove,
  dotColor,
  disabled,
}: {
  children: React.ReactNode;
  onRemove: () => void;
  dotColor?: PaletteColor | null;
  disabled?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-1 pl-3 pr-1.5 text-micro font-medium text-foreground">
      {dotColor !== undefined && (
        <span className={cn("h-2 w-2 rounded-full", dotColor ? DOT_COLOR_CLASSES[dotColor] : "border border-dashed border-muted-foreground")} />
      )}
      {children}
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="rounded-full p-0.5 text-muted-foreground transition hover:bg-red-500/10 hover:text-red-400 disabled:pointer-events-none disabled:opacity-40"
        title="Retirer"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function ColorSwatchPicker({ value, onChange, allowNone }: { value: PaletteColor | null; onChange: (c: PaletteColor | null) => void; allowNone: boolean }) {
  return (
    <div className="flex items-center gap-1">
      {allowNone && (
        <button
          type="button"
          onClick={() => onChange(null)}
          title="Aucune couleur"
          className={cn(
            "h-6 w-6 rounded-full border-2 border-dashed",
            value === null ? "border-foreground" : "border-muted-foreground/40"
          )}
        />
      )}
      {PALETTE_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          title={c}
          className={cn("h-6 w-6 rounded-full border-2", DOT_COLOR_CLASSES[c], value === c ? "border-foreground" : "border-transparent")}
        />
      ))}
    </div>
  );
}

function SectionCard({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <span className="rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-micro text-muted-foreground">{count}</span>
      </div>
      {children}
    </div>
  );
}

function PlainOptionSet({
  optionKey,
  values,
  onSave,
  pending,
  disabled,
}: {
  optionKey: OptionKey;
  values: string[];
  onSave: (next: string[]) => Promise<void>;
  pending: boolean;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState("");

  async function add() {
    const v = draft.trim();
    if (!v) return;
    if (values.includes(v)) {
      setLocalError(`"${v}" existe déjà.`);
      return;
    }
    setLocalError("");
    await onSave([...values, v]);
    setDraft("");
  }

  async function remove(v: string) {
    setLocalError("");
    await onSave(values.filter((x) => x !== v));
  }

  return (
    <SectionCard title={OPTION_LABELS[optionKey]} count={values.length}>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => (
          <ChipButton key={v} onRemove={() => remove(v)} disabled={disabled || pending}>
            {v}
          </ChipButton>
        ))}
        {values.length === 0 && <span className="text-micro text-muted-foreground">Aucune valeur.</span>}
      </div>
      <div className="mt-3 flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Nouvelle valeur…"
          className="h-9 flex-1 text-sm"
          disabled={disabled}
        />
        <Button type="button" size="sm" onClick={add} disabled={disabled || pending || !draft.trim()}>
          <Plus className="h-3.5 w-3.5" /> Ajouter
        </Button>
      </div>
      {localError && <p className="mt-1.5 text-micro text-red-400">{localError}</p>}
    </SectionCard>
  );
}

function ColoredOptionSet({
  optionKey,
  values,
  onSave,
  pending,
  allowNoneColor,
  disabled,
}: {
  optionKey: OptionKey;
  values: ColoredOption[];
  onSave: (next: ColoredOption[]) => Promise<void>;
  pending: boolean;
  allowNoneColor: boolean;
  disabled: boolean;
}) {
  const [draftValue, setDraftValue] = useState("");
  const [draftColor, setDraftColor] = useState<PaletteColor | null>(PALETTE_COLORS[0]);
  const [localError, setLocalError] = useState("");

  async function add() {
    const v = draftValue.trim();
    if (!v) return;
    if (values.some((o) => o.value === v)) {
      setLocalError(`"${v}" existe déjà.`);
      return;
    }
    setLocalError("");
    await onSave([...values, { value: v, color: draftColor }]);
    setDraftValue("");
  }

  async function remove(v: string) {
    setLocalError("");
    await onSave(values.filter((o) => o.value !== v));
  }

  return (
    <SectionCard title={OPTION_LABELS[optionKey]} count={values.length}>
      <div className="flex flex-wrap gap-1.5">
        {values.map((o) => (
          <ChipButton key={o.value} onRemove={() => remove(o.value)} dotColor={o.color} disabled={disabled || pending}>
            {o.value}
          </ChipButton>
        ))}
        {values.length === 0 && <span className="text-micro text-muted-foreground">Aucune valeur.</span>}
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Nouvelle valeur…"
          className="h-9 flex-1 text-sm"
          disabled={disabled}
        />
        <ColorSwatchPicker value={draftColor} onChange={setDraftColor} allowNone={allowNoneColor} />
        <Button type="button" size="sm" onClick={add} disabled={disabled || pending || !draftValue.trim()}>
          <Plus className="h-3.5 w-3.5" /> Ajouter
        </Button>
      </div>
      {localError && <p className="mt-1.5 text-micro text-red-400">{localError}</p>}
    </SectionCard>
  );
}

export default function AdminConfigPage() {
  const { options, meta, degraded, isLoading } = useSheetFieldOptions();
  const mutation = useUpdateSheetFieldOptions();
  const [error, setError] = useState("");

  // Editing is blocked (not just "options shown as read-only") for two
  // distinct reasons, both closing the same class of bug (see C1 in the
  // audit this responds to — a save landing on top of data the UI hasn't
  // actually confirmed is real yet):
  //  - isLoading: the query hasn't resolved yet, so `options` above is
  //    still CLIENT_FALLBACK (hardcoded, not Mongo's real current state).
  //    Previously the section cards rendered immediately regardless, gated
  //    only on mutation.isPending, so a click during this window POSTed
  //    fallback data as if it were current.
  //  - degraded: the query DID resolve, but the server itself had to serve
  //    fallback data because Mongo was unreachable for that read — same
  //    risk, coming from the opposite side.
  const editingBlocked = isLoading || degraded;

  async function save(key: OptionKey, next: string[] | ColoredOption[]) {
    try {
      await mutation.mutateAsync({ key, options: next, expectedUpdatedAt: meta[key] ?? null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
      setTimeout(() => setError(""), 4000);
    }
  }

  const totalCount = PLAIN_KEYS.length + COLORED_KEYS.length;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ListPageHeader
        title="⚙️ CONFIG"
        subtitle="Options des menus déroulants"
        accentClassName="text-slate-400"
        countClassName="border-slate-500/20 bg-slate-500/10 text-slate-400"
        count={totalCount}
        onRefresh={() => Promise.resolve()}
      />

      <div className="mx-auto flex max-w-2xl flex-col gap-3 px-3 py-4">
        <p className="text-micro text-muted-foreground">
          Chaque ajout ou retrait est enregistré immédiatement — pas de bouton &laquo;&nbsp;Enregistrer&nbsp;&raquo;.
          Les changements apparaissent dans les menus déroulants de l&apos;app en quelques secondes.
        </p>

        {error && <Alert className="mb-1">{error}</Alert>}

        {degraded && !isLoading && (
          <Alert className="mb-1" data-testid="config-degraded-banner">
            ⚠ Impossible de joindre la base — valeurs par défaut affichées, modifications désactivées. Réessayez plus tard.
          </Alert>
        )}

        {isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground" data-testid="config-loading">
            Chargement…
          </div>
        ) : (
          <>
            {PLAIN_KEYS.map((key) => (
              <PlainOptionSet
                key={key}
                optionKey={key}
                // `?? []` because a payload cached before this key existed has
                // no entry for it, and reading through that gap used to blank
                // the whole config screen — one newly added option set must not
                // cost the page.
                values={(options[key] as string[] | undefined) ?? []}
                onSave={(next) => save(key, next)}
                pending={mutation.isPending}
                disabled={editingBlocked}
              />
            ))}

            {COLORED_KEYS.map((key) => (
              <ColoredOptionSet
                key={key}
                optionKey={key}
                values={(options[key] as ColoredOption[] | undefined) ?? []}
                onSave={(next) => save(key, next)}
                pending={mutation.isPending}
                allowNoneColor={key === "PRESTATAIRE_OPTIONS"}
                disabled={editingBlocked}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
