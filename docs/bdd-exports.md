# BDD exports — PDF and Excel

**Primary files:** [`app/api/bdd/export/route.ts`](../app/api/bdd/export/route.ts)
(PDF) · [`app/api/bdd/export-excel/route.ts`](../app/api/bdd/export-excel/route.ts)
(Excel) · client helpers in
[`app/suivi-rl/page.tsx:96`](../app/suivi-rl/page.tsx#L96)

Tests: `app/api/bdd/export/__tests__/isValidRow.test.ts`,
`route.test.ts`, `route.mongo-down.test.ts`.

> **These two routes are documented together on purpose.** They share the
> payload shape, the validation caps, the rate-limit sizing, and near-identical
> client download helpers — but they are **two independent implementations that
> validate separately**. Every historical drift bug between them came from
> changing one and not the other. Read both columns of every table below.

---

## 1. Contract

Both are `POST`, both take the same body, both return a binary attachment.

```ts
{
  rows: { IMM, client, modele, Emplacement, commentaire }[],
  activeFilters: { label: string; value: string }[],
  searchTerm?: string
}
```

| | PDF | Excel |
|---|---|---|
| Route | `/api/bdd/export` | `/api/bdd/export-excel` |
| Library | `pdf-lib` (dynamic import) | `exceljs` (dynamic import) |
| Content-Type | `application/pdf` | `…spreadsheetml.sheet` |
| Server filename | `bdd-export.pdf` | `bdd-export.xlsx` |
| `runtime` / `dynamic` | `nodejs` / `force-dynamic` | `nodejs` / `force-dynamic` |
| `maxDuration` | 30 | 30 |
| Rate limit | 20 / 5 min, bucket `bdd-export` | 20 / 5 min, bucket `bdd-export-excel` |
| Row validator | `isValidRow()` | `isValidExcelRow()` |

**Separate rate-limit buckets** — exporting a PDF does not consume the Excel
budget. `20 req / 5 min` matches `app/api/export/route.ts`'s DS-History export:
these are read-only report generators, so they deliberately do **not** sit in
the 17-route `30/min` Sheets-mutation bucket.

**Why `exceljs` rather than reusing something:** this is the app's first Excel
export. Confirmed there was no existing xlsx utility — the repo had only
`pdf-lib` (PDF) and `docx` (DS History's Word export). Noted at
[`export-excel/route.ts:61-63`](../app/api/bdd/export-excel/route.ts#L61).

---

## 2. Column list and order — **identical in both**

| # | Payload key | PDF header | Excel header | PDF width | Excel width |
|---|---|---|---|---|---|
| 1 | `IMM` | `IMM` | `IMM` | **115 pt fixed** | 16 |
| 2 | `client` | `Client` | `Client` | weight 1.6 | 24 |
| 3 | `modele` | `Modèle` | `Modèle` | weight 1.1 | 16 |
| 4 | `Emplacement` | `Emplacement` | `Emplacement` | weight 1.3 | 16 |
| 5 | `commentaire` | `Commentaire` | `Commentaire` | weight 2.3 | 50 (wrapped) |

PDF: [`route.ts:304-310`](../app/api/bdd/export/route.ts#L304).
Excel: [`route.ts:83`](../app/api/bdd/export-excel/route.ts#L83) and `:93-101`.

Both documents open with the same three header lines before the table:

1. `Rapport BDD — Suivi RL`
2. `Généré le {date} à {heure}  ·  {n} véhicule(s)`
3. `Filtres actifs — {label}: {value}  ·  …` — or `Aucun filtre actif`

Navy `#1E3A5F` is shared between the PDF header bar and the Excel header row
fill, deliberately (`export-excel/route.ts:86`).

---

## 3. What is deliberately excluded, and why

**Excluded from the table in both:** `ETAT`, `prestataire`, `flag`, `Catégorie`,
`Technicien`, `date_fin_contrat`, `date`, and the 15 other read-only BDD
columns.

**The original rationale:** with a single-select cascade, every exported row
shared the same value for each filter axis — a value already printed on the
"Filtres actifs" line. A per-row column would have repeated the same string on
every row.

### 3.1 The redundancy argument expired — the exclusion did not

**As of `c0d5965`, all four axes are multi-select** — Flotte (`ETAT`),
Emplacement, Prestataire, Flag. So the redundancy argument no longer holds for
`ETAT`, `prestataire`, or `flag` either: an export can now legitimately span
several `prestataire` values at once, and the header line alone can't tell you
which row is which — **exactly the argument that earned `Emplacement` its
column.**

They stay excluded anyway, for a **different and still-current reason**: this is
a portrait A4 table, and the five columns already consume the page width —
Commentaire needs the space it has. Adding a sixth means re-measuring every
weight against real live values (§4.2), not just appending to `BddExportRow`.

> The comment at
> [`export/route.ts:34`](../app/api/bdd/export/route.ts#L34) previously still
> gave the expired reason ("*since none of those axes support selecting multiple
> values*"). Corrected to state the width constraint instead.

`Catégorie`, `Technicien`, and `date_fin_contrat` are **not** filter axes on
this page at all, so their exclusion is unaffected by any of this.

---

## 4. Emplacement: the addition and the truncation bug

Two commits, in order — the second exists because of the first.

### 4.1 `12bdc5e` — Excel gets Emplacement, PDF does not

When multi-select landed, Emplacement was added to the **Excel** export only.
The reasoning ([`export-excel/route.ts:21`](../app/api/bdd/export-excel/route.ts#L21)):
a multi-select Emplacement filter means one export can span several Emplacement
values, so per-row Emplacement stopped being redundant with the header line.

### 4.2 `e3bc354` — the PDF gets it too, and the width has to be solved

Adding a fifth column to a fixed-width portrait A4 table means the other four
give up space. The naive fix — give Emplacement the same weight as `modele`,
since both hold "short" values — **truncates**.

**The measurements** (via `pdf-lib`'s `widthOfTextAtSize`, on a real export
whose PDF content stream was decoded to confirm the truncation — not estimated):

| String | Font / size | Required width |
|---|---|---|
| `"Emplacement"` (the column header) | Helvetica-Bold 10 | ~65 pt |
| `"INTROUVABLE"` (live `EMPLACEMENT_INTROUVABLE` value) | Helvetica 10 | ~70 pt |
| `modele`'s weight `1.1` | — | too narrow for both |
| `Emplacement`'s weight `1.3` | — | **~84 pt** ✓ |

Hence [`route.ts:300`](../app/api/bdd/export/route.ts#L300):

```ts
const IMM_W = 115;
const restWeights = { client: 1.6, modele: 1.1, emplacement: 1.3, commentaire: 2.3 };
```

**Why `IMM_W` is fixed in points, not a weight:** a real plate
(`"94102-E-1"`) measures ~90–95 pt at 20 pt bold. 115 pt clears every real
value plus cell padding on both sides. Making IMM proportional would let it
shrink below a real plate's width as other columns grow.

> **If a sixth column is ever added, re-measure.** The weights are not
> arbitrary; each was chosen against a real measured string. Adding a column
> without re-running `widthOfTextAtSize` against the longest live value will
> silently truncate the narrowest column.

### 4.3 The stale comments this left behind (now corrected)

Landing the PDF's Emplacement column in a follow-up commit left three comments
describing the intermediate state, in which only the Excel export had it. All
three have been corrected:

| Location | Said | Now |
|---|---|---|
| [`suivi-rl/page.tsx:154`](../app/suivi-rl/page.tsx#L154) | *"…why the PDF export deliberately omits it and this one doesn't"* | notes both exports include it, and which commit added each |
| [`export-excel/route.ts:21`](../app/api/bdd/export-excel/route.ts#L21) | *"Unlike the PDF export's `BddExportRow`…"* | notes the two row types are now identical, and why they stay separately declared |
| [`export/route.ts:150`](../app/api/bdd/export/route.ts#L150) | *"only 4 (narrower) columns now"* | 5 |

> **The pattern worth noticing:** each comment was accurate when written and
> falsified by the *next* commit, which changed behaviour without revisiting the
> prose around it. That is the failure mode
> [`ARCHITECTURE.md`](../ARCHITECTURE.md#keeping-this-accurate) asks you to
> avoid — update the doc in the same commit as the behaviour.

---

## 5. Validation and defensive caps — identical in both

| Constant | Value | Why |
|---|---|---|
| `MAX_ROWS` | 2000 | Live BDD tab has ~85 rows; this rejects a malformed/oversized payload before it costs real function time. |
| `MAX_FIELD_LENGTH` | 500 | Applies to `IMM`, `client`, `modele`, `Emplacement`. |
| `MAX_COMMENTAIRE_LENGTH` | 2000 | Higher because real free-text notes legitimately run to a few paragraphs. |

**Why per-field caps exist at all:** `MAX_ROWS` alone still permitted
`MAX_ROWS × unbounded field length`. Confirmed live: **2000 rows × 20 KB
commentaire each took 106 s of CPU and produced an 18.7 MB PDF.** The caps were
added in `cacef201` (M5/M6) as the actual fix.

`isValidRow()` / `isValidExcelRow()` are **strict**: every one of the five keys
must be `typeof === "string"`. A single non-string field rejects the **entire
batch** with `400 Missing or invalid 'rows'` — not just that row.

> This is why the client `String()`-coerces every field. See
> [`suivi-rl.md` §10.1](./suivi-rl.md#10-known-limitations--edge-cases) — a
> `modele` arriving as a raw number from the Sheet broke exports silently until
> `77f9eef`.

Error responses, in order of check: invalid JSON → `400` · non-object body →
`400` · rows not an array / any row invalid → `400` · `rows.length === 0` →
`400 No rows to export` · `> MAX_ROWS` → `400` · malformed `activeFilters` →
`400` · non-string `searchTerm` → `400`.

---

## 6. PDF-specific: text sanitisation and layout

### 6.1 `sanitize()` — [`route.ts:176`](../app/api/bdd/export/route.ts#L176)

`pdf-lib`'s `StandardFonts` are **WinAnsi-encoded** and throw on anything they
can't encode. Applied in order:

1. `\r \n \t \x00-\x1f \x7f` → space
2. **`\x80-\x9f` (C1 controls) → space**
3. Exotic spaces (`          　`) → space
4. Curly quotes → `'` / `"`
5. En-dash/minus → `-`; em-dash → `--`; ellipsis → `...`
6. Catch-all: anything outside `\x20-\xff` → `?`

**Step 2 is a real bug fix (`5012a0a`, audit I1), not defensive padding.** The
C1 range sits *inside* `\x00-\xff`, so the catch-all in step 6 let it through
untouched. A `Commentaire` or search term containing one — typically from a
Windows-1252-mangled paste — **crashed the entire export with an opaque
`500 BDD export failed`**.

### 6.2 Layout

Portrait A4 (595.28 × 841.89), 36 pt margins.

| Constant | Value |
|---|---|
| `IMM_SIZE` | 20 (bold, navy, vertically centred) |
| `BODY_SIZE` / `HEADER_SIZE` | 10 |
| `LINE_H` | 14 |
| `CELL_PAD_TOP` / `CELL_PAD_BOTTOM` | 6 / 8 |
| `HEADER_H` | 26 |

**Why IMM is 20 pt:** the plate is the one thing fleet staff scan for "across a
desk". Row padding is generous for the same reason — a typical 22-row filtered
export should fill the page, not sit as a dense block above whitespace
(`8012835`).

**Row height** is `max(IMM_SIZE × 1.1, commentLines.length × LINE_H)` plus
padding. Without the `max`, a one-line comment would size the row from `LINE_H`
alone, leaving no room for a 20 pt IMM and pushing it into the adjacent row.

**Commentaire is the only wrapped column** (`wrapText`, never truncated). It
falls back to hard character-breaking for a single word wider than the column.
Every other column uses `truncate()` — measure, then trim characters until
`text + "..."` fits.

Zebra striping on odd rows, a hairline rule under each row, and a right-aligned
`BDD · {date} · Page n / N` footer on every page.

---

## 7. Client side — [`app/suivi-rl/page.tsx`](../app/suivi-rl/page.tsx)

`downloadBddPdf()` (`:96`) and `downloadBddExcel()` (`:159`) are deliberate
near-duplicates.

**Both send `searched`** — the rows currently on screen, post-cascade and
post-search — **never the full dataset**. `handleExportPdf` /
`handleExportExcel` (`:691-696`) pass `searched`, `activeFilters`, and
`search.trim()`.

**Filename:** `bdd-export-{YYYY-MM-DD}[-{slug}].{pdf|xlsx}`, where `slug` is
every active filter value plus the search term, accent-stripped and kebab-cased
by `slugify()` (`:88`). The server's own `Content-Disposition` filename is
overridden by the client's `a.download`.

Both buttons disable on `searched.length === 0` and show a spinner while
generating. Failures surface via a native `alert()` — inconsistent with the
rest of the app's `sonner` toasts (noted in
[`suivi-rl.md` §10.6](./suivi-rl.md#10-known-limitations--edge-cases)).

---

## 8. Known limitations

1. **The two routes are kept in sync by hand.** Both files say so explicitly
   ("kept in sync deliberately, not derived, since the two routes validate
   independently"). A shared schema module would remove the drift class
   entirely — see Phase 2.
2. **No auth check inside either route.** Both rely on `proxy.ts`'s
   session gate, same as every other `app/api` route. Deliberate, not an
   omission.
3. **`MAX_ROWS = 2000` is ~23× the live row count.** Generous by design, but it
   means a bug that duplicates rows client-side would still be accepted.
4. **PDF loses all colour semantics.** Flag colours, ETAT badges, and the
   INTROUVABLE red tint are all screen-only. The export is a plain table.
5. **Excel has no formatting beyond widths, wrap, and the header fill** — no
   freeze panes, no autofilter, no per-row conditional formatting.
6. **Neither export includes the zone-detection columns**
   (`ATELIER`/`DEPOT`/`PARKING`) or any `_row` identifier, so an exported row
   can't be traced back to a sheet row.
