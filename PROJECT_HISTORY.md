# Project history

Permanent record of this project's development history, built directly from
`git log --oneline --all` (82 commits, `df5a4c3` → `c5d688f`) with diffs
inspected wherever a commit message needed clarification. Every claim below
cites the commit(s) it's based on — nothing here is inferred beyond what a
commit message or its diff actually states.

## 1. Architecture overview

**Purpose:** AVIS Maroc fleet management — tracks vehicles across parking,
workshop (Atelier), storage (Depot), and appointments/convoyage (RDV),
backed by a live Google Sheet as the system of record for editable
operational data, with MongoDB holding large read-mostly reference
collections (`ds`, `bc`, `parc`, `cp`) used for search/lookup and export.

**Stack:**
- Next.js App Router (React Server Components + API routes)
- MongoDB (native driver, `lib/mongo.ts`'s `getCollection()`)
- Google Sheets API via a service-account JWT client (`lib/googleSheetsClient.ts`
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
("jalal sheet", the first `app/api/sheet/route.ts` + home page Sheets
integration), followed by `a57ae1f` (iron-session auth added) and `13c4178`
(replacement warnings, dark-mode toggle, sheet colors). `adc6469` merges the
parc/cp/sheet cards, adds RL support, and fixes an import date-dedup bug.
After a credentials scare (`5804355` removed an exposed env file, `967b04d`
removed exposed credentials, `df39166` added a pre-push hook), `12698d3`
builds an early, uncommitted-until-later "suivi BDD" draft page (filters,
flag system, PDF export). A large July 19 audit-driven pass then
consolidates the app: `a91333f`/`563c95e`/`a2b226e` fix phantom export
fields, unify API response types (`lib/types.ts`, `lib/format.ts`), add
consistent error handling, `escapeRegex()` regex-injection protection, and
`.env.example`; `f59cb47` adds the 6 MongoDB indexes recommended by the
original audit (`ds`/`bc`/`parc`/`cp`, cutting DS History search from 339ms
to 45ms). `50b6c46` then formalizes navigation (new home screen, DS History
moved to `/ds-history`) and wires up the first real BDD Sheets integration
(`lib/googleSheetsBdd.ts`, `/api/bdd`, `/api/bdd/update`) reading/writing the
live "BDD" tab (gid `868042157`) through an editable-fields allowlist.

### BDD (Suivi RL)

Read/write integration lands in `50b6c46` (`lib/googleSheetsBdd.ts`,
`/api/bdd`, `/api/bdd/update`, a 6-field editable allowlist). `295e1a8`
migrates the page onto shared fleet components/TanStack Query. `8199db9`
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
duplicate "Technicien" label.

### Parking

Ported from Google Apps Script in `d218c23` (`lib/googleSheetsParking.ts` +
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
(`lib/googleSheetsRdv.ts`, `/api/rdv/*`, `useRdvRows()`) is deliberately kept
since `useVehicleZone.ts` still depends on it for the zone-badge check and
the API routes remain available for future direct RDV CRUD.

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
page migrated yet): `components/ui/` — hand-written shadcn-pattern
primitives (Button, Input, Dialog, AlertDialog, Combobox, Badge,
ToggleGroup, Sheet, Card) built on Radix UI + cmdk rather than scaffolded
via shadcn's CLI, re-skinned to the app's existing zinc palette from the
start, with touch targets enlarged to ≥40–44px after the audit found
existing icon buttons undersized at ~24–28px; `hooks/` — `AppQueryProvider`
(TanStack Query), `useParkingRows`/`useAtelierRows`/`useBddRows`,
`useDarkMode`, `usePlateAutocomplete`, `useEditableState`; and
`components/fleet/` — `ListPageHeader`, `PlateSearchInput`,
`PlateFilterInput`, `AddResultsList`, `RecordCard`, `Field`. Pages then
migrate one at a time: Parking (`3e03663`), Atelier (`de1473e`), Suivi RL
(`295e1a8`), with DS History's types/dark-mode toggle/`FieldSelector`
deduped in `14403c3` and the home page's dark-mode toggle deduped in
`51dda77`. `080e6fd` removes confirmed-dead `components/ui/` files and an
unused dependency once migration was complete. `8199db9` layers the
per-field inline-commit UX (described under BDD above) on top of this
foundation.

### Theming

A 6-stage audit/fix, fully documented in `baaea19`. Stage 1 (`7005334`)
installs `next-themes`, adds the synchronous no-flash inline script
distinguishing an explicit past choice from no choice yet (time-based
default: 7am–7pm light, computed by `lib/themeDefault.ts`'s
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
(Parking/Atelier/Depot/Suivi RL/Articles/Login).

### Authentication

The app ran on a shared username/password login (iron-session-backed, with
in-memory per-IP rate limiting added in `a2b226e`) until `003cb74` replaced
it with a Google sign-in button, and `19926c6` implements the actual OAuth
2.0 flow: a start route generating a CSRF `state` token in a short-lived
cookie and redirecting to Google's consent screen (`openid email` scope
only), and a callback route that validates the `state`, exchanges the code,
cryptographically verifies the ID token against Google's own public keys,
and checks the verified email against a single hardcoded constant
(`lib/googleOAuth.ts`'s `AUTHORIZED_EMAIL`) — no User model, no MongoDB
collection, no registration flow, confirmed with the user as an explicit
non-goal. No rate limiter was added to the callback route by deliberate
decision: authorization codes are single-use, short-lived, and issued by
Google only after real consent, unlike the password-based login it
replaced. `66940ba` gitignores the downloaded OAuth client secret and lets
the proxy pass the Google auth routes through unauthenticated. `proxy.ts`'s
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
use the existing indexes, `proxy.ts`'s anchored path matching, and the
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
the same atomic-`$inc`-based mechanism (`lib/rateLimit.ts`) to all 16 Sheets
mutation routes at 30 req/min each. `44760e9` (detailed under DS History
above) is the largest standalone performance fix in the project.

## 3. Architectural tradeoffs & known limitations

- **Single-user hardcoded authorization.** `lib/googleOAuth.ts`'s
  `AUTHORIZED_EMAIL` constant (introduced in `19926c6`) is the entire
  authorization check — adding a second legitimate user requires a code
  change and redeploy, not a config or database change. Confirmed as an
  explicit non-goal with the user at the time (`19926c6`'s commit message).
- **CSRF defense on mutation endpoints relies on `SameSite=Lax` cookies**,
  not an explicit per-route CSRF token. `lib/session.ts`'s
  `sameSite: "lax"` setting means the session cookie isn't sent on
  cross-site POST/fetch/XHR requests, which is the actual (implicit)
  protection for the 16 Sheets mutation routes hardened in `ede32dd`. If
  the cookie policy or cross-site embedding requirements ever change, this
  protection has no fallback layer behind it.
- **Absolute dependency on Google OAuth availability.** Since `003cb74`
  removed the username/password login path entirely, there is no fallback
  authentication method — if Google's OAuth service has an outage, this
  app cannot be logged into at all.
- **Unindexed case-insensitive regex on non-prefix queries.**
  `app/api/article/route.ts` still builds `$regex` filters with
  `$options: "i"` against `Description article`/`Marque`/`Modele` (input is
  escaped via `escapeRegex()`, added in `a2b226e`, so this is not an
  injection risk) — but unlike parc's plate-prefix search (fixed in
  `ede32dd` by dropping the case-insensitive flag and uppercasing instead),
  these article-search queries are not anchored to a prefix and cannot use
  a standard B-tree index, so they still fall back to a collection scan on
  every search.

## 4. Documentation index

- **`SECURITY_VERIFICATION.md`** — the authoritative, live-verified record
  of this app's actual security controls (authentication, session/cookie
  settings, CSRF, write-safety, input validation, rate limiting, secrets
  handling, and HTTP headers — the last checked with real `curl -I` output,
  not just read from config). Consult that file directly for security
  claims; this document only summarizes what was built and when.
- **`AUDIT_REPORT.md`** — referenced throughout early commit messages
  (e.g. `f59cb47`'s "audit §8.1", `150918f`'s "audit 10") as the source of
  the original repo-wide audit's findings. It was a scratch/working
  document, never committed to this repository, and was deleted once its
  items were actioned (see the project's own memory record of commit
  `86594a7`). It has been superseded by this file and by
  `SECURITY_VERIFICATION.md` as the permanent records of that work.
