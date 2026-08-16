# Articles

> **Summary-level doc.** Full chronology in
> [`PROJECT_HISTORY.md`](../PROJECT_HISTORY.md) §2.

**Files:** [`app/articles/page.tsx`](../app/articles/page.tsx) ·
[`app/api/article/route.ts`](../app/api/article/route.ts)

A parts/article lookup across the Mongo `ds` and `bc` collections — "which
vehicles consumed this part, and at what price".

---

## 1. `GET /api/article`

| Param | Default | Bounds |
|---|---|---|
| `article` | — | **required**; 400 if absent |
| `brand` | `""` | optional |
| `year` | — | optional |
| `limit` | 200 | clamped 1–500 (`clampInt`) |

Rate-limited **20 requests / 5 minutes** per IP (bucket `article`), Mongo-backed
atomic `$inc` — added in `150918f` (audit item 10). Exceeding it returns 429
with a `Retry-After` header and a French message.

**All user input reaching a `$regex` goes through `escapeRegex()`**
([`lib/regex.ts`](../lib/regex.ts)) — mandatory per [`AGENTS.md`](../AGENTS.md)
rule 4. This closes both regex injection and ReDoS.

`clampInt()` bounds `limit` rather than trusting the query string, so a
`?limit=999999` can't turn one request into an unbounded scan.

---

## 2. Search behaviour

Case-insensitive `$regex` with `$options: "i"` against
`Description article` / `Marque` / `Modele`.

> **Known, deliberate limitation.** Unlike `parc`'s plate-prefix search — fixed
> in `ede32dd` by dropping the case-insensitive flag and uppercasing instead —
> these queries are **not anchored to a prefix** and therefore **cannot use a
> standard B-tree index**. Every article search falls back to a collection scan.
>
> This is listed in `PROJECT_HISTORY.md` §3 and `CLAUDE.md` §4 as an accepted
> limitation, not a gap to fix. Accepting it is what the rate limit compensates
> for.

---

## 3. Pricing

BC pricing is shown here, with a BC/DS toggle and CMD Num display (`4c67dec`).

Two corrections worth remembering:

- **A 20% margin was being applied to article prices and was removed**
  (`42461fa`). Prices are the source values, unadorned.
- **`qte: 0` is a legitimate value.** It must not be hidden behind the `"—"`
  fallback (`d4d33be`) — a real zero-quantity line is meaningful data, not a
  missing one.
- The unnecessary `$toDate` wrapper on `Date BC` was dropped (`bccc399`).

---

## 4. Known limitations

1. **Non-indexable search** — §2. The headline one.
2. **No export.** Unlike DS History (`/api/export`) and Suivi RL
   ([PDF/Excel](./bdd-exports.md)), Articles results are screen-only.
3. **`limit` caps at 500**, with no pagination — a broader query is silently
   truncated rather than paged.
4. **Field names are validated by CI**, not by the route — see
   [`field_registry.json`](./fleet-data-import.md#6-related-field_registryjson).
   A renamed Mongo field fails the build, not the request.
