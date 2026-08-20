# DS History

> **Summary-level doc.** Full chronology in
> [`PROJECT_HISTORY.md`](../PROJECT_HISTORY.md) §2 ("DS History").

**Files:** [`src/app/ds-history/page.tsx`](../src/app/ds-history/page.tsx) (1211 lines —
the largest page in the app) · `/api/ds/history` · `/api/parc` · `/api/cp` ·
`/api/query` · `/api/sheet` · `/api/export` · `/api/vehicle-suggestions`

The vehicle dossier page: enter a plate, get its full service history, contract
data, and the sheet rows that mention it.

---

## 1. Composition

| Card | Source | Collection / tab |
|---|---|---|
| **VÉHICULE** | `/api/parc`, `/api/cp` | Mongo `parc`, `cp` |
| **DS history** | `/api/ds/history` | Mongo `ds` (+ `bc` for lines) |
| **SheetCard** ×3 | `/api/sheet?sheet=…` | Sheets tabs `bdd`, `rl`, `rl_reunion`, `import` |
| **ANALYSE IA** | `/api/ds-history/analyze` | none — client sends already-loaded data (§7) |

`/api/ds/history` returns `DsHistoryItem[]` — `n_ds`, `date_ds`,
`immatriculation`, `entite_nom`, `description`, `fournisseur`, `techniciens[]`,
`km`, and `lines[]` (`cmd_num`, `code_art`, `designation_consommation`, `qte`).

The BDD SheetCard is **editable** (`c1ece8e`) — it reuses Suivi RL's own
`useUpdateBddRow()` hook rather than a second write path, so the same allowlist,
`verifyRowIdentity()` guard, and optimistic update apply.

---

## 2. Search

**Plate-only, strict prefix match, with browser caching** (`6f24bdf`,
`26e53fb`). Year and limit inputs were dropped (`08a456d`); VIN was dropped
(`d794e82`).

Suggestions come from the **single shared full-plate-universe query**
(`["vehicle-suggestions"]`, `src/hooks/useVehicleSuggestionList.ts`), which spans
`parc` + `cp` and is persisted to `localStorage` by the query-cache persister.
Only the first page visited in a browser session fetches it; every subsequent
page and navigation reads it with zero network round trip.

Plate variants (`src/lib/utils/plateVariants.ts`) let one typed plate match the several
formats the same vehicle appears under across sources.

> **`4742410`** fixed the page auto-loading a hardcoded plate (`48070-B-7`) on
> mount — a leftover from development.

`/api/query/search` was a server-side autocomplete route superseded by the
client-side filtering above (`6f24bdf`) and left in place unused; it was
deleted once confirmed dead. `/api/query` itself is unaffected and is still
called from `page.tsx` to resolve a typed plate.

---

## 3. Export — `/api/export`

`POST`, rate-limited **20 / 5 min** (bucket `article`-sibling sizing; same
reasoning as the [BDD exports](./bdd-exports.md#1-contract)). Produces **PDF**
(`pdf-lib`, `?format=pdf`) or **DOCX** (`docx`, default).

Unlike the BDD exports, the payload is **field-selection driven**: the client
sends `visibleCardFields`, `visibleLineFields`, and the label maps, so the user's
on-screen column choices are reproduced in the document. Layout was compacted in
`24e34cd`.

BC-sourced pricing was **removed entirely** (`323497a`) — an earlier version
exported prices that turned out not to be trustworthy. Do not reintroduce
without re-verifying against the source.

---

## 4. Cross-cutting details worth keeping

- **Zone chips live in the VÉHICULE card header**, and the card is tinted by
  zone priority (`803454a`). They render as separate green chips, never as
  concatenated `"A + B"` text (`6aee573`).
- **`RL_reunion` "suivi" status** is surfaced next to the RL Motif (`cbcf1d0`).
- **Full-row `INTROUVABLE` highlight** on `BddEditableRow` (`f016018`), sharing
  `EMPLACEMENT_INTROUVABLE` with Suivi RL — and its
  [rename-drift fragility](./config-options.md#7-known-limitations).
- **`etatBadgeClass()`** is shared with Suivi RL. It previously lived here as
  `etatStyle()` and covered `ANNULEE` but not `ANNULE`, despite both being valid
  options — one of the two drifted copies that centralising fixed.
- **The bc-price lookup was 7 s on heavy plates**, fixed to ~150–250 ms
  (`44760e9`).
- **A request race** was fixed in `86594a7` — a slower earlier response could
  overwrite a newer one.
- `qte: 0` is a legitimate value and must not fall through to the `"—"`
  placeholder (`d4d33be`).

---

## 4.5 ANALYSE IA — the AI health analysis

Sits between the VÉHICULE card and the sheet rows, above the DS entries it
analyses. **Nothing runs on mount** — the call is made on click only, so
opening the page never costs a Gemini call. Prompt, output contract and guards
live in [`src/lib/ai/prompts/dsAnalysis.ts`](../src/lib/ai/prompts/dsAnalysis.ts);
see [`ai.md`](./ai.md) for the module itself.

**The client sends data it already has; the route does not re-fetch.**
`/api/ds/history`'s ~100-line aggregation (with its `$lookup` into `bc`) is not
exported as a reusable helper, so re-fetching would mean a second copy of it —
the duplication class that let `ef630e0`'s bug outlive its own fix — and would
cost a round trip for bytes the page is already holding. The route therefore
treats the payload as untrusted: `parseInput()` narrows every field, caps
entries at 500 and text at 2000 chars, and tolerates junk rather than throwing.

**What is sent:** contract end date (from `cp`), per-entry date/km/description/
part designations, and the **RL replacement rows** — the `rl` sheet is the
vehicle-replacement log, and a plate appearing there with a `Motif` is a real
health signal, already why this page tints the VÉHICULE card red.

**Contract status is computed in code**, not asked of the model. Date
arithmetic is deterministic and models are unreliable at it; the model receives
the computed status as a fact to restate, which also makes the flag testable.
`contractEnd` reads `contracts[0]`, matching what VÉHICULE displays — picking a
different row would flag one contract's status beside another's on screen.

**Truncation at 80 entries is surfaced in the UI**, not only to the model. The
response carries `truncated`/`analysedCount`/`totalCount` and the card renders
an explicit notice, so a 226-entry vehicle cannot show a partial analysis that
looks complete. (Measured: 11,169 vehicles, avg 23 entries, max 226.)

**Two grounding guards**, because `responseSchema` steers rather than
guarantees — see [`ai.md` §0.1](./ai.md#01-validate--schema-steers-it-does-not-guarantee):
`isDsAnalysisShape()` via the `validate` hook, then `ungroundedDates()` drops
any finding citing a date absent from the source. The whole finding is dropped,
not just the date: a recurrence claim stripped of its invented evidence is an
unsupported claim, not a weaker one.

### Internal vs external repairs

Each entry sent to the model is marked `interne`, `externe: <nom>`,
`externe (non nommé)` or `inconnu`. **The rule is not "fournisseur is empty
means internal"** — production carries an explicit sentinel:

```
externe  fournisseur named, OR technicien === "Fournisseur Externe"
interne  neither, but a real technicien name is present
inconnu  neither
```

`"Fournisseur Externe"` is the **single most common `technicien` value in the
whole `ds` collection** (48,834 occurrences, ahead of every real human name),
and **10,277 of those carry no `fournisseur` at all**. A rule keyed only on
`fournisseur` would file every one of them as in-house work. Verified against
production 2026-08-20; measured across 102,336 DS: **40.5% externe, 50.9%
interne, 8.6% inconnu**.

`inconnu` is surfaced as itself, never defaulted to internal — prompt rule 10
tells the model not to draw conclusions from it. The card shows the split next
to the button ("62 interventions (12 internes · 49 externes · 1 inconnu)") so
the user sees what is being sent before spending a call.

**Two fields evaluated and deliberately rejected:**

- **`entite_nom`** holds only 7 values, all AVIS sites (`Garage Ain Sebaa`
  183k, `Entité Siège`, `Garage Tanger`, …). It says *where* a DS was raised,
  not *who* did the work — external repairs are routinely logged against an
  AVIS garage, so using it would classify most external work as internal.
- **`bc.fournisseurs`** is the *parts* supplier on a purchase order, a
  different question from who performed the repair.

**Supplier names are canonicalised in code, not by instruction.** Measured: 179
raw distinct names collapse to 178 — exactly one real collision
(`EQUIPEMENT MOYEN ATLAS ASSALAMA` vs `Equipement moyen atlas assalama`).
Nearly a no-op, and done in code *precisely because* it is: telling a model to
treat "near-identical names" as the same supplier invites it to merge genuinely
different ones, a worse failure than the problem being solved.

**Supplier recurrence is asked for explicitly.** Rule 9's first draft described
how to *cite* a supplier recurrence but never asked for one — and a live run on
`47024-B-7` duly returned only part-based findings, missing a supplier present
8 times. It now instructs an active search at the same level as part
recurrence, with a 3-occurrence threshold. Worth remembering: describing a
format is not the same as requesting the content.

**A third guard, `ungroundedSuppliers()`**, mirrors `ungroundedDates()` on the
same principle — is this literal present in what we sent? It checks candidate
names against the **entire** payload, not just the supplier list, because
descriptions here are upper-case too (`PB MOTEUR`, `4 PNEUS`) and a model
quoting one verbatim would otherwise be accused of inventing a garage.

Cost impact, measured on the same vehicle with and without the fields:
**4,832 → 5,111 input tokens (+5.8%)**. No change to rate limit, timeout or
model.

**Nothing is persisted.** The analysis is advisory output from a
non-deterministic model and would go stale the moment a new DS entry lands;
`gemini_usage` already records that the call happened and what it cost, under
action `ds-history-analysis`.

**Data quality shapes the prompt.** Measured against production, DS
`description` values are terse French shop notes and frequently content-free
("PB MOTEUR", "pb", "."), while `designation_consommation` carries the real
signal ("turbo moteur"). Rule 4 of the prompt states this outright, because a
model handed both without it will narrate a confident story out of "pb".

---

## 5. Mongo field names

All four collections (`ds`, `bc`, `parc`, `cp`) were migrated to clean,
post-backfill key names (`e2e3a4f`, `fa9f3ec`).

`designation_consommation` had a **dual-read window** during the backfill
(`985e3d8`), which is also what introduced
[`field_registry.json` CI enforcement](./fleet-data-import.md#6-related-field_registryjson).
The underlying cause — whitespace variance in `"Désignation Consomation"`
breaking prod twice with *opposite* whitespace — was class-fixed upstream in
the **separate `~/import` repo** (its commit `77f3c9d`, not in this repo's
log), not just patched here.

---

## 6. Known limitations

1. **1211 lines in one page component.** The largest single file in the repo.
2. **Search regexes are not prefix-anchored** for the Articles-style lookups, so
   they can't use a B-tree index — documented as a deliberate accepted limit in
   `PROJECT_HISTORY.md` §3.
3. **`/api/ds/history` has no rate limit** — unlike `/api/article` and
   `/api/export`. It is session-gated but unthrottled.
4. **Sheet lookups fire 6 parallel `/api/sheet` requests** (IMM + WW variants ×
   3 tabs) on every search.
