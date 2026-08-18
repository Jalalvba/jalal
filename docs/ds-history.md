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

`/api/query/search` exists but **has no caller**: `page.tsx:822` notes the
current implementation filters the already-fetched list "unlike the old
/api/query/search server route". Flagged in Phase 2.

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
