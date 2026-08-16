# Fleet pages — Parking, Atelier, Depot, RDV

> **Summary-level doc.** Full chronology in
> [`PROJECT_HISTORY.md`](../PROJECT_HISTORY.md) §2. Data-layer rules in
> [`sheets-data-layer.md`](./sheets-data-layer.md).

Four list pages over four Sheet tabs. Parking, Atelier, and Depot are ports of
the original AVIS Maroc Google Apps Script systems; RDV is new.

---

## 1. Shared shape

All four are the same page composed from `components/fleet/`:

```
ListPageHeader  ── title · count · Actualiser · plate Combobox · filter chips
  └─ RecordCard × n
       ├─ InlineEditSelect / InlineEditText / InlineEditCombobox   (per-field commit)
       ├─ ZoneBadges                                               (cross-tab presence)
       └─ ReadonlyFieldList                                        (XLOOKUP columns)
```

Backed by `hooks/use{Parking,Atelier,Depot,Rdv}Rows.ts` — the same TanStack
Query pattern, the same `fetchJson` helper, the same mutation-meta toasts.

> **Do not rebuild any of this.** These components exist *because*
> Parking/Atelier/Depot/BDD previously duplicated ~95% of it
> (`f1af645`, `3e03663`, `de1473e`, `295e1a8`).

---

## 2. Parking

`app/parking/page.tsx` · `lib/googleSheetsParking.ts` · `/api/parking/*`

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

## 3. Atelier

`app/atelier/page.tsx` · `lib/googleSheetsAtelier.ts` · `/api/atelier/*`

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

`app/depot/page.tsx` · `lib/googleSheetsDepot.ts` · `/api/depot/*`

**A byte-for-byte structural clone of Parking** — same 15 columns, same 12
XLOOKUP formulas verbatim (checked via a FORMULA-render read, not inferred from
resemblance). Only `ACTION` is editable. Reuses `ParkingAddResponse` /
`ParkingAddResultItem` rather than declaring identical types.

## 5. RDV

`app/rdv/page.tsx` · `lib/googleSheetsRdv.ts` · `lib/googleSheetsRdvMonthly.ts` ·
`lib/rdvIdentity.ts` · `/api/rdv/*`

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

`useVehicleZone(imm)` ([`hooks/useVehicleZone.ts`](../hooks/useVehicleZone.ts))
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
