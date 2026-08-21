# Project history

Permanent record of this project's development history, built directly from
`git log --oneline main` (187 commits, `df5a4c3` → `32631bb`) with diffs
inspected wherever a commit message needed clarification. Every claim below
cites the commit(s) it's based on — nothing here is inferred beyond what a
commit message or its diff actually states.

Sections 1–2 cover `df5a4c3` → `c546f1d` (synchronized by `3c83ed5`); the
two **Continuation** sections after §2 carry the chronology forward through
`c546f1d` → `c0d5965` and `ef630e0` → `32631bb`. For
*current-state* reference documentation — what each feature does today,
rather than when it changed — start at [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## 1. Architecture overview

**Purpose:** AVIS Maroc fleet management — tracks vehicles across parking,
workshop (Atelier), storage (Depot), and appointments/convoyage (RDV),
backed by a live Google Sheet as the system of record for editable
operational data, with MongoDB holding large read-mostly reference
collections (`ds`, `bc`, `parc`, `cp`) used for search/lookup and export.

**Stack:**
- Next.js App Router (React Server Components + API routes)
- MongoDB (native driver, `src/lib/mongo/client.ts`'s `getCollection()`)
- Google Sheets API via a service-account JWT client (`src/lib/sheets/googleSheetsClient.ts`
  and the per-tab modules — `googleSheetsBdd.ts`, `googleSheetsParking.ts`,
  `googleSheetsAtelier.ts`, `googleSheetsDepot.ts`, `googleSheetsRdv.ts`)
- iron-session for authentication state (sealed cookie, no server-side
  session store)
- TanStack Query (React Query) for client-side data fetching/caching
- Tailwind CSS v4 + hand-written shadcn-pattern primitives on Radix UI

**Deployment:** Vercel (env vars pulled via `vercel env pull`; `NODE_ENV`
gates cookie `secure`/CSP `unsafe-eval` behavior between local dev and
production).

## 2. Feature timeline

### Foundation

The repo starts from a plain `create-next-app` scaffold (`df5a4c3`), followed
by a run of undescriptive early commits (`860dfb4`, `131aad1`, `e7128a8`,
`a1ac4c8`, `527feaa`, `c227154`, `906ddb4`, `55f20f0`) during initial buildout.
The first real application logic lands in `f3eb3ee` ("article") and `8c5b7c1`
("jalal sheet", the first `src/app/api/sheet/route.ts` + home page Sheets
integration), followed by `a57ae1f` (iron-session auth added) and `13c4178`
(replacement warnings, dark-mode toggle, sheet colors). `adc6469` merges the
parc/cp/sheet cards, adds RL support, and fixes an import date-dedup bug.
After a credentials scare (`5804355` removed an exposed env file, `967b04d`
removed exposed credentials, `df39166` added a pre-push hook), `12698d3`
builds an early, uncommitted-until-later "suivi BDD" draft page (filters,
flag system, PDF export). A large July 19 audit-driven pass then
consolidates the app: `a91333f`/`563c95e`/`a2b226e` fix phantom export
fields, unify API response types (`src/types/index.ts`, `src/lib/utils/format.ts`), add
consistent error handling, `escapeRegex()` regex-injection protection, and
`.env.example`; `f59cb47` adds the 6 MongoDB indexes recommended by the
original audit (`ds`/`bc`/`parc`/`cp`, cutting DS History search from 339ms
to 45ms). `50b6c46` then formalizes navigation (new home screen, DS History
moved to `/ds-history`) and wires up the first real BDD Sheets integration
(`src/lib/sheets/googleSheetsBdd.ts`, `/api/bdd`, `/api/bdd/update`) reading/writing the
live "BDD" tab (gid `868042157`) through an editable-fields allowlist.

### BDD (Suivi RL)

Read/write integration lands in `50b6c46` (`src/lib/sheets/googleSheetsBdd.ts`,
`/api/bdd`, `/api/bdd/update`, a 6-field editable allowlist). `295e1a8`
migrates the page onto shared fleet src/components/TanStack Query. `8199db9`
replaces the card's tap-to-expand-form pattern with per-field inline commit
(new `SelectSheet` primitive, `useInlineFieldCommit` hook, `InlineEditSelect`/
`InlineEditText`/`InlineEditCombobox` components) — each of the 6 editable
fields now saves independently with an inline emerald-flash confirmation.
Prestataire/Flag chip filters and plate-only search went through several
corrections: `a272cf5` restricted search to plate/WW and dropped name-based
chip filters as a product decision, `e856810` restored the Prestataire/Flag
chips after finding their removal was unintended scope creep from `a272cf5`,
and `1b38ea0` fixed plate search to bypass the active chip filters so a real
plate outside the current chip selection is still findable. The BDD header
row itself needed two live fixes: `fd6617b` found and fixed a duplicate
"Technicien" header collision (silently overwriting the real column with a
mislabeled DATE_DS-formula column) while re-syncing `BDD_HEADERS`/`BddRow`
to the sheet's actual live columns and adding new RDV/CONVOYEUR/Intervention
columns; `6757ffd` then restored `date_ds` as a read-only field after the
sheet owner manually corrected that column's header text back from the
duplicate "Technicien" label. `c0c3258` adds real row delete
(`deleteBddRow()`, `src/app/api/bdd/delete/route.ts`, `useDeleteBddRow()`),
mirroring Parking/Atelier/Depot exactly (`DeleteDimensionRequest`, gated
by `verifyRowIdentity()` so a stale client-held row index 409s instead of
deleting the wrong vehicle's row) — wired into each Suivi RL card via
`RecordCard`'s `onDelete`. *Per the commit's own message, this landed
verified only via UI inspection (button renders, confirm dialog opens),
not a real round-trip against live data — worth a real delete/undo check
before relying on it in production if that hasn't happened since.*

### Parking

Ported from Google Apps Script in `d218c23` (`src/lib/sheets/googleSheetsParking.ts` +
`/api/parking/*` against the live "PARKING" tab). `3e03663` migrates the
page onto shared components + TanStack Query. Delete behavior changed in
`5828d2b`: `deletePlate()` now issues a real Sheets row deletion
(`DeleteDimensionRequest`, shifting rows below up by one) instead of
clearing IMM/TIMESTAMP/ACTION and leaving a hollow row behind; `addPlates()`
correspondingly drops its empty-row-scan-and-reuse logic and always appends
after the last data row (verified live against the real spreadsheet:
add/delete/add round-tripped cleanly with rows shifting by exactly one).
`ede32dd` later adds row-identity verification (`verifyRowIdentity()`)
before any update/delete, guarding against a client-held `rowIndex` going
stale if another delete renumbered the sheet in the meantime.

### Atelier

Ported from Google Apps Script in `14dd75f`, reusing Parking's
`resolveIMM`/`getIMMList` rather than duplicating that logic; its editable
surface (COMMENTAIRE/CATÉGORIE/TECHNICIEN/BESOIN PIÈCE, restricted to an
allowlist) was built directly into this same commit — unlike Parking there
is no ACTION field, and unlike the original GAS `updateCellFromWeb()` the
allowlist blocks writes to read-only XLOOKUP columns. `de1473e` migrates the
page onto shared components + TanStack Query. Zone badge integration
(showing Atelier alongside Parking on BDD/DS History cards) lands in
`0a04f2e`. Delete behavior transitions to real row deletion in the same
`5828d2b` commit that covers Parking/Depot.

### Depot

Built as a full page/feature in `072cc58`, confirmed live to be a
structural clone of Parking (same 15 columns, same 12 XLOOKUP formulas,
only ACTION editable) — reuses Parking's API/UI shape
(`getDepotRows()`/`addDepotPlates()`/`updateDepotAction()`/`deleteDepotRow()`/
`clearDepotAll()`) and supersedes the earlier existence-check-only
`getDepotPlates()` from the zone-badge task with a full rows query. Delete
behavior (real row deletion instead of cell-clearing, dropping the
empty-row-reuse scan) is part of the same `5828d2b` commit that covers
Parking/Atelier. *Note: the commit history contains no reference to a
specific "107 hollow-row" cleanup figure — `072cc58` verifies "all 35 rows
correctly" against the live sheet at build time; no commit message or diff
mentions a 107-row count, so that detail is not included here.*

### RDV

Built as a standalone page in `d1e3f7d` ("RDV" tab, gid `2066154497`; Date/
Heure/Clients/Véhicule/Matricule/Intervention/Contact/CONVOYEUR, all
manually-typed fields, no dedup-by-plate since the same Matricule
legitimately repeats across appointments) — this commit also caught a real
bug pre-ship: writing with `USER_ENTERED` let Sheets reinterpret pure-digit
Contact values (Moroccan phone numbers) as numbers, dropping leading zeros,
fixed by switching to `RAW` writes. `fd6617b` wires RDV/CONVOYEUR/
Intervention as new BDD columns (XLOOKUP formulas reading the RDV tab).
`1248eb8` extends the zone-badge system to also check RDV. `4cb0358` then
surfaces those same 3 BDD fields on DS History's Immobilisation BDD card
(previously a rendering gap — the fields already existed in
`BDD_HEADERS`/`BddRow`, DS History's card just used a hand-picked fixed
field list that didn't include them yet, unlike Suivi RL's dynamically-driven
read-only section which already showed them). With RDV data now surfaced
contextually on BDD cards, `eeec56a` removes the standalone `/rdv` page and
its home nav card as redundant — the data layer
(`src/lib/sheets/googleSheetsRdv.ts`, `/api/rdv/*`, `useRdvRows()`) is deliberately kept
since `useVehicleZone.ts` still depends on it for the zone-badge check and
the API routes remain available for future direct RDV CRUD.

**The standalone page came back**, materially rebuilt, in a 3-commit pass
once the durable-storage gap below was found. `6334120` discovers that the
flat "RDV" tab isn't actually the system of record: it's a GAS-managed
mirror that gets wholesale rebuilt from the monthly calendar tabs
(`GOOGLE_RDV_SHEETS_ID`, e.g. "Juillet 2026") on every sheet
"Synchroniser" run — anything the app had been writing only to the flat
tab would be silently destroyed on the next sync. `addRdvRow()` is changed
to write the monthly tab first (locating the correct day's block by
pattern-scanning header rows, falling back to `insertDimension` when a
block is full), then the flat tab as a fast-read mirror, degrading to a
warning rather than a hard failure if only the mirror write fails; a
read+add-only `/rdv` page and `AddRdvDialog` return, with edit/clear
deliberately left out of this pass since the existing `rowIndex`-based
versions only ever touched the flat tab. `34f5191` closes that gap:
`src/lib/sheets/rdvIdentity.ts`'s `resolveUniqueMatch()` replaces row-number-based
edit/clear entirely, re-scanning both tabs for an exact full-row content
match (date-scoped, whitespace-normalized so the flat tab's cleaned values
and the monthly tab's raw cells compare equal) at write time and refusing
to guess — zero matches or more than one both fail loudly instead of
picking a "closest" row. This wasn't a theoretical concern: checking real
live data before choosing the match fields turned up a genuine duplicate
pair in the monthly tab differing only by Convoyeur, confirming the
ambiguous-match error path is a real case, not defensive-only code.
`d1dcd28` replaces the card list with a day-grouped table (one table per
selected day, matching the monthly tab's own visual shape) plus a date
picker, wiring inline edit through the new identity-based mutations — no
row-number handling anywhere in the page component. `2fea470` adds a
client-side "Exporter" button that downloads the selected day's table as
`rdv-<date>.png` for sharing in WhatsApp. It renders a dedicated
off-screen `ExportTable` (plain markup, not the live interactive table,
so delete icons/InlineEdit chrome are excluded and the live table's
`overflow-x-auto` wrapper can't clip the capture) using `html-to-image`,
picked after `html2canvas` was found to throw "unsupported color function
oklab" on Tailwind v4's oklch-based palette classes while `html-to-image`
(SVG `foreignObject`-based, so the browser's own CSS engine renders it)
handled both semantic tokens and oklch utilities correctly in both
themes. The off-screen node uses `position: fixed` + `width: max-content`
rather than `display:none`/`visibility:hidden` (which would clone as
invisible) or `width: auto` (which was found to shrink-to-fit against the
*viewport* rather than its own content, producing a narrower capture on
mobile for identical data) — verified byte-identical dimensions across
desktop/375px-mobile/dark mode after the fix. `skipFonts: true` avoids a
console error from `html-to-image` otherwise trying to fetch this app's
Google Fonts `@import`, which the CSP's `connect-src` blocks.

`c546f1d` reworked the page's interaction model on the same day: the
per-row trash icon (previously the only delete control, in the table's
actions column) was removed in favor of a top action bar "Effacer"
button, enabled only when an appointment is selected via a new
`SelectToggle` — tapping a row (desktop table) or a card (the new mobile
layout) toggles `selectedRowIndex`, a pure UI selection state that
`handleClear` never trusts directly; it still re-derives the mutation's
actual row identity through the existing
`rdvRowToIdentity()`/`resolveUniqueMatch()` path from `34f5191`, so the
interaction change carries zero risk to the write-safety guarantees built
in that earlier commit. Below the `sm:` breakpoint, the day view now
renders stacked `MobileRdvCard`s (same `InlineEditText`/`InlineEditSelect`
wiring as the table, just re-laid-out for a narrow screen) instead of the
table, which remains for `sm:` and up. A new plate-search box above the
table filters across every loaded appointment on every day, not just the
selected day's `dayRows` — a single match jumps the date picker to that
appointment's day and pre-selects it; multiple matches render a
date-grouped picker to choose from; no matches surface the existing
inline error banner.

### DS History

Search input was progressively simplified: `08a456d` reduced it to
plate-only, dropping Année/Limite inputs; `d794e82` standardized it onto the
shared plate `Combobox` component and dropped VIN as a search dimension;
`3657add` fixed a duplicate-plate display bug in the suggestion label. The
BC-price `$lookup` performance fix (`44760e9`) is the largest single
optimization in the project: the original correlated `$lookup`
(`let`+`pipeline`+`$expr`+`$filter`) never used the `bc` collection's index
regardless of query shape (confirmed via `explain()`), and even a first
restructuring attempt was verified via `explain()` to still fall back to a
full collection scan per outer document — that attempt was reverted after
real timing showed it was slower (11.7s vs. 6.9s) rather than shipped on
theory. The actual fix moved the join out of the aggregation pipeline
entirely: collect every `(cmd_num, code_art)` pair up front, run one
non-correlated `$or` query against `bc` (confirmed via `explain()` to use
`IXSCAN`), then merge in application code. Verified as a zero-behavior-change
optimization via deep output comparison across 6 real plates; real timing
went from 6.6–7.3s down to 127–244ms on the two heaviest plates (39357-B-7,
39067-B-7), and the live `/api/ds/history` HTTP endpoint dropped to
197–589ms across all 6. Zone badges (Parking/Atelier, later RDV/Depot) were
added to DS History's Vehicle card in `0a04f2e` and extended in `1248eb8`/
`bae93f8`.

That BC-price join was later removed entirely, not just its display:
`323497a` deletes the whole `$lookup`-replacement code path
(`collectPairs`/`fetchBcMatches`/`mergeBcPrices`) from `/api/ds/history`,
plus every downstream consumer — `Line.mt_ht`/`price_source` from
`src/types/index.ts`, the Mt HT line column/BC-DS source badge/MAD total on the
page itself, and the by-then-dead `totalMtHt`/`mt_ht` handling in both the
PDF and DOCX export builders (the DOCX total-row branch was already
unreachable — `totalMtHt` was never passed a value at any call site). The
`bc` Mongo collection itself is untouched: `src/app/api/article/route.ts` still
uses it independently for Articles' own price lookups, a fully separate
code path. `24e34cd` then tightens the PDF/DOCX export layout unrelated to
that removal — dropped dead spacer paragraphs, tighter heading/section
spacing, page margins cut from 1" to 0.5" to match the PDF branch, and
removal of a forced page-break that was leaving a near-empty first page —
verified against a real 14-DS-entry export payload (PDF 4→3 pages, DOCX
5→4 pages, no entries lost).

### Zone badges

`0a04f2e` introduces the `useVehicleZone(imm)` hook, checking Parking/
Atelier existence by reusing the already-loaded `useParkingRows()`/
`useAtelierRows()` React Query cache rather than adding a new
existence-check endpoint (Sheets has no server-side row filter, so a
dedicated endpoint wouldn't reduce read cost). Badges render nothing if a
plate is in neither list, and render both badges together if it's in both
— treated as a real, visible data inconsistency rather than something to
hide. `1248eb8` extends the check to RDV, `bae93f8` to Depot. Overlap
handling (a plate appearing in 3–4 zones at once) is confirmed handled via
flex-wrap on the badge row, verified live against a real RDV+Dépôt overlap
in `072cc58`.

### Component redesign

`f1af645` adds the shared foundation as purely additive infrastructure (no
page migrated yet): `src/components/ui/` — hand-written shadcn-pattern
primitives (Button, Input, Dialog, AlertDialog, Combobox, Badge,
ToggleGroup, Sheet, Card) built on Radix UI + cmdk rather than scaffolded
via shadcn's CLI, re-skinned to the app's existing zinc palette from the
start, with touch targets enlarged to ≥40–44px after the audit found
existing icon buttons undersized at ~24–28px; `src/hooks/` — `AppQueryProvider`
(TanStack Query), `useParkingRows`/`useAtelierRows`/`useBddRows`,
`useDarkMode`, `usePlateAutocomplete`, `useEditableState`; and
`src/components/fleet/` — `ListPageHeader`, `PlateSearchInput`,
`PlateFilterInput`, `AddResultsList`, `RecordCard`, `Field`. Pages then
migrate one at a time: Parking (`3e03663`), Atelier (`de1473e`), Suivi RL
(`295e1a8`), with DS History's types/dark-mode toggle/`FieldSelector`
deduped in `14403c3` and the home page's dark-mode toggle deduped in
`51dda77`. `080e6fd` removes confirmed-dead `src/components/ui/` files and an
unused dependency once migration was complete. `8199db9` layers the
per-field inline-commit UX (described under BDD above) on top of this
foundation.

### Theming

A 6-stage audit/fix, fully documented in `baaea19`. Stage 1 (`7005334`)
installs `next-themes`, adds the synchronous no-flash inline script
distinguishing an explicit past choice from no choice yet (time-based
default: 7am–7pm light, computed by `src/lib/utils/themeDefault.ts`'s
`getTimeBasedTheme()`, re-evaluated on every visit until an explicit choice
is made), defines real semantic CSS tokens in `globals.css` (the audit
found zero color tokens existed before this — every component hardcoded a
literal `zinc-900`/etc. value), and removes dead Geist Sans/Mono font
loading that `globals.css`'s own font rules always overrode anyway (verified
via faked-system-clock Playwright tests: 9am/6am/9pm/7pm-exactly all
resolve correctly). Stage 2 (`71bc6e7`) consolidates every toggle into one
`ThemeToggle` component, replacing the old hand-rolled `useDarkMode` hook,
and wires it into every page that previously had none (Parking/Atelier/
Depot/Suivi RL via `ListPageHeader`, Articles, Login). Component-library and
page migrations to the semantic tokens follow in `b20a26c` and `4be5402`
(Parking/Atelier/Depot/Suivi RL/Articles/Login). `420941f` fixes a
false-positive hydration warning the no-flash inline script's nonce
attribute triggered on every load: browsers intentionally blank a
`nonce` attribute on DOM read-back once set (so it can't be exfiltrated
via injected script), which made React's hydration diff see
`server="<real nonce>"` vs. `client=""`; the fix applies the same
`suppressHydrationWarning` next-themes' own inline script already uses
for this exact case.

### Design system, round 2

A second, narrower audit (`6cb1f1b`, `DESIGN_SYSTEM.md` — a persistent
doc, unlike the deleted `AUDIT_REPORT.md`) found color, typography, radius,
and error-banner drift that had accumulated since the first theming pass,
fixed across 7 commits: `f7eeb33` introduces `src/config/zones.ts` as
the single source for each zone's accent color (previously duplicated
across `ZoneBadges`, each list page's header, Suivi RL's card, and
`NavCard`), fixing a real Atelier badge-color mismatch (violet vs. the
page/nav's amber) and reassigning BDD/Suivi RL to violet so its own
nav/header agree — retiring red as a brand color, reserved from here on
for destructive/error/urgent semantics only. `873ad79` fixes
`RecordCard`'s delete button, the one place in the app that fought
`Button`'s shared icon size down to `h-9 w-9` instead of using its
`h-10 w-10` default. `e321bad` extracts a shared `Alert` component from 7
near-duplicated inline error banners — 4 of them (Parking/Atelier/Depot/
Suivi RL) were hardcoded to dark-mode reds with no `dark:` variant at all,
rendering dark-red-on-dark-red in light mode, a real legibility bug rather
than pure style drift. `eb5960c` retires 10 ungoverned one-off
`rounded`/`rounded-md` call sites into the declared 3-tier radius scale.
`0fb7fc6` adds a `--text-micro` token and replaces 28 call sites of 3 ad
hoc arbitrary text sizes (`text-[9px]`/`[10px]`/`[11px]`) across 13 files.
`9837433` drops Playfair Display (5 heading tags app-wide was judged not
enough footprint to justify a second display face) and consolidates
`--font-display`/`--font-body` onto Inter alongside JetBrains Mono; also
defines `--font-sans` so Tailwind's `font-sans` utility itself resolves to
Inter instead of falling back to the system default, fixing
`ListPageHeader`'s page title (a proper-noun label) which had been
rendering in `font-mono`. `f14af4e` finishes the token migration on the
last two holdout pages (Home, DS History), leaving `etatStyle`'s
per-value literal colors as-is (a documented data-driven exception, same
as `FLAG_STYLE`/`ZoneBadges`). `e6f28c7` migrates Suivi RL — the one list
page still hand-rolling its own card header and a readonly-field block
duplicated from the later-extracted `ReadonlyFieldList` — onto
`RecordCard`, extending it with optional `headerLeft`/`headerRight` slots
and an optional `onDelete` (used two commits later by `c0c3258`'s BDD
delete).

### Authentication

The app ran on a shared username/password login (iron-session-backed, with
in-memory per-IP rate limiting added in `a2b226e`) until `003cb74` replaced
it with a Google sign-in button, and `19926c6` implements the actual OAuth
2.0 flow: a start route generating a CSRF `state` token in a short-lived
cookie and redirecting to Google's consent screen (`openid email` scope
only), and a callback route that validates the `state`, exchanges the code,
cryptographically verifies the ID token against Google's own public keys,
and checks the verified email against a single hardcoded constant
(`src/lib/auth/googleOAuth.ts`'s `AUTHORIZED_EMAIL`) — no User model, no MongoDB
collection, no registration flow, confirmed with the user as an explicit
non-goal. No rate limiter was added to the callback route by deliberate
decision: authorization codes are single-use, short-lived, and issued by
Google only after real consent, unlike the password-based login it
replaced. `66940ba` gitignores the downloaded OAuth client secret and lets
the proxy pass the Google auth routes through unauthenticated. `src/proxy.ts`'s
path-exclusion anchoring (exact/prefix matches instead of loose
`startsWith()`, closing a latent auth-bypass footgun for any future route
named e.g. `/login-x`) lands as part of `ede32dd`'s hardening pass, not the
original auth commits.

### Security verification

`ede32dd` is the main hardening commit: exponential-backoff retry on
transient Sheets API errors, distributed row/header caching
(`unstable_cache`+`revalidateTag`, replacing an in-process `Map` that
didn't survive across warm Vercel instances), fail-soft Mongo lookups in
`addPlates()`/`addAtelierPlates()`/`addDepotPlates()`, atomic multi-field
BDD writes, row-identity verification before Parking/Atelier/Depot
writes, `rateLimitOrNull()` applied to all 16 Sheets mutation routes,
`ApiError`/`toErrorResponse()` so routes never leak raw driver exceptions,
dropping the case-insensitive regex on parc's plate-prefix search so it can
use the existing indexes, `src/proxy.ts`'s anchored path matching, and the
per-request nonce-based CSP + `X-Frame-Options`/`X-Content-Type-Options`/
`Referrer-Policy`/HSTS headers. `c5d688f` documents a live re-verification
finding that a claimed "Direct API Origin Bypass" secret-header protection
does not exist in the code and does not apply to this app's single-deployment
Vercel topology. A subsequent full protection-layer assessment (walking
authentication, session handling, CSRF, write safety, input validation,
rate limiting, secrets management, and HTTP headers — the headers section
verified live via `curl -I` against a running dev server, not just read
from config) is recorded in full in `SECURITY_VERIFICATION.md`, not
duplicated here.

### Performance & infrastructure

`f59cb47` adds the 6 MongoDB indexes recommended by the original audit
(`ds`/`bc`/`parc`/`cp` had none beyond the default `_id`), cutting DS
History's primary search from a full 247K-document collection scan (339ms)
to 45ms. `1fac604` extracts a shared Sheets client + date helpers from 5
near-identical per-tab copies. `150918f` adds the first Mongo-backed rate
limiting (`/api/export`, `/api/article`, audit item 10); `ede32dd` extends
the same atomic-`$inc`-based mechanism (`src/lib/http/rateLimit.ts`) to all 16 Sheets
mutation routes at 30 req/min each. `44760e9` (detailed under DS History
above) is the largest standalone performance fix in the project.

---

# Continuation — `c546f1d` → `c0d5965` (2026-07-30 → 2026-08-16)

Everything above was written as of `c546f1d` and synchronized by `3c83ed5`.
The 66 commits since are recorded below, in the same commit-cited style.
Current-state reference documentation for these features lives in
[`ARCHITECTURE.md`](./ARCHITECTURE.md) and [`docs/`](./docs) — this section
remains the chronology ("what changed and why"), not the reference.

### Documentation split across two AI tools

`3c83ed5` synchronized every doc through `c546f1d`. `97462ac` trimmed
`CLAUDE.md` to Claude Code's official memory-file conventions, and `b8fef8d`
established `CLAUDE.md`/`AGENTS.md`/`GEMINI.md` as a shared source of truth:
`AGENTS.md` holds the small set of rules that apply regardless of which
assistant is driving, with the two entry points linking to it rather than
restating it, and Gemini/Antigravity constrained to read-only audit work.
`1436aff` closed a long-standing naming confusion with a `DELIBERATE`
comment in two places — the "Suivi RL" page reads the **BDD** tab; no "RL"
tab exists, and "RL" is a business label for a view over BDD's RL-related
columns.

### Fleet Data Import trigger

`e6e44a4` adds a button on the home page (`src/components/fleet/ImportTrigger.tsx`)
that proxies a **separate** Vercel project (`~/import`, deployed at
`import-red.vercel.app`) which runs the DS/CP/PARC/BC Drive→Mongo ETL — this
repo gains no Drive or ETL code of its own, only two thin proxy routes
(`/api/trigger-import`, `/api/import-status`). The trigger blocks 60–90s
until all four pipelines finish, then backfills real per-step
timestamps/detail via a follow-up `/api/status` call per run, because the
trigger response itself only carries a compact `"step:status"` string per
step. `9fe833d` fixed a status-matching bug found immediately after:
`~/import`'s real run statuses are `skipped_unchanged` and `skipped_absent`
— **never a bare `"skipped"`** — confirmed by reading that project's
`run.py` directly rather than inferring from its HTTP surface. *(The same
bug still exists in `/api/import-status`, which was not covered by that fix
— see `ARCHITECTURE.md`'s open-defects table.)*

### BDD gains Emplacement and automated zone-detection columns

`3d9bd87` surfaces four new live BDD columns. These are **two independent
signals, not one derived from the other**: `Emplacement` is a *manual*
dropdown (a human's assessment of where the vehicle actually is, hence in
`BDD_EDITABLE_FIELDS`, taking the allowlist from 6 fields to 7), while
`ATELIER`/`DEPOT`/`PARKING` are read-only sheet-side XLOOKUP presence flags
— the sheet-side equivalent of what `useVehicleZone()` computes client-side.
The two can legitimately disagree (stale manual entry, or a failed automated
match), and that disagreement is itself useful information rather than a bug
to reconcile away. `f016018` gives DS History's `BddEditableRow` a full-row
`INTROUVABLE` highlight to match.

### Suivi RL PDF export

`f2a8a93` adds a server-side PDF export of the currently filtered view
(`/api/bdd/export`, `pdf-lib` — this app's established PDF pattern, reused
rather than adding a second library). Four rapid corrections followed.
`77f9eef` is the most instructive: real vehicle models (Peugeot 208/508/
2008/3008) are literal digit strings, and the sheet sometimes stores them as
a raw *number*, so `r.modele` can genuinely be a `number` despite `BddRow`
typing it `string` — which made the route's strict `isValidRow()` reject the
**whole batch**, not just that row. Found only by clicking the real button
in a real browser, not by calling the API directly with well-formed data.
`a3ea97a` simplified the layout to 4 columns, portrait, with wrapped
comments; `8012835` made IMM dominant (20pt bold) and enlarged row padding
so a typical 22-row export fills the page instead of sitting in a dense
block above whitespace.

### Config-driven dropdown options (Stage 1)

`4876ddf` and `c442df2` first deduped `CATEGORIE_OPTIONS`/`TECHNICIEN_OPTIONS`
onto `src/types/index.ts`, closing a live two-copy drift. `76d60b5` then moved
dropdown option *values* out of hardcoded arrays entirely and into a Mongo
`sheetFieldOptions` collection, admin-editable at `/admin/config` without a
deploy. Headers, `BddRow`'s shape, and `BDD_EDITABLE_FIELDS` were
deliberately left out of scope for this stage. The seven `*_FALLBACK`
constants left behind in `src/types/index.ts` are **not dead code**: they serve
server-side degradation, client-side degradation, and the one-time seed
script. `1e47ff8` and `a1c88a4` added Atelier's Technicien chip row and its
"Non assigné" blank-value chip — the direct precedent for Suivi RL's
"Non renseigné" chips a month later.

### Test suite, CI, and the security/quality audit

`dcc5bc1` added the first real, persisted test suite (Vitest unit/integration
+ Playwright E2E), and `bde8cd9` wired type-check/lint/unit tests into GitHub
Actions. A full audit then produced a numbered remediation pass, each commit
citing its item: `525c16e` (C1) added the missing `verifyRowIdentity()` guard
to BDD's `updateSheetRow`; `5cf0eed` (C2) blocked `/admin/config` editing
until real data loads and added a `degraded` flag plus optimistic
concurrency via Mongo's own E11000 duplicate-key signal; `5012a0a` (I1)
stripped C1 control characters (U+0080–U+009F) before PDF text, which had
been crashing the whole export with an opaque 500 on a Windows-1252-mangled
paste; `0d82965` (I3) cleared the persisted BDD dataset from localStorage on
logout; `48f3fec` (I4) derived the admin UI's plain/colored key split instead
of hand-copying it. Then `6235a94` (M1) deduped `columnIndexToLetter`;
`21517d5` (M2) derived RDV's `EXPORT_COLUMNS` from `RDV_HEADERS`; `3cc2686`
(M3/M4) replaced Emplacement/ETAT magic strings with named constants and
reconciled the two drifted ETAT badge-colour implementations — DS History's
covered `ANNULEE` but not `ANNULE`, while Suivi RL's two-branch ternary
didn't distinguish `DISPONIBLE`/`ANNULE`/`ANNULEE` at all; `cacf201` (M5/M6)
capped PDF export field lengths after confirming live that 2000 rows × 20KB
commentaire cost 106s of CPU and produced an 18.7MB PDF; `db9fa96` (M7)
documented the import token's query-param tradeoff as accepted rather than
silently leaving it; `74a7f92` (M8) rate-limited the two unauthenticated
OAuth routes; `b75e390` (M10) documented why the seed script *cannot* call
`invalidateCache()` (Next's `revalidateTag()` throws outside a request
context). `809938b` and `794a702` closed the test-suite gaps the audit
found. `6a82a3e` made rate limiting **fail open** on Mongo unavailability
rather than crashing the request.

### Mongo field-name migration and CI enforcement

`e2e3a4f` migrated `ds`/`parc`/`bc`/`cp` field reads to post-backfill clean
key names, with `fa9f3ec` catching `/api/cp` which the original pass missed.
`985e3d8` added a dual-read window for `designation_consommation` during the
backfill and, more durably, added **`field_registry.json` CI enforcement** —
a copy of a live-scan snapshot of every real field name, with
`scripts/verify-field-names.cjs` failing the build if any `src/app/api/**` Mongo
field reference doesn't byte-match it. `6a4ecf0` resynced that snapshot after
the upstream `~/import` whitespace-mapping fix. `8264de0` marked
`scripts/add-indexes.ts` deprecated, pointing at `~/import`'s
`ensure_indexes` as the single source of truth. `d4d33be` fixed Articles
hiding a legitimate `qte: 0` behind the `"—"` fallback, and `bccc399`
dropped an unnecessary `$toDate` wrapper on `Date BC`.

### Plate search consolidation

`cdbfcd7` found `getIMMList()` querying the **wrong Mongo field**, so it had
been returning `[]` unconditionally; `143041a` then gave it a 1-week cache
TTL invalidated on a real `parc` import. `6f24bdf` moved DS History to
plate-only suggestions with strict prefix matching and browser caching;
`1997ec7` sorted the suggestion list to match `getIMMList()` and opened the
dropdown on any input; `26e53fb` consolidated everything onto a **single
shared full-list client-side search across `parc` + `cp`**, persisted to
localStorage so only the first page visited in a browser session fetches it.
`4742410` stopped DS History auto-loading a hardcoded development plate
(`48070-B-7`) on mount. `cbcf1d0`, `6aee573`, and `803454a` reworked DS
History's zone display — separate green chips rather than concatenated
`"A + B"` text, moved into the card header, with the card tinted by zone
priority. `a352032` kept the Combobox input focused after selecting a
suggestion.

### Cross-cutting UX pass

`5b50f48` gave BDD a manual add-plate dialog matching
Parking/Atelier/Depot's pattern. `c00184b` added a toast confirmation to
**every** write in the app plus `aria-label`s on icon-only buttons — hooked
once via TanStack Query's `MutationCache`, so no call site changed; a
mutation opts into specific wording with `meta.successMessage`. `9140e07`
unified loading state behind one shared skeleton. `93da3c0` made every list
page's *Actualiser* button a **genuine** hard refresh: it POSTs the tab's
`/refresh` route to bust the server-side cache *before* refetching, since a
client-only refetch had been re-reading the same stale server cache.
`ed0c3a7` fixed card position jumping during field edits on
Atelier/Parking/Depot — those lists are server-sorted by `TIMESTAMP` and an
edit bumps it, relocating the row the user is actively working on; the new
`useStableRowOrder` hook pins *position* to the last-known order while row
*data* stays exactly what the query returned.

### Gemini as a parallel LLM provider

`cb13749` added `/api/generate-email` — a second, parallel LLM provider
alongside the app, not a replacement for anything. `6629251` hardened it to
the same cost/security/reliability rules as the rest of the app: a 20s
timeout, output-token and prompt-length caps, upstream errors logged
server-side but never returned to the client, and upstream statuses mapped
(429→429, 5xx→502, timeout→504). The model choice is deliberate and
documented in the route header: `gemini-flash-lite-latest`, a **rolling
alias** verified live rather than assumed, chosen over a dated snapshot
because `gemini-2.5-flash-lite` had already been retired once for this key
(404). The accepted risk — a rolling alias can silently swap the underlying
model — is recorded there with an explicit boundary: do not reuse this
choice for anything output-sensitive without flagging the tradeoff again.

### Suivi RL: multi-select filters, Excel export, AI reformulation

`12bdc5e` converted all four filter axes to multi-select (OR within an axis,
still AND across axes, with the downstream-reset cascade preserved) and
added an Excel export (`/api/bdd/export-excel`, `exceljs` — the app's first
xlsx output; confirmed no existing utility to reuse) alongside the PDF.
Emplacement became a real column in the Excel export on the reasoning that a
multi-select filter means one export can span several Emplacement values, so
per-row Emplacement stopped being redundant with the header summary.
`e3bc354` then applied the same reasoning to the PDF export — which required
solving a **width/truncation bug**: giving Emplacement the same weight as
`modele` truncated both the column header itself and the live
`INTROUVABLE` value, found by decoding a real export's PDF content stream
rather than by inspection, and fixed by measuring the actual strings with
`widthOfTextAtSize` and assigning weight `1.3`.

`24eec71` added AI comment reformulation via Gemini
(`/api/bdd/reformulate-comment`), and `b8d762a` made it context-aware —
passing Modèle/ETAT/Prestataire/Flag/Catégorie/Technicien so the model can
tell what a terse technician note refers to, while the system instruction
forbids restating the context, inventing details, or changing meaning. The
load-bearing property, stated in three places in the code, is that the route
**never writes to the Sheet**: the user reviews an editable suggestion in a
dialog and, on confirm, saves through the same `commitField("commentaire")`
path as any manual edit. That mandatory human review is what makes the
rolling-model-alias risk acceptable.

`c0d5965` closed the loop on the filter work with "Non renseigné" chips on
all four axes — rendered only when the axis's own in-scope dataset actually
contains a blank value for that field — and switched Flotte/Emplacement from
admin-config option lists to the same data-derived, cascade-narrowing
pattern Prestataire/Flag already used. The bug that fixed: a config-only
value with zero live rows (confirmed: `ANNULE`/`ANNULEE`) rendered as a
clickable, permanently-empty chip. The admin-config lists remain in use by
the per-row editors, which must be able to set a value no other row
currently has.

# Continuation — `ef630e0` → `32631bb` (2026-08-16 → 2026-08-20)

The 24 commits after `c0d5965`, in the same commit-cited style. The period is
dominated by two things that are not features: a repo-wide move to a `src/`
layout, and a documentation/cleanup pass that turned several implicit
invariants into executable ones. One feature was built, ported to a different
LLM provider, and then removed entirely — recorded below because the reverts
kept two deliberate exceptions.

### Import-status run vocabulary, and a sweep of stale comments

`ef630e0` fixed `/api/import-status` validating a pipeline **run**'s status
against `KNOWN_STEP_STATUSES`, the per-**step** set. The vocabularies differ,
so `skipped_absent` and `skipped_unchanged` matched neither and both coerced
to `failed`: a legitimately skipped past run was reported as a failed one.
This is the same bug `9fe833d` had already fixed in `/api/trigger-import`,
never applied to this second route — it survived because the tests only ever
exercised `status: "success"`. The fix adds `KNOWN_RUN_STATUSES` and
`normalizeRunStatus()` (live at `src/app/api/import-status/route.ts:41-53`)
with a parameterised regression test over all five real run statuses, verified
to fail on three cases against the previous implementation before being
applied. A bare `"skipped"` is still deliberately rejected: it is never a real
run status. The two sets stay separate on purpose — collapsing them recreates
the bug.

`443626c` then corrected six comments that a later commit had falsified
without revisiting the prose around them, with no behaviour change: two in
the BDD PDF export (an exclusion justified by "none of those axes support
selecting multiple values", expired when `c0d5965` made all four multi-select
— the columns stay excluded, but for the portrait-A4 width constraint; and a
stale column count), one in the Excel export, one in `suivi-rl/page.tsx`
pointing at the PDF export as omitting a field it includes, one in the types
module, and `CLAUDE.md` §6's field/search/chip counts.

### ARCHITECTURE.md and the `docs/` reference set

`b2fcb80` addressed the same class of gap this section does: `PROJECT_HISTORY.md`
had been frozen at `c546f1d` while 66 commits landed. It added the Continuation
section above **and** a current-state reference alongside this chronology —
[`ARCHITECTURE.md`](./ARCHITECTURE.md) plus eleven [`docs/`](./docs) pages.
The two tables carrying most of the value are ARCHITECTURE.md's "decisions that
look like bugs but are not" (13 entries) and its running defect list. Each page
records what the code does, why, what it is explicitly *not* meant to do, and
the limitations found while testing — derived from current code and `git log`
rather than from commit-message paraphrase, with every file:line reference and
all 188 relative links machine-verified.

The division of labour it established still holds: **this file is the
chronology ("when and why did X change"), `ARCHITECTURE.md` and `docs/` are
the reference ("how does X work today")**.

### Phase 2 cleanup: proposal, application, resync

`89b8fad` produced [`docs/cleanup-candidates.md`](./docs/cleanup-candidates.md)
as a proposal only, each candidate carrying a confidence level and the scan
that produced it. The scans: 269 exported symbols by reference count (3
unused), 46 API routes by URL search with tests counted separately (3 with no
non-test caller), 33 dependencies against imports across 168 tracked files
(0 unused), plus history-wide checks for temp files, TODO/FIXME markers and
commented-out code (0 each).

Its most useful finding is an argument *against* the obvious fix. Deduplicating
the `~/import` contract would **not** have prevented `ef630e0`'s bug — both
routes would have imported the same wrong Set. The root cause is that
`ImportPipelineStepStatus` and `ImportPipelineRunStatus` are hand-written
unions with no runtime counterpart, so a validator had nothing to import and
hand-wrote a Set, and only the step-level one was ever named. The proposed fix
applies this repo's existing `as const` → `(typeof X)[number]` idiom (already
used by `PALETTE_COLORS`, `OPTION_KEYS`, `ATELIER_EDITABLE_FIELDS`,
`RDV_EDITABLE_FIELDS`) so set-vs-type drift becomes unrepresentable. It also
explains mechanically how `9fe833d`'s fix missed the second route:
`normalizeTimestamp()` is md5-identical across both, but is a named function
in one and inlined into a `.map()` in the other, so name-based search finds one
copy and looks correct.

`9c21627` applied only the four items marked safe. It removed `ETAT_ANNULE`/
`ETAT_ANNULEE` (zero references repo-wide, including the `etatBadgeClass()`
just below them, which branches only on DISPONIBLE/INTERNE/EXTERNE) while
preserving the fact they carried in two places rather than one:
`etatBadgeClass()`'s docstring now states that ANNULE/ANNULEE are real
fallback values deliberately falling through to the single muted return, and
points at the test that already pinned
`etatBadgeClass("ANNULE") === etatBadgeClass("ANNULEE")` — the behaviour was
executable-specified before the constants went, not merely commented.

The commit also corrected its own first draft on a point worth keeping:
`TESTING.md` was missing **seven** test files, not the two originally
reported, because that count came from spot-checking rather than diffing the
list. Three of the seven cover the security model (the auth boundary,
`AUTHORIZED_EMAIL` enforcement, the BDD editable-field allowlist) — and
`TESTING.md`'s "Deliberately NOT covered" section is precisely what a reader
consults to decide whether a risk is untested. It read as untested when it was
not.

`95665a0` marked the applied items done and recomputed every line reference
shifted by those edits from the real symbols rather than by assuming an offset
(194 links re-verified, 0 broken).

### Gemini cost tracking

`221b1a9` added a central wrapper as the single door to every Gemini call,
returning a cost breakdown inline with the model output so the UI can show a
per-action cost in the same round trip. Its design decisions: a `PRICING`
table plus an alias map (both routes send the rolling
`gemini-flash-lite-latest` alias, which has no price of its own); free/paid
tier inferred from a per-model, per-day counter that resets at midnight
**Pacific**, not UTC, per Google's rate-limit docs; and state in MongoDB via
atomic `$inc`, mirroring the rate limiter, because on Vercel a JSON/log file
would be both ephemeral and unsafe under concurrency. Both call sites were
refactored to go through it; neither fetches the API directly any more.

`e9a270c` closed the loop on the rolling-alias risk this whole design hangs
on. `GenerateContentResponse` exposes a top-level `modelVersion` — the only
signal that Google has repointed a `-latest` alias at a differently-priced
model — so it is captured as `costInfo.servedModel` alongside `pricedAs`, both
logged on every usage line, with an explicit error when they disagree.
Crucially, **pricing still follows the assumed key rather than silently
adopting the served model's price**, so a mismatch stays visible instead of
being absorbed. `efc62b7` recorded the first live confirmation (a production
call returning `gemini-3.5-flash-lite`, drift false), and the mechanism later
paid for itself — see the complaint-handler entry below.

Two supporting fixes: `ecce243` moved the new indexes out of
`scripts/add-indexes.ts`, which is marked DEPRECATED because its field-name
literals predate the 2026-08 Mongo key migration — adding to it made the new
setup step unrunnable in practice — into a script touching only the three
collections this repo owns. `0d61639` stripped quotes when reading
`MONGODB_URI` from `.env.local`, which `vercel env pull` writes quoted and the
driver rejects as an invalid scheme.

### The `src/` restructure

Seven commits moved the repo to a `src/` layout, each verified independently
rather than as one big-bang move. `4182994` (phase A0) moved `app/`,
`components/`, `hooks/`, `lib/` and `proxy.ts` under `src/` and repointed the
`@/` alias — **no import statements changed**, because every internal import
already went through `@/`; the repo's only relative cross-directory import was
in one script. `23d40bf` moved the shell script into `scripts/backup/`,
repointed `verify-field-names.cjs`'s scan roots, and excluded `scripts/` from
type-checking. No `public/` was created, because nothing static exists to put
in it (favicon uses App Router colocation, fonts load via `@import`, PDFs are
generated at runtime).

`a7daae9` (phase B) centralised pure, dependency-free helpers into
`src/lib/utils/` and moved `cn()` there from `components/ui/` — it is a plain
function, not a component, and `lib/utils` is also where shadcn expects it.
`46775cd` (phase C) grouped `lib/` **by what each module talks to**, which is
the layout still in place today: `lib/sheets/`, `lib/mongo/`, `lib/gemini/`,
`lib/auth/`, `lib/http/`, and `types/`. The three highest-fan-in modules moved
last within the phase by design — `rateLimit` (37 importers), `apiError` (41),
`types` (46).

`9532464` and `b05689d` then synced path references in the docs and in 189
lines of `src/` comments, the latter a strict 1:1 swap (189 insertions / 189
deletions) with two string literals deliberately included, since both name a
file the reader is being sent to. `b05689d` explicitly left ARCHITECTURE.md's
now-misaligned ASCII diagrams alone on the grounds that realigning them is
hand-editing rather than find/replace; `c653a5b` did that by hand afterwards,
whitespace and border characters only.

### Complaint handler: built, ported, removed

`5115c95` added a Phase 1 complaint-handling playbook generator — upload a
`.txt` of real client complaint threads, get back structured findings — built
on Anthropic's SDK in a new `src/lib/anthropic/` mirroring `src/lib/gemini/`.
Its grounding rules were the load-bearing part: work only from the uploaded
text, invent no policies, mark single-thread categories low confidence, and
record what the threads do **not** establish in a required `notEvidenced`
array, on the reasoning that a model with nowhere to put uncertainty invents
certainty instead. Raw complaint text was never persisted.

`ed8172d` ported it to Gemini, because there is no Anthropic account for this
project. A real port rather than a config swap: Gemini's `responseSchema` is an
OpenAPI 3.0 subset that steers rather than grammar-guarantees the output shape,
a genuine downgrade from Anthropic's strict `json_schema` mode, so a
hand-written shape validator had to gate everything reaching Mongo or the UI.
It also produced a finding that outlived the feature — `detectAliasDrift()`
caught `gemini-flash-latest` serving `gemini-3.7-flash` while `MODEL_ALIASES`
still said 3.5-flash, mispricing those calls at 1.5/9.0 instead of 0.75/3.75.

`c831826` removed the feature entirely as a detour from this repo's focus. The
revert is worth reading for **what it deliberately kept**: the alias repoint
and its pricing entry, which were correct independently of the feature and
were also affecting `/api/generate-email`; and `CostInfo`, which predates it.
It also reverted the two optional structured-output params added to the Gemini
wrapper for this feature, on the grounds that leaving them would strand a
param pair documented entirely in terms of something that no longer exists.
`src/types/index.ts`, `.env.example` and `package.json` were returned
byte-identical to their pre-feature state. Verified today: the only
"complaint" left in `src/` is the English word in
`src/app/api/generate-email/route.ts:1` describing what kind of emails it
drafts.

### Region, runtime, and environment validation

`db61526` pinned functions to `cdg1` (Paris) to match the MongoDB Atlas
cluster — the SRV record resolves to three MongoDB, Inc. addresses geolocated
in Paris, while the Vercel project carried no region and so ran on the default
`iad1` (Washington). **Every Mongo roundtrip was crossing the Atlantic.** It
also declared `export const runtime = "nodejs"` on all 46 API routes (verified
today: 46 of 46), a no-op since Node is the default, but an explicit statement
of a real requirement — an import-graph walk shows all 46 reach `src/lib/mongo/`
transitively, almost all via the rate limiter.

The same commit added boot-time environment validation via
`src/instrumentation.ts` against a Zod schema in `src/config/env.ts`, so a
misconfigured deploy fails with every missing variable listed at once instead
of surfacing as a per-route 500. Required vs optional follows **real behaviour,
not `.env.example` membership**: `IMPORT_PIPELINE_TOKEN`, `GEMINI_API_KEY`,
`USD_TO_MAD_RATE` and `GEMINI_PREPAID_USD_BALANCE` stay optional because each
has a documented, test-asserted graceful fallback that a hard boot failure
would break.

It also evaluated and deliberately rejected `force-dynamic`, for the same
reason the Cache Components evaluation later reached the same conclusion: all
pages are `"use client"` and read data client-side via React Query, and
`src/app/layout.tsx`'s `await headers()` CSP-nonce call already forces the
whole tree dynamic — a real build reports zero static routes.

`eb9dd31` closed the remaining hole: `register()` covers server boot but does
**not** run during `next build`'s "Collecting page data" phase, where the first
module-level throw wins instead, naming one variable at a time and forcing a
fix-one-rerun-repeat loop. `scripts/check-env.mjs` runs the same schema before
`next build` is invoked, failing in about a second with every problem listed
instead of after a 25s compile with one. It is chained explicitly into `build`
rather than relying on the implicit `prebuild` hook, because pnpm's
`enable-pre-post-scripts` default has moved across releases and a guard that
silently stops running is worse than no guard.

### Next.js 16.3.1 security upgrade; TypeScript 7 deferred

`32631bb` moved `next` 16.1.6 → 16.3.1, `eslint-config-next` in lockstep, and
`react`/`react-dom` 19.2.3 → 19.2.8 (the May 2026 advisories set a
`react-server-dom-*` floor of 19.2.6, so React had to move too). The driver
was the Next.js coordinated security release of May 2026 — 13 advisories,
16.x patched at 16.2.5/16.2.6 — of which five are middleware/proxy
authorization bypasses.

Those five applied to this app **directly, not theoretically**: `src/proxy.ts`
is the entire auth boundary, with all 46 API routes and every page carrying
no session check of their own (verified by grepping `getIronSession|isLoggedIn`
across `src/app`, which matches only the OAuth callback and
`src/app/login/actions.ts`). Every advisory's stated mitigation — "enforce
authorization in route or page logic instead of relying solely on middleware"
— describes a fallback layer this app does not have. Two of the five are
inapplicable on their own terms: CVE-2026-44574 needs a dynamic route segment
(this app has none) and CVE-2026-44573 needs the Pages Router with i18n
(App Router, no `i18n` config).

One mitigating detail worth preserving, since it bounds what the exposure
actually was: every protected page is `"use client"` and all fleet data
arrives via `/api/*` route handlers, which have no `.rsc` transport variant.
The segment-prefetch bypass (CVE-2026-44575) would therefore have yielded an
empty client-component shell, not Sheets or Mongo data. Patch-worthy, not a
breach. Post-upgrade the bypass shapes were probed live against a dev server
and all return 307 → `/login`: `/parking.rsc`, an `RSC: 1` header, an
`RSC` + `Next-Router-Prefetch` + `Next-Router-Segment-Prefetch: /_tree`
combination, and an injected `x-nextjs-data` header (which now yields a
proper `location:` header rather than the internal `x-nextjs-redirect`).

**TypeScript 7.0.2 was attempted in the same session and deliberately not
landed** — see the tradeoffs section below for the standing blocker.

Also of note: `next dev` on 16.3 writes a `<!-- BEGIN:nextjs-agent-rules -->`
block into [`AGENTS.md`](./AGENTS.md) and re-adds it on every run (see
`node_modules/next/dist/server/lib/generate-agent-files.js`). It is committed
rather than stripped, because stripping it only recreates the uncommitted
change on the next `pnpm dev`.

---

### Vehicle identity: one merged view of `parc` + `cp`

`a6ad585` and `25950ea`. Reported as "VehicleCard not rendering in production",
which it was not: `VehicleCard` had always required a `parc` record, and
`git blame` dates the conditional to `adc6469` (2026-03-20). The plate that
prompted the report — `11734-T-1` — simply had no `parc` row.

Measuring the real scope is what turned a non-bug into work worth doing. Of the
11,169 distinct plates in `ds`, **5,201 (46.6%) have no `parc` record**, so the
card silently rendered nothing for nearly half the fleet. **3,202 of them do
have a `cp` record** — the page was already fetching full identity data
(marque, modèle, VIN, gestionnaire, contract dates) and discarding it.

`src/lib/vehicle/identity.ts`'s `mergeVehicleIdentity()` now produces one
`VehicleIdentity` for the card, the PDF/DOCX exports and the AI payload. `parc`
wins field by field where both have a value, `cp` fills gaps, so every
parc-backed plate renders exactly as before; the card hides only when neither
source has anything (1,999 plates).

Three fields — `client`, `vehicle_state`, `tenant` — exist only in `parc`
(verified absent from all 10,230 `cp` documents) and render **`non disponible`**
rather than `—`. That distinction is the point: `—` means "blank in a record
that exists", and collapsing the two would make a missing *source* look like an
empty *record*, which is roughly the confusion that generated the bug report.
One `PARC_ONLY_FIELDS` definition backs both the card's label lookup and the
exports' key lookup, with a test pinning the projections together.

`25950ea` carried the identity downstream. The exports had hardcoded the
heading `Véhicule — Données fixes (parc)` even when rendering `cp` data, and
the AI payload had been sending `{brand: undefined, model: undefined}` for all
3,202 cp-only plates — no vehicle context at all on a fleet where marque and
modèle are known 100% of the time. `vehicle_state` stays undefined rather than
invented, so the prompt omits its `État:` line.

Two things worth carrying forward. The raw `cp` documents spell their fields
`num_chassis` / `modele` / `libelle_version_long` / `date_mce` and `/api/cp`
maps them to the `CpItem` names; measuring the `CpItem` names against Mongo
reports 0% coverage and is wrong — the first pass of this investigation did
exactly that. And production browser verification is possible: the Playwright
auth helper pointed at the production alias, with `secure: true` on the cookie,
is accepted because `.env.local` carries the Production-scope
`IRON_SESSION_SECRET`. Both plates were confirmed against the live deployment,
including reading the downloaded PDFs.

Full detail: [`docs/ds-history.md`](./docs/ds-history.md) §1.5.

## 3. Architectural tradeoffs & known limitations

- **Single-user hardcoded authorization.** `src/lib/auth/googleOAuth.ts`'s
  `AUTHORIZED_EMAIL` constant (introduced in `19926c6`) is the entire
  authorization check — adding a second legitimate user requires a code
  change and redeploy, not a config or database change. Confirmed as an
  explicit non-goal with the user at the time (`19926c6`'s commit message).
- **CSRF defense on mutation endpoints relies on `SameSite=Lax` cookies**,
  not an explicit per-route CSRF token. `src/lib/auth/session.ts`'s
  `sameSite: "lax"` setting means the session cookie isn't sent on
  cross-site POST/fetch/XHR requests, which is the actual (implicit)
  protection for the 16 Sheets mutation routes hardened in `ede32dd`. If
  the cookie policy or cross-site embedding requirements ever change, this
  protection has no fallback layer behind it.
- **Absolute dependency on Google OAuth availability.** Since `003cb74`
  removed the username/password login path entirely, there is no fallback
  authentication method — if Google's OAuth service has an outage, this
  app cannot be logged into at all.
- **TypeScript 7 is blocked by `typescript-eslint`, not by this codebase.**
  Attempted 2026-08-20 alongside `32631bb` and reverted the same session.
  TypeScript 7.0.2 itself is clean here: `tsc --noEmit` passes with **zero**
  new errors and no `tsconfig.json` changes, and type-check time drops from
  13.27 s to 2.53 s (5.2×). The blocker is that `@typescript-eslint` reads
  TypeScript compiler internals the native port restructured, so ESLint
  crashes on startup — `TypeError: Cannot read properties of undefined
  (reading 'Cjs')` at `@typescript-eslint/typescript-estree`'s
  `create-program/shared.js` — exiting 2 without linting a single file. No
  compatible release exists on any tag. Since
  [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) gates `pnpm lint`
  on every push to `main`, landing TS 7 would red the build. The rejected
  workarounds — running TS 5.9 for ESLint and TS 7 for `tsc`, or dropping
  lint from CI — were both judged worse than waiting for upstream.

  **Last rechecked 2026-08-20** (same day as the first attempt, so the lack
  of movement is expected rather than informative — leave a real gap before
  the next one). Still blocked, nothing changed:

  | Checked | Version | `typescript` peer range |
  |---|---|---|
  | `typescript-eslint@latest` | 8.67.0 | `>=4.8.4 <6.1.0` |
  | `typescript-eslint@canary` | 8.67.1-alpha.24 | `>=4.8.4 <6.1.0` |
  | `@typescript-eslint/parser@latest` | 8.67.0 | `>=4.8.4 <6.1.0` |
  | `eslint-config-next@latest` | 16.3.1 (= installed) | — |
  | `typescript@latest` | 7.0.2 (unchanged) | — |

  **There are two gates, not one.** Even once `typescript-eslint` ships TS 7
  support — presumably as a v9 — `eslint-config-next@16.3.1` declares
  `"typescript-eslint": "^8.46.0"`, a caret range locked to 8.x, so it could
  not resolve a v9 without its own release. So the retry signal is *both* a
  TS-7-compatible `typescript-eslint` **and** an `eslint-config-next` that
  depends on it. Checking only the former will look unblocked when it is not.
- **Unindexed case-insensitive regex on non-prefix queries.**
  `src/app/api/article/route.ts` still builds `$regex` filters with
  `$options: "i"` against `Description article`/`Marque`/`Modele` (input is
  escaped via `escapeRegex()`, added in `a2b226e`, so this is not an
  injection risk) — but unlike parc's plate-prefix search (fixed in
  `ede32dd` by dropping the case-insensitive flag and uppercasing instead),
  these article-search queries are not anchored to a prefix and cannot use
  a standard B-tree index, so they still fall back to a collection scan on
  every search.

## 4. Documentation index

- **`ARCHITECTURE.md`** + **`docs/`** — the current-state reference: one page
  per feature/page area, each recording what the code does now, why it was
  built that way, what it is explicitly *not* meant to do, and the
  limitations found while testing it. Complements this file rather than
  replacing it — this file is the chronology, that one is the reference.
  Start there when answering "how does X work today"; start here when
  answering "when and why did X change".
- **`SECURITY_VERIFICATION.md`** (added `c0fd269`) — the authoritative,
  live-verified record of this app's actual security controls
  (authentication, session/cookie settings, CSRF, write-safety, input
  validation, rate limiting, secrets handling, and HTTP headers — the last
  checked with real `curl -I` output, not just read from config). Consult
  that file directly for security claims; this document only summarizes
  what was built and when.
- **`DESIGN_SYSTEM.md`** (added `6cb1f1b`) — the grep/count-verified
  inventory behind the "Design system, round 2" pass above (color,
  typography, radius, and error-banner drift, plus the token-based
  proposal that pass implemented). A persistent doc, unlike the deleted
  `AUDIT_REPORT.md` below.
- **`CLAUDE.md`** (consolidated `8620d86`) — merges the theming doc with
  condensed, source-linked summaries of this file's architecture/feature
  timeline and `SECURITY_VERIFICATION.md`'s security assessment, plus
  setup instructions and shared-component conventions. The canonical
  single entry point for a new session; this file remains the detailed,
  commit-cited source of truth it summarizes.
- **`AUDIT_REPORT.md`** — referenced throughout early commit messages
  (e.g. `f59cb47`'s "audit §8.1", `150918f`'s "audit 10") as the source of
  the original repo-wide audit's findings. It was a scratch/working
  document, never committed to this repository, and was deleted once its
  items were actioned (see the project's own memory record of commit
  `86594a7`). It has been superseded by this file and by
  `SECURITY_VERIFICATION.md` as the permanent records of that work.
