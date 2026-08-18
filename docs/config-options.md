# Config-driven dropdown options

**Primary files:** [`src/lib/mongo/sheetFieldOptions.ts`](../src/lib/mongo/sheetFieldOptions.ts) ·
[`src/app/api/config/options/route.ts`](../src/app/api/config/options/route.ts) ·
[`src/hooks/useSheetFieldOptions.ts`](../src/hooks/useSheetFieldOptions.ts) ·
[`src/app/admin/config/page.tsx`](../src/app/admin/config/page.tsx) ·
[`scripts/seed-sheet-field-options.ts`](../scripts/seed-sheet-field-options.ts) ·
[`src/types/index.ts:209-427`](../src/types/index.ts#L209)

Tests: `src/lib/__tests__/sheetFieldOptions.test.ts`,
`src/lib/__tests__/adminConfigKeys.test.ts`,
`src/app/api/config/options/__tests__/route.test.ts`, `e2e/admin-config.spec.ts`.

Introduced by `76d60b5` ("Stage 1 of config-driven sheet structure"), hardened
by `5cf0eed` (audit C2) and `48f3fec` (audit I4).

---

## 1. What moved, and what explicitly did not

**Stage 1 moved dropdown option *values* out of hardcoded arrays and into
Mongo**, admin-editable at `/admin/config` without a deploy.

| Moved to Mongo | Explicitly still hardcoded |
|---|---|
| The 7 option lists below | `BDD_HEADERS` (sheet column names) |
| | `BddRow` (the TypeScript shape) |
| | `BDD_EDITABLE_FIELDS` (the write allowlist) |
| | `FLAG_COLOR_CLASSES` / `DOT_COLOR_CLASSES` |
| | `PALETTE_COLORS` (the 6 allowed colours) |

> Headers, row shape, and the editable allowlist are **out of scope for this
> stage by decision, not by omission** — stated at
> [`src/lib/mongo/sheetFieldOptions.ts:20`](../src/lib/mongo/sheetFieldOptions.ts#L20) and
> [`src/types/index.ts:213-216`](../src/types/index.ts#L213). The colour-class maps are a
> **design-system** concern, not sheet data, and deliberately do not move: an
> admin picks *which* of six palette colours a value carries, never what
> `"red"` renders as.

### The 7 option keys

`OPTION_KEYS` ([`src/types/index.ts:272-280`](../src/types/index.ts#L272)):

| Key | Type | Fallback constant |
|---|---|---|
| `EMPLACEMENT_OPTIONS` | plain `string[]` | `EMPLACEMENT_OPTIONS_FALLBACK` |
| `ETAT_OPTIONS` | plain | `ETAT_OPTIONS_FALLBACK` |
| `FLAG_OPTIONS` | **colored** | `FLAG_OPTIONS_FALLBACK` |
| `CATEGORIE_OPTIONS` | plain | `CATEGORIE_OPTIONS_FALLBACK` |
| `TECHNICIEN_OPTIONS` | plain | `TECHNICIEN_OPTIONS_FALLBACK` |
| `PRESTATAIRE_OPTIONS` | **colored** | `PRESTATAIRE_OPTIONS_FALLBACK` |
| `RDV_CONVOYEURS` | plain | `RDV_CONVOYEURS_FALLBACK` |

"Colored" (`COLORED_OPTION_KEYS`) means `{ value, color: PaletteColor | null }[]`
rather than `string[]`. `color: null` means no colour assigned — most
`PRESTATAIRE` values.

`COLORED_OPTION_KEYS` and the admin UI's plain/colored split are **derived from
one list**, not hand-copied into each (`48f3fec`, audit I4) — the drift that
fix closed.

---

## 2. The `*_FALLBACK` constants are NOT dead code

This is the single most likely wrong deletion in this codebase, so it is stated
loudly in `src/types/index.ts:218-224` and repeated here.

Each `*_FALLBACK` constant serves **three** live purposes:

1. **Server-side degradation** — `getAllSheetFieldOptionsWithStatus()` falls
   back **key by key** when a key has no Mongo document yet, and **wholesale**
   when Mongo is unreachable.
2. **Client-side degradation** — `CLIENT_FALLBACK` in
   [`useSheetFieldOptions.ts:27`](../src/hooks/useSheetFieldOptions.ts#L27)
   renders real values on first paint instead of empty dropdowns.
3. **Seed data** — `scripts/seed-sheet-field-options.ts` inserts exactly these
   values as the initial Mongo documents.

They were captured **verbatim from what was live immediately before the
migration** — so the migration starts from parity, not a silent reset. The
`FLAG_OPTIONS_FALLBACK` merge is instructive: the old code had a separate
`FLAG_OPTIONS` list **and** a `FLAG_STYLE` colour map that had to be kept in
sync by hand. Merging them into one `{value, color}[]` is precisely the drift
class this migration closes.

> **Net effect:** a total Mongo outage degrades to *"dropdowns frozen at their
> last-known-good values"*, never to an app that can't render its own dropdowns.

---

## 3. Read path

```
page component
  └─ useSheetFieldOptions()          TanStack Query, staleTime 5 min
       └─ GET /api/config/options
            └─ getAllSheetFieldOptionsWithStatus()   withCache, TTL 5 min
                 └─ Mongo "sheetFieldOptions".find({})   one query, all 7 docs
                      └─ per-key fallback for any missing doc
```

**One Mongo query for all seven keys**, not seven. **One HTTP request per page**
regardless of how many components call the hook — TanStack Query dedupes by key,
so a list page's chip row *and* every card's editors share one fetch.

**Both TTLs are 5 minutes**, matching `src/lib/sheets/googleSheetsBdd.ts`'s header cache
rather than inventing a third number. Options change "once every few weeks".

`withCache`/`invalidateCache` are reused from
[`src/lib/sheets/googleSheetsClient.ts`](../src/lib/sheets/googleSheetsClient.ts) — despite the module
name they are a generic `unstable_cache` wrapper keyed by an arbitrary string,
not Sheets-specific. Reused rather than duplicating 15 lines under a new name.

### 3.1 `cloneFallback()` — why the deep clone matters

```ts
function cloneFallback(): AllSheetFieldOptions {
  return JSON.parse(JSON.stringify(FALLBACK));
}
```

`FALLBACK`'s arrays must **never** be handed out by reference. A caller mutating
what it believes is its own copy would corrupt the process-wide fallback that
every other request on that warm instance also serves.

### 3.2 `degraded` vs. "no document yet" — a deliberate distinction

```ts
type SheetFieldOptionsResult = { options; degraded: boolean; meta: Record<OptionKey, string | null> };
```

- **`degraded: true`** — Mongo itself was unreachable; the *whole* collection
  fell back. A real outage.
- **`meta[key] === null`** — that one key has no document yet. Expected
  pre-seed behaviour, **not** an outage.

Conflating them would either cry outage on a normal pre-seed read or hide a real
one. `/admin/config` needs to tell them apart to decide whether editing is safe.

---

## 4. Write path

`POST /api/config/options` → `updateFieldOptions()` → Mongo → `invalidateCache()`.

**Whole-set replace, not per-item patch.** The lists hold 5–20 entries; a
replace is simpler and matches how the admin UI actually edits.

### 4.1 Validation, in order

**Route layer** ([`route.ts:44`](../src/app/api/config/options/route.ts#L44)):

| Check | Failure |
|---|---|
| `key` ∈ `OPTION_KEYS` | 400 |
| `options` is an array | 400 |
| `options.length ≤ 100` (`MAX_OPTIONS`) | 400 |
| `expectedUpdatedAt` is string \| null \| undefined | 400 |
| each entry's shape matches the key's plain/colored type | 400 |
| each value ≤ 200 chars (`MAX_VALUE_LENGTH`) | 400 |

Then **trim before storage** (`:97-99`). Subtle and load-bearing: without it,
`"ALI "` passes validation (which checks the *trimmed* form for
emptiness/duplicates) yet **persists untrimmed**, and then silently fails to
match trimmed sheet data everywhere it is compared.

**Library layer** (`validatePlain` / `validateColored`): non-empty list · no
blank values · **no duplicates** · colour ∈ `PALETTE_COLORS` or `null`. Throws
`OptionsValidationError` → 400.

`updatedBy` is always `AUTHORIZED_EMAIL` — there is one user (see
[`AGENTS.md`](../AGENTS.md) rule 5), so it is stamped server-side, never taken
from the request.

### 4.2 Optimistic concurrency — the E11000 trick

The client sends `expectedUpdatedAt` (from the `meta` it last read). The write
is then conditioned on the document still carrying that exact timestamp:

```ts
const filter = expectedUpdatedAt === null
  ? { _id: key, updatedAt: { $exists: false } }
  : { _id: key, updatedAt: new Date(expectedUpdatedAt) };

await col.updateOne(filter, { $set: doc }, { upsert: true });
```

**If someone else's write landed in between**, the filter matches nothing — and
because `upsert: true`, Mongo attempts an **insert**, which collides on the
unique `_id` index and throws **E11000**. That is caught and rethrown as
`OptionsConflictError` → **409**.

> This is not a clever hack for its own sake: the conflict is detected
> **atomically by Mongo**, with no check-then-write race window on our side.

`expectedUpdatedAt` is optional for backward compatibility — omitting it gives
the old unconditional-overwrite behaviour. **The route always supplies it.**

A malformed `updatedAt` (e.g. hand-edited in Mongo) is treated as `null` rather
than throwing — one bad document must not take down the read for all seven keys.

### 4.3 Cache invalidation

`invalidateCache(CACHE_KEY)` runs after a successful write, so the next read
anywhere — same instance or a different warm one — sees the change immediately
instead of waiting out the 5-minute TTL. The client additionally
`invalidateQueries` its own key.

---

## 5. `/admin/config` — the edit gate

[`page.tsx:274`](../src/app/admin/config/page.tsx#L274):

```ts
const editingBlocked = isLoading || degraded;
```

**Both conditions block editing, for the same reason from two different
directions** ([`useSheetFieldOptions.ts:22`](../src/hooks/useSheetFieldOptions.ts#L22)):

- **`isLoading`** — the query hasn't resolved, so `options` is
  `CLIENT_FALLBACK`. Saving now would **replace whatever is actually in Mongo
  with the hardcoded constants**.
- **`degraded`** — the query resolved, but the *server* served fallback because
  Mongo was down. Saving would write fallback data over real data.

A visible banner (`data-testid="config-degraded-banner"`) explains the degraded
case rather than leaving the disabled controls unexplained. This is audit item
**C2** (`5cf0eed`).

> **The page is not separately authenticated.** Like every route under
> `src/app/api`, it is gated by `src/proxy.ts`'s session check — the same convention the
> 17 Sheets mutation routes follow.

---

## 6. The seed script

`npx tsx scripts/seed-sheet-field-options.ts` — one-time bootstrap.

- **Not part of the build**; not imported by anything under `src/app/` or `src/lib/`.
- Parses `MONGODB_URI` / `MONGODB_DB` from `.env.local` **manually** — it cannot
  `import { getCollection } from "@/lib/mongo"` because that module throws at
  import time if those vars aren't already in `process.env`, which they aren't
  when `tsx` starts.
- **Idempotent via upsert** — but re-running after an admin has edited a value
  **overwrites their edit** back to the hardcoded original. It is a bootstrap,
  not a sync job.
- **Cannot invalidate the cache** (`b75e390`, audit M10). Confirmed by direct
  testing: `invalidateCache()` wraps Next's `revalidateTag()`, which throws
  *"Invariant: static generation store missing"* outside a real Next
  request/build context. A standalone `tsx` process never has one. **A change
  made by re-running this script can take up to 5 minutes to appear live.**
  That is expected, not a bug.

---

## 7. Known limitations

1. **Rename drift is silent and unguarded.** Several code paths compare against
   literal option values that an admin can rename or delete at `/admin/config`
   with no warning and no error:

   | Constant | Used by | Breaks silently if renamed |
   |---|---|---|
   | `EMPLACEMENT_INTROUVABLE` | Suivi RL card tint, DS History row highlight | red alert styling disappears |
   | `ETAT_INTERNE` / `ETAT_EXTERNE` | Suivi RL's "TOUS" default scope | default view stops matching |
   | `ETAT_DISPONIBLE` | `etatBadgeClass()` | badge falls through to muted |

   `ANNULE`/`ANNULEE` are *not* in this table: nothing compares against them,
   so they already render through `etatBadgeClass()`'s muted fallback and a
   rename changes nothing. Their named constants were removed in 2026-08 once
   confirmed unreferenced; the fact is preserved on that function's docstring
   and pinned by `src/lib/__tests__/etatBadgeClass.test.ts`.

   Centralising the literals in `src/types/index.ts` means a rename needs updating in
   **one** place — **it does not remove the fragility**. Wiring behaviour flags
   into the Mongo documents was deliberately deferred past Stage 1.

2. **`MAX_OPTIONS = 100` / `MAX_VALUE_LENGTH = 200` are unenforced in Mongo.**
   A document written directly to Mongo bypasses them.

3. **No audit trail.** Only the latest `updatedAt`/`updatedBy` is kept — no
   history of prior values.

4. **No cross-key validation.** Nothing checks that a deleted option value is
   still in use by live sheet rows. Deleting `"ATELIER"` from
   `EMPLACEMENT_OPTIONS` leaves existing rows holding a value no longer
   selectable.

5. **`degraded` is per-read, not sticky.** A brief Mongo blip can flip the admin
   page between editable and blocked between refetches.

6. **The 5-minute cache means a save is not instantly visible to *other*
   warm instances** if `revalidateTag` doesn't propagate — usually invisible in
   practice at this scale.
