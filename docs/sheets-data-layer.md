# Google Sheets data layer

> **Summary-level doc.** The mandatory rules live in [`AGENTS.md`](../AGENTS.md)
> (rules 3–4) and the security reasoning in
> [`SECURITY_VERIFICATION.md`](../SECURITY_VERIFICATION.md) §4. This page maps
> the layer and records the decisions that aren't captured there.

**Files:** [`src/lib/sheets/googleSheetsClient.ts`](../src/lib/sheets/googleSheetsClient.ts) (shared
core) · `src/lib/sheets/googleSheets{Bdd,Parking,Atelier,Depot,Rdv,RdvMonthly,Rl,Import}.ts`
(one per tab) · [`src/lib/sheets/rdvIdentity.ts`](../src/lib/sheets/rdvIdentity.ts)

---

## 1. Shape

One shared JWT client, one module per Sheet tab. **Never per-tab copies of the
client, the cache, or the error helpers.**

`src/lib/sheets/googleSheetsClient.ts` owns:

| Export | Purpose |
|---|---|
| `getSheetsClient()` | Singleton JWT client (cached on `global`) |
| `withCache` / `invalidateCache` | Generic `unstable_cache` wrapper, keyed by string — **not** Sheets-specific; `src/lib/mongo/sheetFieldOptions.ts` reuses it |
| `verifyRowIdentity()` / `RowIdentityError` | The write guard, §3 |
| `serialToUTCDate` · `dateToSerial` · `nowToSerial` · `isoDateToSerial` | Sheet-serial ↔ Date |
| `fmtDateOnlySlash` · `fmtDateOnlyDash` · `fmtDateTime` | Display formatting |
| `columnIndexToLetter()` | 1-based index → A1 column letter |

Retry/caching is applied by wrapping the googleapis methods themselves
(`spreadsheets.get`, `values.get/update/batchUpdate/batchClear`,
`spreadsheets.batchUpdate`) — so every caller inherits it without opting in.

**Why `googleapis`' own re-exported `auth.JWT`** rather than the standalone
`google-auth-library`: googleapis bundles its own pinned copy internally, which
is structurally incompatible with a separately-installed top-level package
despite near-identical version numbers. The auth client and `google.sheets()`
must agree on the same class instance.

---

## 2. Tabs

Two spreadsheets. `GOOGLE_SHEETS_ID` holds everything except the monthly
appointment calendars, which live in `GOOGLE_RDV_SHEETS_ID`.

| Tab | Module | Editable surface |
|---|---|---|
| **BDD** (`gid=868042157`) | `googleSheetsBdd.ts` | 7 fields — see [`suivi-rl.md`](./suivi-rl.md) |
| **PARKING** (`gid=1215781154`) | `googleSheetsParking.ts` | `IMM`, `ACTION`, `TIMESTAMP` |
| **ATELIER** | `googleSheetsAtelier.ts` | `COMMENTAIRE`, `CATÉGORIE`, `TECHNICIEN`, `BESOIN PIÈCE` |
| **DEPOT** (`gid=1365327220`) | `googleSheetsDepot.ts` | `ACTION` only |
| **RDV** (`gid=2066154497`) | `googleSheetsRdv.ts` | all 8 columns |
| monthly calendars | `googleSheetsRdvMonthly.ts` | the real source for RDV — see [`fleet-pages.md`](./fleet-pages.md) |
| RL / Import | `googleSheetsRl.ts`, `googleSheetsImport.ts` | read-only, feed DS History |

Every tab's header row was **confirmed by a live `spreadsheets.values.get()`**,
recorded in [`src/types/index.ts`](../src/types/index.ts)'s per-tab comment blocks. Those
comments are the record of what was actually read — not assumptions.

**Headers are read live at runtime**, not from `BDD_HEADERS`. The hardcoded
lists exist for the UI layer (labels, field order) and the editable allowlists.
`getHeaderRow()` scans `A1:CZ1` — wide enough that a realistic header row can't
truncate (verified to column BZ) without hardcoding the sheet's real width.
Cached 5 min.

**Sic spellings are real, not typos introduced here:** `TECHNICEIN`,
`FOUNISSEUR`, `Technicein_ds`, `station_départ`. They match the actual header
cells. Fixing them here breaks the column map.

---

## 3. Write safety

### 3.1 `verifyRowIdentity()` — mandatory (AGENTS rule 3)

Parking/Atelier/Depot deletes issue a **real** `deleteDimension`, shifting every
row below up by one. A client-held `rowIndex` captured before that shift would
silently write to a different vehicle's row.

`verifyRowIdentity()` does a cheap single-cell read of the row's key column
(`IMM`, or `Matricule` for RDV), normalises both sides (`trim().toUpperCase()`),
and throws `RowIdentityError` on mismatch:

> `This row has changed since you loaded it (expected "X", found "Y"). Refresh the page and try again.`

`RowIdentityError extends ApiError(409)`, so `toErrorResponse()` maps it
automatically — no per-route `instanceof` check. Called from
`googleSheets{Bdd,Parking,Atelier,Depot}.ts`.

### 3.2 RDV uses identity re-resolution instead

RDV rows are **not** keyed by plate — the same `Matricule` legitimately appears
across many appointments, and there's no `TIMESTAMP` to bump. So a key-cell
check can't disambiguate.

Instead, `src/lib/sheets/rdvIdentity.ts`'s `resolveUniqueMatch()` re-resolves the row by
**full-content match**, returning `null` on no-match and **throwing on an
ambiguous match rather than guessing** (`b11035b`). Update and clear never trust
a client-held `rowIndex`.

### 3.3 `RAW` vs `USER_ENTERED`

| Module | Mode |
|---|---|
| `googleSheetsRdv.ts`, `googleSheetsRdvMonthly.ts` | **`RAW`** (all writes) |
| `googleSheetsBdd.ts` add-row (`:365`) | `RAW` |
| `googleSheetsBdd.ts` field updates (`:287`), Parking, Atelier, Depot | `USER_ENTERED` |

> **RDV must use `RAW`.** `USER_ENTERED` strips leading zeros from digit-only
> text — it destroys phone numbers in the `Contact` column. Dates are written as
> **precomputed serials** (`isoDateToSerial`) precisely so `RAW` still produces
> a real date cell.

This is load-bearing and easy to "clean up" into a regression.

### 3.4 RDV dual-write ordering

Every RDV add/update/clear writes the **monthly tab first** (the durable source
of truth), then the **flat `RDV` mirror**.

**Why that order:** the flat tab is rebuilt periodically by a Google Apps
Script. A mirror-only write is destroyed on the next rebuild. So a monthly-tab
failure aborts with a clean error, while a flat-tab failure (retried once)
degrades to a `warning` on an otherwise-successful response rather than a hard
failure.

### 3.5 Editable-field allowlists

`BDD_EDITABLE_FIELDS` (7), `ATELIER_EDITABLE_FIELDS` (4), `RDV_EDITABLE_FIELDS`
(8). Enforced **server-side** in the corresponding module — the client list is
for UI only.

The original GAS `updateCellFromWeb()` accepted **any** column name, including
read-only XLOOKUP columns. That is deliberately not reproduced.

---

## 4. Caching

| Cache | TTL | Invalidated by |
|---|---|---|
| Per-tab rows (`rows:BDD` etc.) | short, per module | each tab's `/api/*/refresh` route |
| Header rows (`headers:BDD` etc.) | 5 min | — |
| `getIMMList()` | **1 week** (`143041a`) | `/api/trigger-import` on a successful `parc` run |
| `sheetFieldOptions:all` | 5 min | `/api/config/options` POST |
| Vehicle suggestion list | — | `/api/trigger-import` on `parc` **or** `cp` success |

The `Actualiser` button on every list page is a **genuine** hard refresh
(`93da3c0`): it POSTs the tab's `/refresh` route to bust the server cache, *then*
`refetchQueries` client-side. A client-only refetch would have re-read the same
stale server cache.

---

## 5. Known limitations

1. **`GOOGLE_SHEETS_ID` is validated at module scope** — `googleSheetsBdd.ts:24`
   throws at import time if it's missing. Deliberate for an app-wide requirement
   (contrast `GEMINI_API_KEY`, read per-request; see
   [`ai.md` §3](./ai.md#3-gemini_api_key-handling)).
2. **The Sheets API has no server-side row filter.** Every read pulls the full
   range regardless of caller — which is why `useVehicleZone` reuses page caches
   instead of a dedicated "does plate X exist" endpoint.
3. **`verifyRowIdentity()` closes the shift window, not the edit window.** Two
   tabs editing *different fields* on the same row still last-write-wins per
   cell.
4. **Duplicate header names break reads silently.** BDD once had two `Technicien`
   columns (`fd6617b`), making `getSheetRows()` return the wrong value with no
   error. Handled now, but the failure mode is silent.
5. **`GOOGLE_RDV_SHEETS_ID` is Production-scope only on Vercel.** A Preview
   deployment touching RDV code needs its own value via `vercel env add`.
