# jalal — AVIS Maroc fleet management

Canonical reference for this project. For the full commit-by-commit
history and the full security verification detail this document
summarizes, see [`PROJECT_HISTORY.md`](./PROJECT_HISTORY.md) and
[`SECURITY_VERIFICATION.md`](./SECURITY_VERIFICATION.md) — both remain the
detailed source-of-truth documents; this file is the concise entry point.

## 1. Project overview

AVIS Maroc fleet management — tracks vehicles across parking, workshop
(Atelier), storage (Depot), and appointments/convoyage (RDV), backed by a
live Google Sheet as the system of record for editable operational data,
with MongoDB holding large read-mostly reference collections (`ds`, `bc`,
`parc`, `cp`) used for search/lookup and export.

**Stack:**
- Next.js App Router (React Server Components + API routes), Next 16, React 19
- MongoDB (native driver, `lib/mongo.ts`'s `getCollection()`)
- Google Sheets API via a service-account JWT client (`lib/googleSheetsClient.ts`
  and the per-tab modules — `googleSheetsBdd.ts`, `googleSheetsParking.ts`,
  `googleSheetsAtelier.ts`, `googleSheetsDepot.ts`, `googleSheetsRdv.ts`)
- iron-session for authentication state (sealed cookie, no server-side
  session store)
- TanStack Query (React Query) for client-side data fetching/caching
- Tailwind CSS v4 + hand-written shadcn-pattern primitives on Radix UI

**Deployment:** Vercel. `NODE_ENV` gates cookie `secure` and CSP
`unsafe-eval` behavior between local dev and production.

## 2. Getting started

Package manager is **pnpm** (`pnpm-lock.yaml` is the only lockfile in the
repo — don't use npm/yarn/bun, which would create a second, conflicting
lockfile).

```bash
pnpm install
pnpm dev      # start the dev server at http://localhost:3000
pnpm build    # production build
pnpm start    # run a production build
pnpm lint     # eslint
```

Copy `.env.example` to `.env.local` and fill in real values. The current
required variables (see `.env.example` for the up-to-date list and setup
notes):

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB connection string |
| `MONGODB_DB` | Database name (`avis`) |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth 2.0 web client — this app authorizes exactly one Google account, see §4 |
| `IRON_SESSION_SECRET` | Encrypts the session cookie, ≥32 chars |
| `GOOGLE_SERVICE_ACCOUNT_KEY_B64` | Base64-encoded service account JSON, grants Sheets/Drive access |
| `GOOGLE_SHEETS_ID` | The spreadsheet ID every `lib/googleSheets*.ts` module reads/writes |
| `GOOGLE_RDV_SHEETS_ID` | A **separate** spreadsheet ("Calendrier des rendez-vous quotidiens") holding the monthly appointment-calendar tabs — not the same file as `GOOGLE_SHEETS_ID`. See §5's RDV entry. Set in Vercel's **Production scope only** (not Preview) — a preview deployment touching RDV code will fail without adding a preview-scoped value via `vercel env add`. |
| `GOOGLE_DRIVE_FOLDER_ID` | Only needed for the optional `scripts/test-service-account.ts` diagnostic |
| `VERCEL_OIDC_TOKEN` | Populated automatically by `vercel env pull`/`vercel dev` — not set by hand |

`MONGODB_URI`, `IRON_SESSION_SECRET`, and the `GOOGLE_OAUTH_*` pair
currently only exist in this project's Production scope on Vercel — pull
them with `vercel env pull .env.local --environment=production` for a
working local setup, or add dev/preview-scoped values via `vercel env add`.

**Fonts:** this app does **not** use `next/font/google`'s Geist — see §3
below for the real font setup. If you're used to `create-next-app`'s
default README/layout, ignore that boilerplate; it doesn't reflect this
app's actual font loading.

## 3. Theming system

This app has a single, app-wide light/dark theme system. There is no per-page
theme logic anywhere — if you're adding a new page or component, it must use
the tokens below, not a literal Tailwind color like `zinc-900` or `bg-black`.

### How it works

- **Library**: [`next-themes`](https://github.com/pacocoursey/next-themes),
  wired into the root layout (`app/layout.tsx`) via `<ThemeProvider
  attribute="class" enableSystem={false} storageKey="theme">`. It toggles a
  `.dark` class on `<html>`; Tailwind's `dark:` variant is bound to that
  class via `@variant dark (&:where(.dark, .dark *))` in `app/globals.css`.
- **The toggle**: `components/fleet/ThemeToggle.tsx` is the *only* toggle
  component in the app. It renders in two shapes — `variant="pill"` (text +
  icon, used on Home/DS History/Articles/Login) and `variant="icon"` (bare
  icon button, wired into `ListPageHeader` so Parking/Atelier/Depot/Suivi RL
  get it automatically). Don't build another toggle — add `<ThemeToggle
  variant="icon" />` (or `"pill"`) wherever a page needs one.
- **Default for first-time visitors**: if no explicit choice has ever been
  made, the theme defaults to **light 7am–7pm, dark otherwise** (local
  client time), via `lib/themeDefault.ts`'s `getTimeBasedTheme()`. This is
  implemented as an inline script in `app/layout.tsx` that runs
  synchronously before hydration (same positioning next-themes' own
  no-flash script uses) — it re-evaluates the current hour on *every* visit
  until the user makes an explicit choice.
- **Explicit override**: clicking `ThemeToggle` sets
  `localStorage['theme-explicit'] = 'true'` in addition to calling
  `setTheme()`. The layout's inline script checks this flag first — if set,
  it honors whatever's in `localStorage['theme']` and skips the time-of-day
  computation entirely. This is what makes an explicit choice "stick"
  across visits instead of being silently overwritten by the time default.
  Clearing site storage (or the `theme-explicit` key specifically) reverts
  to time-based auto-detection.

If you need to change the light/dark cutoff hours, edit
`lib/themeDefault.ts`'s `LIGHT_START_HOUR`/`LIGHT_END_HOUR` — `app/layout.tsx`
imports these directly into the inline script, so there's one source of
truth, not a duplicated magic number.

### Color tokens

Defined in `app/globals.css`'s `@theme` block (mapping `--color-X` →
`--X`) plus `:root`/`.dark` blocks giving each token its light/dark value.
**Always use these instead of a literal `zinc-*`/`black`/`white` class:**

| Token | Utility classes | Light value | Dark value | Use for |
|---|---|---|---|---|
| `background` / `foreground` | `bg-background` / `text-foreground` | zinc-50 / zinc-900 | black / zinc-50 | Page root wrapper |
| `card` / `card-foreground` | `bg-card` / `text-card-foreground` | white / zinc-900 | zinc-900 / zinc-100 | Card-like surfaces (`components/ui/card.tsx`, `RecordCard`) |
| `muted` / `muted-foreground` | `bg-muted` / `text-muted-foreground` | zinc-100 / zinc-500 | zinc-800 / zinc-500 | Dimmed/secondary backgrounds and text (read-only fields, labels, disabled-ish chrome) |
| `border` | `border-border` | zinc-200 | zinc-800 | Every border |
| `input` | `bg-input` | white | zinc-900 | Text inputs, textareas |
| `popover` / `popover-foreground` | `bg-popover` / `text-popover-foreground` | white / zinc-900 | zinc-950 / zinc-100 | Floating surfaces (dropdowns, `Combobox`, `SelectSheet`, `AlertDialog`) |

**What deliberately still uses literal colors** (not a bug, don't "fix"
these into tokens): accent/brand colors per page or per zone-badge (sky,
amber, emerald, lime, violet, fuchsia, etc.), translucent colored washes
(`bg-emerald-500/10`, `bg-red-500/10`, `FLAG_STYLE` in `lib/types.ts`, ETAT
badges, `ZoneBadges`) — these are intentional data-driven distinctions that
already read fine in both themes since a translucent color blends with
whatever's behind it. Modal/dialog overlay scrims (`bg-black/70` in
`alert-dialog.tsx`/`dialog.tsx`/`select-sheet.tsx`) are the same kind of
deliberate exception — a dark scrim should look identical regardless of
theme. The one neutral exception left un-tokenized is
`focus:border-zinc-500` on inputs/comboboxes — a neutral mid-gray focus ring
that works acceptably in both themes without needing its own token.

### Font

**Inter** (body + h1–h4, weight 300 for body) + **JetBrains Mono**
(`font-mono` utility, data/identifiers only) — loaded via a Google Fonts
`@import` at the top of `app/globals.css`. Body/heading assignment is done
via plain CSS rules (`body { font-family: var(--font-body); }`,
`h1,h2,h3,h4 { font-family: var(--font-display); }`), both pointing at
Inter. `--font-sans` is also defined (also Inter) so the Tailwind
`font-sans` utility itself resolves correctly wherever it's used (e.g.
`ListPageHeader`'s title) instead of falling back to the generic
system-ui default.

This app previously ran a 3-font system (DM Sans + Playfair Display +
JetBrains Mono); Playfair Display was dropped since its entire footprint
was 5 heading tags app-wide — not enough to justify a second display
face, and a decorative serif was a mismatch for a data-dense fleet-ops
tool. Don't reintroduce it.

Do **not** reintroduce `next/font/google`'s Geist Sans/Mono in
`app/layout.tsx` — a previous version of this app loaded Geist there but
never actually applied it anywhere (globals.css's own font rules always
won), so it was a pure dead network fetch. It was removed; if you want to
change the app's font, edit the `--font-display`/`--font-body`/
`--font-sans`/`--font-mono` tokens and the `@import` URL in
`app/globals.css`, not layout.tsx.

## 4. Authentication & security

**Authentication is single-user Google OAuth**, not a username/password
system (that was removed and replaced with a Google sign-in button).
`app/api/auth/google/route.ts` starts the flow: a random CSRF `state` token
in a short-lived `httpOnly` cookie, redirect to Google's consent screen
(`openid email` scope only). `app/api/auth/google/callback/route.ts`
validates that `state`, exchanges the code, cryptographically verifies the
ID token against Google's own public keys, and checks the verified email
against a single hardcoded constant — `lib/googleOAuth.ts`'s
`AUTHORIZED_EMAIL`. There is no User model, no database-backed allowlist,
and no registration flow: this app has exactly one authorized account by
design.

**Every request is gated by `proxy.ts`** (Next middleware), which checks an
iron-session cookie (`session.isLoggedIn`, sealed via `lib/session.ts`:
`httpOnly`, `secure` in production, `sameSite: lax`, 7-day expiry, storing
nothing beyond that one boolean). Unauthenticated API requests get a 401
JSON response; unauthenticated page requests get a 307 redirect to
`/login`. Only `/login`, the `/api/auth/google*` OAuth routes, and static
assets (`/_next/*`, `/favicon.ico`) are excluded from this check, using
anchored exact/prefix matching rather than a loose `startsWith()` — this
closes a latent auth-bypass footgun where a future route named e.g.
`/login-x` could otherwise slip through unauthenticated.

**CSRF** on the OAuth flow itself uses the standard `state`-token pattern
(random, cookie-bound, single-use — the cookie is deleted immediately on
callback regardless of outcome). The app's own data-mutation routes have no
separate CSRF token system; they rely on the session cookie's
`sameSite: lax` setting, which isn't sent on cross-site POST/fetch/XHR
requests — a real, working protection, but an implicit one via cookie
policy rather than an explicit per-route check.

**Google Sheets write safety**: before any Parking/Atelier/Depot
update/delete, `lib/googleSheetsClient.ts`'s `verifyRowIdentity()` re-reads
the row's key cell and refuses the write (409) if it no longer matches what
the client expected — this guards against a client-held `rowIndex` going
stale after another delete renumbered the sheet. MongoDB in this app is
read-only reference data (`parc`, `ds`, `bc`, `cp`); there's no
concurrent-write path into it to protect, so no equivalent mechanism exists
there (not a gap — it isn't needed given the current design).

**Rate limiting**: `lib/rateLimit.ts` is a Mongo-backed, atomic (`$inc`)
fixed-window limiter. All 17 Sheets mutation routes (Parking/Atelier/Depot/
RDV/BDD add/update/delete/clear/action) allow 30 requests/minute per route;
`/api/article` and `/api/export` allow 20 requests/5 minutes.

**Input validation**: MongoDB queries built from user input use either
plain string equality (no operator-injection risk, since query params are
always strings) or a `$regex` filter run through `lib/regex.ts`'s
`escapeRegex()` first, closing both regex-injection and ReDoS.

**Secrets**: no API keys, client secrets, or connection strings are
committed anywhere in tracked files (verified via `git grep` and full
history search) — `.gitignore` excludes all `.env*` except `.env.example`.

**HTTP security headers** (`X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin`, HSTS, plus a per-request nonce'd CSP built
in `proxy.ts`) are confirmed live on every response path — public pages,
401 JSON, redirects, and authenticated pages alike.

### Known limitations (stated honestly, not gaps to silently "fix")

- **Single-user hardcoded authorization** — adding a second legitimate user
  requires a code change and redeploy, not config. This was an explicit
  design decision, not an oversight.
- **CSRF defense on mutation routes is implicit** (session cookie
  `sameSite: lax`), not an explicit per-route token — if cookie policy or
  cross-site embedding needs ever change, there's no fallback layer behind it.
- **No fallback if Google's OAuth service is down** — there is no
  username/password path left; this app cannot be logged into without
  Google OAuth being reachable.
- **Rate limiting trusts `x-forwarded-for`/`x-real-ip`** — reliable behind
  Vercel's own edge, but these headers would be spoofable if this app were
  ever exposed behind a different, untrusted proxy.
- **`app/api/article/route.ts`'s search regex is escaped but not
  index-friendly** — it uses a case-insensitive, non-prefix `$regex`
  against `Description article`/`Marque`/`Modele`, so (unlike `parc`'s
  plate-prefix search) it still falls back to a collection scan on every
  query. Not an injection risk, just a performance ceiling if that
  collection grows large.

See [`SECURITY_VERIFICATION.md`](./SECURITY_VERIFICATION.md) for the full,
file-and-line-cited verification behind every claim above, including what
was checked live against a running server.

## 5. Feature / data model reference

Each feature below is a page + API routes + a `lib/googleSheets*.ts` module
reading/writing one tab of the same live Google Sheet (except DS History
and Articles, which read MongoDB reference collections instead).

- **BDD / Suivi RL** (`app/suivi-rl/page.tsx`, `lib/googleSheetsBdd.ts`,
  `/api/bdd`, `/api/bdd/update`) — the live "BDD" Sheet tab, a 6-field
  editable allowlist, per-field inline commit UX (tap a field, it saves
  immediately with an inline confirmation — no card-wide save button).
  Search is plate/WW only; Prestataire/Flag/Flotte are toggle-chip filters
  layered on top, with plate search able to bypass the active chip
  selection so a real vehicle is always findable regardless of filters.
  Also surfaces read-only RDV/CONVOYEUR/Intervention columns (XLOOKUP
  formulas reading the RDV tab) and Parking/Atelier/RDV/Depot zone badges.
- **Parking** (`app/parking/page.tsx`, `lib/googleSheetsParking.ts`,
  `/api/parking/*`) — ported from the original Google Apps Script tool.
  Deleting a plate issues a real Sheets row deletion (shifting rows below
  up by one), not a cell-clear leaving a hollow row; adds always append
  after the last data row. Row-identity verification runs before every
  update/delete (see §4).
- **Atelier** (`app/atelier/page.tsx`, `lib/googleSheetsAtelier.ts`,
  `/api/atelier/*`) — same GAS-port pattern as Parking, reusing its
  `resolveIMM`/`getIMMList` logic. No ACTION field; its editable surface is
  COMMENTAIRE/CATÉGORIE/TECHNICIEN/BESOIN PIÈCE, restricted to an allowlist
  (unlike the original GAS tool, which allowed writes to any column
  including read-only XLOOKUP ones). Same real-row-deletion delete
  behavior as Parking.
- **Depot** (`app/depot/page.tsx`, `lib/googleSheetsDepot.ts`,
  `/api/depot/*`) — a structural clone of Parking (same columns, same
  XLOOKUP formulas, only ACTION editable), same real-row-deletion delete
  behavior.
- **RDV** (`app/rdv/page.tsx`, `lib/googleSheetsRdv.ts`,
  `lib/googleSheetsRdvMonthly.ts`, `lib/rdvIdentity.ts`, `/api/rdv/*`) — an
  appointment/convoyage log (Date/Heure/Clients/Véhicule/Matricule/
  Intervention/Contact/CONVOYEUR), with its own linked home nav card.
  **Has a standalone `/rdv` page** — a day-grouped table (one table per
  selected day, matching the monthly calendar tab's own visual shape) with
  a date picker, inline field edit, and a clear (not delete) action per
  appointment; the Date column itself is intentionally read-only, since
  changing it would move the appointment to a different day-block (and
  possibly a different monthly tab) — clear + re-add via `AddRdvDialog` is
  the workaround for moving a date. (A previous version of this page was
  removed once RDV data was surfaced contextually on BDD cards instead;
  it was later rebuilt with materially more functionality — this is the
  current, real state, not the removed one.)
  Unlike Parking/Atelier/Depot, rows are never deduped by plate — the same
  vehicle legitimately has many appointments — so adding always appends a
  new row. Writes use `RAW` (not `USER_ENTERED`) specifically because
  `USER_ENTERED` was found to silently strip leading zeros from pure-digit
  phone numbers.
  Every add/update/clear is a **dual write**: `lib/googleSheetsRdvMonthly.ts`
  writes into the monthly appointment-calendar tab (e.g. "Juillet 2026") in
  `GOOGLE_RDV_SHEETS_ID` — the durable source of truth an external Google
  Apps Script periodically rebuilds — always *before* `lib/googleSheetsRdv.ts`
  writes the same change into the flat "RDV" mirror tab in the main
  spreadsheet; writing only to the flat tab would be silently destroyed on
  the GAS script's next rebuild. Update/clear never trust a client-held row
  number: `lib/rdvIdentity.ts`'s `resolveUniqueMatch()` re-resolves the
  target row on every write by matching full row content fresh against the
  candidate rows for that date, throwing rather than guessing if the match
  is ambiguous or not found — a row shifting under a stale cached row index
  (the monthly tab's insertDimension fallback can do this at any time) can't
  silently edit the wrong appointment.
  An "Exporter" button next to the date picker downloads the selected day's
  table as a PNG (`rdv-<date>.png`, for sharing in WhatsApp) — client-side
  only, no server round-trip. It renders a dedicated off-screen `ExportTable`
  (plain markup, not the live interactive table, so delete icons/InlineEdit
  chrome and the live table's `overflow-x-auto` clipping are excluded by
  construction) via `html-to-image` — chosen over `html2canvas`, which
  throws on Tailwind v4's oklch/oklab color functions.
  The interaction model was then reworked: the old per-row trash icon (both
  layouts) was replaced by a single "Effacer" button in the top action bar,
  enabled only once an appointment is selected via a new `SelectToggle` —
  tapping a row (desktop table) or a card toggles `selectedRowIndex`, a
  UI-only selection value that the actual clear mutation never trusts
  directly (it still re-derives identity through the existing
  `rdvRowToIdentity()`/`resolveUniqueMatch()` path). Below the `sm:`
  breakpoint the day view renders stacked `MobileRdvCard`s (same
  `InlineEditText`/`InlineEditSelect` wiring as the table, just
  re-laid-out) instead of the table, which remains for `sm:` and up. A
  plate-search box above the table filters across every loaded
  appointment on every day, not just the selected day — an exact single
  match jumps the date picker to that day and pre-selects the row;
  multiple matches render a date-grouped picker to choose from; no
  matches surface the existing inline error banner.
- **DS History** (`app/ds-history/page.tsx`, `/api/ds/history`) — its
  primary search is MongoDB's `ds`/`bc` collections by plate only (VIN/
  Année/Limite inputs were deliberately dropped). Its BC-price lookup was
  rewritten to avoid a correlated `$lookup` that couldn't use an index
  regardless of query shape — collecting the needed `(cmd_num, code_art)`
  pairs up front and joining in application code instead, cutting
  heavy-plate response time from ~7s to ~150–250ms.
  Beyond that primary search, the page also assembles two more card
  clusters from other sources, all keyed off the same plate:
  - **`VehicleCard`** — merges MongoDB's `parc` (vehicle master data) and
    `cp` (contracts) collections, read via `/api/parc` and `/api/cp`
    (`app/api/parc/route.ts`, `app/api/cp/route.ts`). Plate/WW-suggest
    autocomplete for the page's search box is backed by `/api/query` and
    `/api/query/search`, both querying `parc`'s indexed `Immatriculation`/
    `Numéro WW` fields via an uppercased, prefix-anchored `escapeRegex()`
    filter (dropping `$options: "i"` so the query can actually use the
    index instead of forcing a collection scan).
  - **`SheetCard`** — merges three Google Sheets sources fetched through
    `/api/sheet?sheet=bdd|rl|import` (`app/api/sheet/route.ts`): the BDD
    tab (same rows/hooks Suivi RL edits — editing either page's
    Immobilisation card updates the same row), the **"RL" tab**
    (`lib/googleSheetsRl.ts` — véhicule de remplacement / replacement-
    vehicle records), and the **"Import" tab** (`lib/googleSheetsImport.ts`
    — Assistance import events; a 26,381-row tab too large to read/filter
    in JS the way the smaller tabs are, so it does a targeted two-step
    read: scan only the "Immatricule" column for matching row numbers,
    then batch-fetch just those full rows).
  The BDD Immobilisation card itself is editable via the same BDD hooks as
  Suivi RL; the Vehicle card also shows Parking/Atelier/RDV/Depot zone
  badges.
- **Articles / Export** (`app/articles/page.tsx`, `/api/article`,
  `/api/export`) — searches MongoDB's article/BC data and generates
  PDF/DOCX exports (`docx`, `pdf-lib`). Rate-limited at 20 requests/5
  minutes (§4); its description/brand search uses an escaped but
  non-prefix, case-insensitive regex (see the known-limitations note
  in §4).

**Zone badges**: `useVehicleZone(imm)` (a shared hook) checks whether a
plate exists in Parking/Atelier/RDV/Depot by reusing each page's already-
loaded React Query cache rather than a dedicated existence-check endpoint.
If a plate is in more than one zone, all matching badges render together —
treated as a real, visible fact about the data rather than something to
collapse or hide.

## 6. Conventions to follow

- **Don't rebuild a pattern that already exists.** Reuse
  `components/fleet/` (`ListPageHeader`, `RecordCard`, `Field`,
  `PlateSearchInput`, `PlateFilterInput`, `ZoneBadges`,
  `InlineEditSelect`/`InlineEditText`/`InlineEditCombobox`) and
  `components/ui/` (the hand-written shadcn-pattern primitives on Radix UI
  — Button, Input, Dialog, AlertDialog, Combobox, Badge, ToggleGroup,
  Sheet, Card) instead of writing new one-off markup for something these
  already cover. They exist specifically because Parking/Atelier/Depot/BDD
  used to duplicate ~95% of this markup independently.
- **One shared Sheets client, not per-tab copies.**
  `lib/googleSheetsClient.ts` holds the shared JWT auth client,
  `verifyRowIdentity()`, retry/caching logic, and `ApiError`/
  `toErrorResponse()` — every `lib/googleSheets*.ts` module builds on this
  rather than re-implementing auth or error handling per tab.
- **New Sheets mutation routes need the same three things** every existing
  one has: `rateLimitOrNull()` from `lib/rateLimit.ts`, `verifyRowIdentity()`
  before any update/delete that uses a client-supplied `rowIndex`, and
  `toErrorResponse()` in the catch block so raw driver errors never reach
  the client.
- **New user-input-driven Mongo regex queries must go through
  `lib/regex.ts`'s `escapeRegex()`** — never interpolate raw user input
  into a `$regex` filter.
- **Theming tokens are mandatory, not optional** — see §3. Don't introduce
  a literal `zinc-*`/`black`/`white` class in a new component.
- **Don't reintroduce `next/font/google`'s Geist** in `app/layout.tsx` —
  see §3's Font section for why it was removed.
- **One theme toggle component** (`components/fleet/ThemeToggle.tsx`) —
  don't build a second one; add the existing component with the
  appropriate `variant`.

## 7. Where to find more detail

- **[`PROJECT_HISTORY.md`](./PROJECT_HISTORY.md)** — the full,
  commit-by-commit feature timeline this document's §5 summarizes, plus
  the reasoning behind decisions (why RDV's standalone page was removed,
  why the BC-price lookup was restructured, why Prestataire/Flag chips
  were restored after being cut, etc.).
- **[`SECURITY_VERIFICATION.md`](./SECURITY_VERIFICATION.md)** — the full,
  file-and-line-cited security verification this document's §4 summarizes,
  including checks confirmed live against a running server rather than
  just read from config.
- **[`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md)** — the grep/count-verified
  color, typography, radius, and error-banner conventions behind this
  document's §3 (and the shared-component conventions in §6); consult it
  directly for the reasoning behind specific accent-color/radius/spacing
  choices.
