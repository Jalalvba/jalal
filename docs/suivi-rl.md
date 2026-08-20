# Suivi RL — filtering, cascade, and the card surface

**Primary files:** [`src/app/suivi-rl/page.tsx`](../src/app/suivi-rl/page.tsx) ·
[`src/hooks/useBddRows.ts`](../src/hooks/useBddRows.ts) ·
[`src/lib/sheets/googleSheetsBdd.ts`](../src/lib/sheets/googleSheetsBdd.ts) ·
[`src/types/index.ts`](../src/types/index.ts) · `src/app/api/bdd/*`

Related: [`bdd-exports.md`](./bdd-exports.md) (the two export buttons' server
side) · [`ai-gemini.md`](./ai-gemini.md) (the ✨ reformulate button) ·
[`config-options.md`](./config-options.md) (where dropdown values come from) ·
[`sheets-data-layer.md`](./sheets-data-layer.md) (the BDD tab itself).

---

## 1. What this page is

A filtered browsing/editing view over the **BDD** Google Sheet tab
(`gid=868042157`). Despite the name, **there is no "RL" tab** — "RL" is a
business label for a view over BDD's RL-related columns. This is stated as a
`DELIBERATE` comment in two places that must stay in agreement:
[`src/app/suivi-rl/page.tsx:3`](../src/app/suivi-rl/page.tsx#L3) and
[`src/lib/sheets/googleSheetsBdd.ts:26`](../src/lib/sheets/googleSheetsBdd.ts#L26).

> **Reconsider only if** the sheet owner ever splits RL data into its own tab.

The page renders one `RecordCard` per BDD row, with 7 inline-editable fields
and the rest read-only.

---

## 2. The four filter axes

| # | Axis | State | Chip options derived from | Blank-chip flag |
|---|---|---|---|---|
| 1 | **Flotte** (`ETAT`) | `activeFleet: string[]` | `rows` (full dataset) | `hasBlankFleet` |
| 2 | **Emplacement** | `activeEmplacement: string[]` | `fleetFiltered` | `hasBlankEmplacement` |
| 3 | **Prestataire** | `activePrestataire: string[]` | `emplacementFiltered` | `hasBlankPrestataire` |
| 4 | **Flag** | `activeFlag: string[]` | `prestataireFiltered` | `hasBlankFlag` |

Defined at [`page.tsx:579-582`](../src/app/suivi-rl/page.tsx#L579) (state) and
`page.tsx:602-607` (derivation).

### 2.1 Combination semantics — OR within, AND across

- **Within one axis:** selected values are OR'd. `Emplacement: [ATELIER, DEPOT]`
  matches a row in *either*.
- **Across axes:** AND. `Flotte ∩ Emplacement ∩ Prestataire ∩ Flag`.

Both are implemented by the single shared predicate `axisMatches()`
([`page.tsx:559-562`](../src/app/suivi-rl/page.tsx#L559)):

```ts
function axisMatches(value: string | undefined, selected: string[], normalize?: (v: string) => string): boolean {
  const v = normalize ? normalize(value ?? "") : value ?? "";
  return selected.some((s) => (s === NON_RENSEIGNE ? !v.trim() : v === s));
}
```

The AND across axes is structural, not a predicate: each axis filters the
*output* of the one above it (`rows` → `fleetFiltered` → `emplacementFiltered`
→ `prestataireFiltered` → `flagFiltered`).

**Why one shared predicate:** before `c0d5965` each axis had its own inline
comparison. `Non renseigné` had to behave identically on all four, so the
blank-vs-exact branch was hoisted into one function rather than repeated four
times with four chances to diverge.

**Why `normalize` is a parameter, not built in:** only Flotte needs it —
`ETAT` is compared case-insensitively (`(v) => v.toUpperCase()`,
[`page.tsx:606`](../src/app/suivi-rl/page.tsx#L606)). Emplacement, Prestataire,
and Flag are exact-match. That asymmetry is deliberate: `ETAT` values arrive
from the sheet with inconsistent casing; the other three come from
admin-config dropdowns and are already canonical.

### 2.2 Empty selection = "TOUS", with one exception

An empty array means "no filter on this axis". For Emplacement/Prestataire/Flag
that literally means *pass everything through*. **Flotte is different**
([`page.tsx:602-607`](../src/app/suivi-rl/page.tsx#L602)):

```ts
if (activeFleet.length === 0) {
  return rows.filter((r) => r.ETAT?.toUpperCase() === ETAT_INTERNE || r.ETAT?.toUpperCase() === ETAT_EXTERNE);
}
```

**Why:** `DISPONIBLE` / `ANNULE` / `ANNULEE` vehicles aren't under
RL/immobilisation tracking. Letting "TOUS" mean *every* `ETAT` would flood the
default view with vehicles nobody on this page cares about. They stay reachable
via their own explicit chip.

> **This is NOT a bug and NOT "TOUS means all".** On Flotte, TOUS means
> "INTERNE + EXTERNE". If that ever needs to change, it is a product decision,
> not a consistency fix.

### 2.3 Default state

`activeFleet` initialises to `[ETAT_INTERNE]`
([`page.tsx:579-582`](../src/app/suivi-rl/page.tsx#L579)) — **not** empty. First paint
shows INTERNE only. The other three axes start empty.

`e2e/suivi-rl.spec.ts:20` depends on this default; changing it breaks that test.

---

## 3. Cascade narrowing

Each axis's chip list is computed from the rows **still in scope after every
upstream axis has been applied** — so a chip is only offered if selecting it
would actually return rows.

```
rows ──────────────► visibleFleetValues     (Flotte chips)
  │
  └─ fleetFiltered ─► visibleEmplacements   (Emplacement chips)
       │
       └─ emplacementFiltered ─► visiblePrestataires  (Prestataire chips)
            │
            └─ prestataireFiltered ─► visibleFlags    (Flag chips)
                 │
                 └─ flagFiltered ─► searched ─► rendered cards
```

Every list is built the same way — `Set` for dedupe, `.filter(Boolean)` to drop
blanks, `.sort()` for stable order:

```ts
const visibleEmplacements = useMemo(
  () => [...new Set(fleetFiltered.map((r) => r.Emplacement).filter(Boolean))].sort(),
  [fleetFiltered]
);
```

### 3.1 Selecting an upstream axis resets everything downstream

[`page.tsx:710-724`](../src/app/suivi-rl/page.tsx#L710):

```ts
function selectFleet(f)        { setActiveFleet(f);        setActiveEmplacement([]); setActivePrestataire([]); setActiveFlag([]); }
function selectEmplacement(e)  { setActiveEmplacement(e);  setActivePrestataire([]); setActiveFlag([]); }
function selectPrestataire(p)  { setActivePrestataire(p);  setActiveFlag([]); }
```

**Why:** because the downstream `visible*` lists are recomputed from the new
upstream scope, a retained downstream selection could reference a value that is
no longer reachable — producing a filter chip that is *selected* but not
*rendered*, and a result set of zero with no visible cause. Resetting is the
cheap, legible fix.

Flag (axis 4) has nothing downstream, so it calls `setActiveFlag` directly
([`page.tsx:824`](../src/app/suivi-rl/page.tsx#L824)) rather than a `select*`
wrapper. That asymmetry is intentional, not an oversight.

---

## 4. "Non renseigné" — the blank-value chip

### 4.1 The sentinel

```ts
const NON_RENSEIGNE = "__NON_RENSEIGNE__";   // page.tsx:549
```

**Why a sentinel and not `""`:** Radix's `ToggleGroupItem` needs a non-empty
`value`; an empty string is not a usable item identity. **Why it can't collide
with real data:** every real chip value passes through `.filter(Boolean)` before
being rendered, and no BDD field legitimately contains the literal
`__NON_RENSEIGNE__`.

It is deliberately **kept out of `BDD_HEADERS` / `BddRow` entirely** — it is a
filter-axis UI concept, never a field value, never written to the sheet.

`displayAxisValue()` ([`page.tsx:551-553`](../src/app/suivi-rl/page.tsx#L551))
maps it to the human-readable `"Non renseigné"` for the PDF/Excel header line
and the download filename slug.

### 4.2 The exact trigger rule

**A "Non renseigné" chip is rendered on an axis if and only if at least one row
*in that axis's own in-scope dataset* has a blank value for that field.**

"In-scope dataset" is the same dataset that axis's chip options derive from —
i.e. post-cascade, not the full table:

| Axis | Flag | Computed over | Code |
|---|---|---|---|
| Flotte | `hasBlankFleet` | `rows` | [`page.tsx:625`](../src/app/suivi-rl/page.tsx#L625) |
| Emplacement | `hasBlankEmplacement` | `fleetFiltered` | [`page.tsx:642`](../src/app/suivi-rl/page.tsx#L642) |
| Prestataire | `hasBlankPrestataire` | `emplacementFiltered` | [`page.tsx:642`](../src/app/suivi-rl/page.tsx#L642) |
| Flag | `hasBlankFlag` | `prestataireFiltered` | [`page.tsx:653`](../src/app/suivi-rl/page.tsx#L653) |

"Blank" means `!value?.trim()` — so `undefined`, `""`, and `"   "` all count.

**Consequence, by design:** the chip appears and disappears as you narrow. If
you select `Flotte: EXTERNE` and every EXTERNE row has an Emplacement, the
Emplacement "Non renseigné" chip vanishes. That is the point — a chip that
would return zero rows is never offered.

> **What this is NOT:** it is not a chip that is always present, and it is not
> driven by the admin-config option list. It is purely a property of the live
> data currently in scope.

### 4.3 Interaction with the reset cascade

`NON_RENSEIGNE` lives in the same `string[]` as real values, so it is subject to
the same downstream reset. Selecting `Emplacement: [Non renseigné]` clears
Prestataire and Flag, exactly like selecting a real value.

---

## 5. Data-derived vs. hardcoded chip options

**All four axes are now data-derived.** Before `c0d5965`, Flotte and
Emplacement drew their chips from the admin-config lists
(`options.ETAT_OPTIONS` / `options.EMPLACEMENT_OPTIONS`) while Prestataire and
Flag already derived from live data.

**The bug that caused:** a config-only value with zero live rows rendered as a
clickable chip that always returned nothing. `ANNULE` / `ANNULEE` are the
confirmed real instances — both are in `ETAT_OPTIONS_FALLBACK`
([`src/types/index.ts:341`](../src/types/index.ts#L341)) and neither had any live row.

**What did *not* change, and must not:** `options.ETAT_OPTIONS` and
`options.EMPLACEMENT_OPTIONS` are still used by the per-row `InlineEditSelect`
editors ([`page.tsx:307`](../src/app/suivi-rl/page.tsx#L307),
[`page.tsx:334`](../src/app/suivi-rl/page.tsx#L334)). **Editing a row must be able
to set a value no other row currently has** — so the editor needs the full
admin-config list, not the data-derived one. The two lists serve different jobs:

| | Source | Why |
|---|---|---|
| **Filter chips** | live data in scope | never offer a filter that returns nothing |
| **Row editors** | admin-config (`useSheetFieldOptions`) | must be able to introduce a new value |

> Collapsing these two onto one source would break one of them. This is the
> single most likely thing to be "simplified" into a regression later.

---

## 6. The "TOUS" chip

`AllChip` ([`page.tsx:65`](../src/app/suivi-rl/page.tsx#L65)) is a plain
`<button>` rendered **outside** each `ToggleGroup`, not as a `ToggleGroupItem`.

**Why:** Radix's `type="multiple"` ToggleGroup treats its `value` as the set of
pressed *individual* items. Folding a "clear all" pseudo-value into that array
would fight the group's own per-item on/off semantics. It is styled with the
same classes as `ToggleGroupItem` so it still reads as part of the chip row.

Active state is `activeX.length === 0`; clicking it calls the axis's
`select*([])`, which also triggers the downstream reset.

---

## 7. Search bypasses the chip cascade

[`page.tsx:673-677`](../src/app/suivi-rl/page.tsx#L673):

```ts
const searched = useMemo(() => {
  const term = search.trim().toUpperCase();
  if (!term) return flagFiltered;
  return rows.filter((r) => String(r.IMM ?? "").toUpperCase().includes(term));
}, [flagFiltered, rows, search]);
```

A non-empty search term filters **`rows`** — the full dataset — not
`flagFiltered`. Chips only apply when the search box is empty.

**Why:** chips are a *browsing* filter; search is for finding one specific known
plate. Requiring the user to first clear four chip axes to find a plate they can
already name is the behaviour this deliberately avoids (`1b38ea0`).

**Search is plate-only.** `client` / `modele` / `prestataire` / `commentaire`
free-text matching was removed by explicit product decision (`a272cf5`), and the
input is a shared `Combobox` fed by `usePlateAutocomplete`. There is **no WW
matching** on this page — `searched` reads `r.IMM` only.

### 7.1 The export summary mirrors the bypass

`activeFilters` ([`page.tsx:687-695`](../src/app/suivi-rl/page.tsx#L687)) returns
`[]` when a search term is present. Without this, an exported PDF would print
"Filtres actifs — Flotte: INTERNE" on a document whose rows ignored that filter
entirely.

Multiple values within one axis are joined with `" ou "` — `Emplacement: Atelier
ou Dépôt` — so the header still reads as one filter per axis rather than four
separate entries.

---

## 8. The card surface

### 8.1 Editable fields — 7, per-field inline commit

`FieldKey` ([`page.tsx:209`](../src/app/suivi-rl/page.tsx#L209)) matches
`BDD_EDITABLE_FIELDS` ([`src/types/index.ts:193-201`](../src/types/index.ts#L193)):

`ETAT` · `prestataire` · `flag` · `Emplacement` · `Catégorie` · `commentaire` ·
`Technicien`

Each commits independently via `commitField()` → `useUpdateBddRow()` →
`POST /api/bdd/update`, followed by `applyOptimisticBddUpdate()` for instant
feedback. **There is no card-level save button** — this replaced an
expand-then-submit form in `8199db9`.

The server enforces the same allowlist independently
(`src/lib/sheets/googleSheetsBdd.ts`'s `editableFieldSet`); the client list is for the UI,
not the security boundary.

> **Counts to keep honest:** **7** editable fields out of **28** `BDD_HEADERS`
> entries. Both numbers were stale in `CLAUDE.md` §6 ("6-field") and
> `src/types/index.ts:189` ("27 real columns") until corrected — `Emplacement` joined
> the allowlist in `3d9bd87` and neither count was updated with it.

### 8.2 Read-only fields

`READONLY_HEADERS` ([`page.tsx:218`](../src/app/suivi-rl/page.tsx#L218)) is
`BDD_HEADERS` minus: `IMM`/`date`/`client`/`modele` (promoted into the card
header/subtitle), the 7 editable fields, and `BDD_ZONE_DETECTION_HEADERS`.

`ATELIER` / `DEPOT` / `PARKING` get their **own** labelled section, "Détection
de zone (auto)". **Why separated:** they are sheet-side XLOOKUP presence flags
(automated), while everything else in the readonly list is manual or static.
Mixing an automated signal into a manual list makes a stale automated value look
like a human's entry.

### 8.3 INTROUVABLE alert styling

`row.Emplacement === EMPLACEMENT_INTROUVABLE` tints the whole card red and adds
a `⚠ Introuvable` badge ([`page.tsx:259`](../src/app/suivi-rl/page.tsx#L259)).

> **Known fragility (documented, not fixed):** `Emplacement` is admin-editable
> at `/admin/config`. Renaming or deleting the exact value `"INTROUVABLE"` there
> silently disables this styling — no error, no warning, nothing logged.
> `EMPLACEMENT_INTROUVABLE` ([`src/types/index.ts:323`](../src/types/index.ts#L323)) exists
> so there is *one* place to update, not to remove the fragility. Same caveat
> applies to the five `ETAT_*` constants. See
> [`config-options.md`](./config-options.md#7-known-limitations).

### 8.4 ETAT badge colours

`etatBadgeClass()` ([`src/types/index.ts:383-389`](../src/types/index.ts#L383)) is shared
with DS History. It replaced this page's own two-branch
(EXTERNE-vs-everything-else) ternary, which rendered
`DISPONIBLE`/`ANNULE`/`ANNULEE` identically to `INTERNE`.

Unknown values fall through to semantic `bg-muted`/`border-border` tokens — the
previous literal `bg-zinc-700 text-zinc-200` rendered a dark surface regardless
of theme, a real light-mode bug rather than a token-naming nitpick.

---

## 9. Error surfacing

```ts
const fetchError = rows.length === 0 && rowsQuery.error instanceof Error ? rowsQuery.error.message : "";
const displayError = error || fetchError;
```

A **fetch** error only shows the banner when there is nothing cached to display
— a background refresh failing while stale rows are on screen stays silent,
matching the original page's `fetchFresh(silent)` behaviour. A **delete-action**
error (`error`) surfaces unconditionally.

---

## 10. Known limitations & edge cases

1. **Non-string Sheet values.** `formatCellValue()` passes numeric cells through
   as-is (only date-like headers get converted), so `r.modele` can be a real
   `number` at runtime despite `BddRow` declaring `string` — real vehicle models
   are digit strings (Peugeot 208 / 508 / 2008 / 3008). Every consumer must
   `String()`-coerce: the PDF payload
   ([`page.tsx:119`](../src/app/suivi-rl/page.tsx#L119)), the Excel payload
   ([`page.tsx:174`](../src/app/suivi-rl/page.tsx#L174)), the reformulate context
   ([`page.tsx:378`](../src/app/suivi-rl/page.tsx#L378)), and
   `ReadonlyFieldList` ([`page.tsx:394`](../src/app/suivi-rl/page.tsx#L394)).
   Discovered when one such row made the export route's strict `isValidRow()`
   reject the **whole batch** — fixed in `77f9eef`.
   → *Any new consumer of a BddRow field must coerce.* This is the single most
   repeated footgun in this page.

2. **Chip options are client-side over the full dataset.** All filtering runs in
   the browser on the complete BDD tab (~85 rows live). Fine at this size;
   would need server-side filtering at a few thousand.

3. **`ETAT` casing is normalised on read but not on write.** The filter
   uppercases for comparison; the inline editor writes whatever the admin-config
   option list holds. A lowercase option value would filter correctly but
   display inconsistently.

4. **Admin-config rename drift.** Covered in §8.3 — applies to
   `EMPLACEMENT_INTROUVABLE` and all five `ETAT_*` constants.

5. **`activeFilters` reflects *selections*, not *results*.** If a selected value
   matches zero rows, the export header still lists it. Correct behaviour (the
   report should say what was asked for) but occasionally surprising.

6. **`alert()` for export failures.** [`page.tsx:148`](../src/app/suivi-rl/page.tsx#L148)
   and `:200` use a native `alert()`, unlike every write path which uses the
   `sonner` toast. Inconsistent with the rest of the app.

---

## 11. What this page deliberately does NOT do

- Does not read or write any tab other than **BDD**.
- Does not write to the sheet from the AI reformulate button — see
  [`ai-gemini.md`](./ai-gemini.md).
- Does not search on client / modele / prestataire / commentaire.
- Does not offer chips for values with no live rows.
- Does not apply chip filters while a plate search is active.
- Does not persist filter state across reloads (only the row *data* is
  persisted, via the TanStack Query localStorage persister).
- Does not expose the other 21 BDD columns for editing.
