# Fleet pages — Parking, Atelier, Depot, RDV

> **Summary-level doc.** Full chronology in
> [`PROJECT_HISTORY.md`](../PROJECT_HISTORY.md) §2. Data-layer rules in
> [`sheets-data-layer.md`](./sheets-data-layer.md).

Four list pages over four Sheet tabs. Parking, Atelier, and Depot are ports of
the original AVIS Maroc Google Apps Script systems; RDV is new.

---

## 1. Shared shape

All four are the same page composed from `src/components/fleet/`:

```
ListPageHeader  ── title · count · Actualiser · plate Combobox · filter chips
  └─ RecordCard × n
       ├─ InlineEditSelect / InlineEditText / InlineEditCombobox   (per-field commit)
       ├─ ZoneBadges                                               (cross-tab presence)
       └─ ReadonlyFieldList                                        (XLOOKUP columns)
```

Backed by `src/hooks/use{Parking,Atelier,Depot,Rdv}Rows.ts` — the same TanStack
Query pattern, the same `fetchJson` helper, the same mutation-meta toasts.

> **Do not rebuild any of this.** These components exist *because*
> Parking/Atelier/Depot/BDD previously duplicated ~95% of it
> (`f1af645`, `3e03663`, `de1473e`, `295e1a8`).

---

## 2. Parking

`src/app/parking/page.tsx` · `src/lib/sheets/googleSheetsParking.ts` · `/api/parking/*`

15 columns; only `IMM`, `ACTION`, `TIMESTAMP` are ever written — the other 12
are sheet-side XLOOKUP formulas, read-only here.

- **Delete is a real row deletion** (`deleteDimension`), not a cell-clear
  (`5828d2b`). This is what makes `verifyRowIdentity()` mandatory everywhere.
- **Add always appends**; a duplicate plate bumps the existing row's `TIMESTAMP`
  and returns `status: "updated"` rather than inserting twice.
- Owns `resolveIMM()` and `getIMMList()`, reused by Atelier, Depot, and BDD.
  `getIMMList()` had a **1-week cache TTL** added in `143041a` — and a bug fixed
  in `cdbfcd7` where it queried the wrong Mongo field and **always returned
  `[]`**.

### 2.1 ZONING, the filter, and the AI-written zone

The tab gained a `ZONING` column. It is read into `ParkingRow.zoning`, shown on
each card, and drives a single-select chip row in the header.

The dropdown holds **nine** values, byte-verified against the live tab's
`ONE_OF_LIST` validation rule (read 2026-08-29) and identical to
`prompt-parking.ts`'s `ZONES` and `ZONING_OPTIONS_FALLBACK`:

`DEPOT-ATV` · `DEPOT-REMPLACEMENT` · `DEPOT-DISPONIBLE` · `ATELIER` ·
`CARROSSERIE-FSM` · `PRESTATAIRE-EXTERNE` · `DISPONIBLE-A-LIVRER` ·
`visite technique` · `AVIS-PIERRE-PARENT`

`visite technique` is lower-case and un-hyphenated on purpose — that is exactly
how the sheet stores it. Per-value row counts are deliberately not recorded
here: they change every working day, and a stale count reads as current.

**"Non assigné" is always offered**, even when every row currently has a zone.
A vehicle losing its zone is exactly what someone would come here to check, and
a chip that only appears once the problem exists cannot be used to look for it.
The plate search bypasses the chip, same convention as the other list pages:
chips browse, search finds one plate whatever is selected.

**The zone is editable from the card** — a dropdown per row, writing straight
into the ZONING cell through `POST /api/parking/zoning` (`verifyRowIdentity()`
first, like every other Sheets write; no TIMESTAMP stamp, because a zone change
is not workshop activity). The values are the `ZONING_OPTIONS` option set,
admin-editable at `/admin/config` like every other list, and the route refuses
anything outside it: a free-text zone would create a bucket the chip filter and
the work-order rules do not recognise.

**Superseded 2026-08-29.** This paragraph used to record that
`depot-rempalcmemnt` was spelled as the live sheet spelled it, in the option
list and in the work-order prompt, because correcting the typo in code would
have sent vehicles to a zone no row matched. The sheet's validation rule was
replaced with the clean nine-value list above, and the code re-synced to it in
the same change, so there is no misspelling left to mirror. The rule that
produced it still stands: fix the sheet FIRST, then the list — never the
reverse.

**The AI fills this column too.** `POST /api/parking/actions` writes `ZONING`
as well as `ACTION`, through `applyZone()`, which reports one of five outcomes
per vehicle: `written`, `invalid` (the model named something that is not a real
zone), `rejected` (a real zone this vehicle's data does not permit),
`skipped-no-data`, or `failed`. Two guards stand in front of the write — an
exact match against the dropdown via `isValidZone()`, and
`zonePreconditionFailure()` for the factual gates behind criteria A0.5.1/2/3/4.
The first is not redundant: the Sheets API was verified NOT to enforce
`strict:true` validation on writes, so that check is the only real enforcement
there is.

Both guards **refuse rather than substitute**. `ACTION` always ends on some
destination — the controller cannot work without one — but `ZONING` does not
inherit that fallback, because a zone nobody reasoned about is worse than an
empty cell a human will fill. On `insufficientData` the zone is skipped, not
defaulted. Full reasoning: [`ai.md`](./ai.md).

**Ownership and the AVIS badge.** `client` falls back to the parc tab's
`Société` when the tab's own CLIENT lookup is empty, and a vehicle whose Client
OR Société reads AVIS / Scal Avis gets a loud amber badge on its card and the
Pierre Parent routing in its work order.

The parc-tab read is `'parc'!A:F`, deliberately open-ended. The first version
capped it at row 5000 and the tab is bigger: **43 of the 83 Parking plates fell
past the cut**, came back with no owner at all, and — because four of them were
AVIS vehicles — silently lost their AVIS treatment as well. A row limit on a
tab that grows is a bug with a timer on it. After the fix: 7 835 plates mapped,
0 blank clients, and the AVIS count went from 4 to 9.

**Where `Société` comes from.** MongoDB's `parc` collection, as of
2026-08-22 — `~/import` commit 08aab01 added `societe` to `parc.py`'s
`COLUMNS_NEEDED` (the mapping had always known `"Société" → "societe"`; the
keep-list simply dropped it). Before that it could only come from the
spreadsheet's `parc` TAB, which is what `googleSheetsParc.ts` used to read.

Both sources were compared in full before switching: 7 838 sheet rows against
7 836 documents, **0 disagreements** on Société across the 7 836 plates in
both, distributions matching to a row. An earlier comparison that appeared to
show a 19× gap on one bucket had been measured against a truncated 4 000-row
read of the tab — the same cap that hid 43 Parking plates.

The switch removes a ~7 800-row read of a second tab on every cache miss, from
a 60 req/min quota four zone tabs already share. `locataire` is still NOT a
substitute for `societe`: it reads "Locafinance" for the very plates whose
Société is "AVIS".

### 2.2 KM — the hand-entered odometer

The tab also carries a `KM` column, edited from the card through an
`InlineEditText` field ("KM relevé") and written by `POST /api/parking/km`.

**Why it exists.** The DS-derived odometer (`currentKmOf()`) is only ever as
fresh as the last BILLED intervention, so a vehicle that has run for months
without a DS line has its real mileage recorded nowhere — and every maintenance
interval check is computed against that number. This column is the escape hatch.

**Manual beats DS, stated once.** `resolveVehicleKm()` sits next to
`currentKmOf()` in `maintenanceIntervals.ts` and is the single place the
precedence lives: a valid manual reading wins (`source: "manual"`), anything
else falls back to the DS value (`"ds"`), and with neither it returns
`{ km: null, source: "none" }`. `checkInterval()`/`checkBeltPump()` take it as
an optional trailing argument, so Atelier, Depot and DS History are
byte-identically unaffected — pinned by a test. A manual reading BELOW the last
service of its type returns `"unknown"` with both figures named, rather than a
clamped or negative gap.

`formatKmSourceLine()` states which odometer was used, first in `checkLines`,
so it is prompt content AND grounding-guard source text — `KM DÉCLARÉ
MANUELLEMENT` is an upper-case run that `ungroundedSuppliers()` would otherwise
read as a fabricated supplier name. It is deliberately not silent on the
ordinary `"ds"` case: a line appearing only in the override case would let
"absent" mean "DS-derived".

`isStale()` gains `manualKm` — a corrected odometer changes every verdict
without adding a DS entry, so without it a re-run would reuse an analysis
computed against the number the operator just fixed.

**The route** is its own, not a field on `/api/parking/action`, for the same
reason `/api/parking/zoning` is: `ACTION`'s write also stamps `TIMESTAMP`, and
reading a dashboard is not workshop activity. `verifyRowIdentity()` first, like
every Sheets write; `RAW`, never `USER_ENTERED`, because the cell is read back
with `Number()` and a locale-reformatted value is one this module then has to
un-format. An empty string is a meaningful value — it CLEARS the override
rather than being a missing parameter — and the range is validated both at the
route boundary (a 400 naming the rule) and independently in `updateManualKm()`.

### 2.3 The PDF export

**Export PDF** renders the filtered view — `POST /api/parking/export`, seven
columns: IMM, TIMESTAMP, ACTION, ZONING, MARQUE, MODEL, gemini. `KM` is
deliberately NOT among them: the report is a work list for the quality
controller, who reads it to know what to check and where the car goes, and the
odometer is an input to that reasoning rather than part of the instruction —
its omission is a decision, not an oversight.

- **Landscape A4**, unlike the BDD report's portrait: two of these columns are
  long free text, and portrait squeezes the work order into a column too narrow
  to read.
- **ACTION keeps its own line breaks** (`wrapPreservingBreaks`). It holds a
  numbered work order, one operation per line, and re-flowing it into a
  paragraph would undo the one thing that makes it copy-pasteable.
- Column widths were measured against real values, not guessed: at the first
  pass TIMESTAMP clipped to `17/08/2026 17:...` and MODEL to `MG3 Hybride P...`.
  Every text column now wraps, so an unexpectedly long value grows its row
  instead of losing its tail.
- The text helpers (`sanitize`, `truncate`, `wrapText`) are shared with the BDD
  export via `src/lib/pdf/text.ts` — each rule in `sanitize` is a real crash or
  mangling seen in this data, and a second copy would inherit the rules but not
  the corrections.

## 3. Atelier

`src/app/atelier/page.tsx` · `src/lib/sheets/googleSheetsAtelier.ts` · `/api/atelier/*`

Structurally close to Parking, with two real differences:

- **No `ACTION` field.** Editable surface is `COMMENTAIRE`, `CATÉGORIE`,
  `TECHNICIEN`, `BESOIN PIÈCE`.
- **Column *order* drifts** from the reference GAS source's declaration
  (columns 9–14 are reshuffled) — which is exactly why every read/write goes
  through a live column-name map rather than fixed indices.

`TECHNICEIN_DS` is a **distinct** column from the editable `TECHNICIEN` — the DS
record's technician, not the assigned atelier technician.

Has a **Technicien filter chip row** (`1e47ff8`) including a "Non assigné" chip
for blank values (`a1c88a4`) — the direct precedent for Suivi RL's
"Non renseigné" chips.

## 4. Depot

`src/app/depot/page.tsx` · `src/lib/sheets/googleSheetsDepot.ts` · `/api/depot/*`

**A byte-for-byte structural clone of Parking** — same 15 columns, same 12
XLOOKUP formulas verbatim (checked via a FORMULA-render read, not inferred from
resemblance). Only `ACTION` is editable. Reuses `ParkingAddResponse` /
`ParkingAddResultItem` rather than declaring identical types.

## 5. RDV

`src/app/rdv/page.tsx` · `src/lib/sheets/googleSheetsRdv.ts` · `src/lib/sheets/googleSheetsRdvMonthly.ts` ·
`src/lib/sheets/rdvIdentity.ts` · `/api/rdv/*`

An appointment/convoyage log. **All 8 columns are manually typed** — this tab
has no XLOOKUP columns at all, confirmed live.

Unlike the other three, **rows are not keyed or deduped by plate**: the same
`Matricule` legitimately appears across many appointments over time, and there's
no `TIMESTAMP` to bump. Adding always appends a brand-new entry.

### The three load-bearing RDV rules

1. **Writes use `RAW`, never `USER_ENTERED`** — `USER_ENTERED` strips leading
   zeros from phone numbers. Dates are written as precomputed serials.
2. **Every add/update/clear dual-writes the monthly tab first**, then the flat
   `RDV` mirror. Mirror-only writes are destroyed on the next GAS rebuild.
3. **Update/clear never trust a client-held `rowIndex`** — `resolveUniqueMatch()`
   re-resolves by full-content match, returning `null` on no-match and
   **throwing on ambiguity rather than guessing** (`b11035b`).

All three are detailed in [`sheets-data-layer.md` §3](./sheets-data-layer.md#3-write-safety).

**UI:** day-grouped table with a date picker on desktop, stacked cards on
mobile, cross-day plate search, and PNG export of the selected day
(`html-to-image`). `RDV_MATRICULE_REGEX` matches the monthly tabs' own
`CUSTOM_FORMULA` validation exactly: `980867WW` or `79421-B-7`.

The 17-name `CONVOYEUR` list was confirmed byte-for-byte against the live
`ONE_OF_LIST` validation rule on the monthly tabs; it is now a
[config-driven option set](./config-options.md) with that list as fallback.

**A standalone RDV page was removed once** (`eeec56a`) keeping only the data
layer, then rebuilt (`d1dcd28`, `c546f1d`). Both decisions are in
`PROJECT_HISTORY.md`.

---

## 6. Zone badges

`useVehicleZone(imm)` ([`src/hooks/useVehicleZone.ts`](../src/hooks/useVehicleZone.ts))
returns `{ inParking, inAtelier, inRdv, inDepot }`.

All four tabs are independent, so **any combination can be true at once** — a
real data inconsistency worth surfacing, not hiding. A plate in multiple zones
renders all matching badges.

It reuses the same `use*Rows()` React Query caches the pages already populate.
**A dedicated "does plate X exist" endpoint would not be cheaper**: the Sheets
API has no server-side row filter, so `getParkingRows()` et al. read the full
range regardless of caller.

---

## 7. Known limitations

1. **Row order is server-sorted by `TIMESTAMP`, and editing bumps it.** A field
   edit relocates the row the user is working on to the far end of the list.
   Mitigated by `useStableRowOrder` — see
   [`cross-cutting.md`](./cross-cutting.md#3-stable-row-order).
2. **Depot duplicates Parking's structure rather than sharing it.** Deliberate
   (the tabs could diverge), but a Parking fix must be applied to Depot by hand.
3. **`getIMMList()`'s week-long TTL** means a plate added directly in the sheet
   isn't resolvable until an import invalidates it or the TTL expires.
4. **RDV's monthly tab must already exist.** Writing to an ungenerated month
   returns `{ written: false, error }` rather than creating the tab.
