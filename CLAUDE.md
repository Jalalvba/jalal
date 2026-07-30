# jalal — AVIS Maroc fleet management

@AGENTS.md

Canonical reference for Claude Code sessions in this project — the rules
imported above apply regardless of which AI assistant is driving; this
file adds Claude-Code-specific project detail on top. Gemini CLI /
Antigravity sessions use the equivalent [`GEMINI.md`](./GEMINI.md); if the
two ever disagree on a fact, that's a doc bug, fix both. Full detail lives
in the linked documents in §7, not duplicated here.

## 1. Project overview

AVIS Maroc fleet management — tracks vehicles across parking, workshop
(Atelier), storage (Depot), and appointments/convoyage (RDV), backed by a
live Google Sheet as the system of record for editable operational data,
with MongoDB holding large read-mostly reference collections (`ds`, `bc`,
`parc`, `cp`) used for search/lookup and export.

**Stack:** Next.js App Router (Next 16, React 19) · MongoDB (native
driver) · Google Sheets API via a service-account JWT client
(`lib/googleSheetsClient.ts` + per-tab `googleSheets*.ts` modules) ·
iron-session · TanStack Query · Tailwind CSS v4 + hand-written
shadcn-pattern primitives on Radix UI. **Deployed on Vercel** —
`NODE_ENV` gates cookie `secure` and CSP `unsafe-eval` between dev/prod.

## 2. Getting started

```bash
pnpm install
pnpm dev      # start the dev server at http://localhost:3000
pnpm build    # production build
pnpm start    # run a production build
pnpm lint     # eslint
```

Copy `.env.example` to `.env.local` and fill in real values (see
`.env.example` for the up-to-date list):

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB connection string |
| `MONGODB_DB` | Database name (`avis`) |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth 2.0 web client — authorizes exactly one account, see §4 |
| `IRON_SESSION_SECRET` | Encrypts the session cookie, ≥32 chars |
| `GOOGLE_SERVICE_ACCOUNT_KEY_B64` | Base64-encoded service account JSON, grants Sheets/Drive access |
| `GOOGLE_SHEETS_ID` | The spreadsheet ID every `lib/googleSheets*.ts` module reads/writes |
| `GOOGLE_RDV_SHEETS_ID` | **Separate** spreadsheet holding the monthly appointment-calendar tabs — see §5's RDV entry. **Production scope only** on Vercel; a Preview deployment touching RDV code needs its own value added via `vercel env add` |
| `GOOGLE_DRIVE_FOLDER_ID` | Only needed for the optional `scripts/test-service-account.ts` diagnostic |
| `VERCEL_OIDC_TOKEN` | Auto-populated by `vercel env pull`/`vercel dev` — not set by hand |

`MONGODB_URI`, `IRON_SESSION_SECRET`, and the `GOOGLE_OAUTH_*` pair
currently only exist in Production scope on Vercel — pull with `vercel
env pull .env.local --environment=production`, or add dev/preview-scoped
values via `vercel env add`.

## 3. Theming system

Single app-wide light/dark system — no per-page theme logic. Use the
tokens below, never a literal `zinc-*`/`bg-black`/`bg-white` class.

- **Mechanism**: [`next-themes`](https://github.com/pacocoursey/next-themes)
  toggles a `.dark` class on `<html>`; default is **light 7am–7pm, dark
  otherwise** (local time) via `lib/themeDefault.ts`'s
  `getTimeBasedTheme()` (edit `LIGHT_START_HOUR`/`LIGHT_END_HOUR` there
  to change the cutoff) until the user makes an explicit choice, which
  sets `localStorage['theme-explicit']` so it sticks across visits. Full
  wiring detail: PROJECT_HISTORY.md's "Theming" section.
- **Toggle**: `components/fleet/ThemeToggle.tsx` is the *only* toggle —
  `variant="pill"` (Home/DS History/Articles/Login) or `variant="icon"`
  (wired into `ListPageHeader`). Don't build another one.

| Token | Utility classes | Light → Dark | Use for |
|---|---|---|---|
| `background` / `foreground` | `bg-background` / `text-foreground` | zinc-50→black / zinc-900→zinc-50 | Page root |
| `card` / `card-foreground` | `bg-card` / `text-card-foreground` | white→zinc-900 / zinc-900→zinc-100 | Card surfaces |
| `muted` / `muted-foreground` | `bg-muted` / `text-muted-foreground` | zinc-100→zinc-800 / zinc-500 | Dimmed/secondary chrome |
| `border` | `border-border` | zinc-200→zinc-800 | Every border |
| `input` | `bg-input` | white→zinc-900 | Inputs, textareas |
| `popover` / `popover-foreground` | `bg-popover` / `text-popover-foreground` | white→zinc-950 / zinc-900→zinc-100 | Dropdowns, `Combobox`, `AlertDialog` |

**Deliberate literal-color exceptions** (not bugs, don't tokenize): zone/
brand accents (sky/amber/emerald/lime/violet/fuchsia — see
[`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) for the single-source-of-truth
mapping), translucent washes (`FLAG_STYLE`, ÉTAT badges, `ZoneBadges`),
modal-overlay scrims (`bg-black/70` in dialogs/select-sheets), and
`focus:border-zinc-500` on inputs.

**Font**: Inter (body/headings) + JetBrains Mono (`font-mono`,
identifiers only), via a Google Fonts `@import` in `app/globals.css`. Do
**not** reintroduce Playfair Display (dropped, 5 headings app-wide wasn't
enough footprint) or `next/font/google`'s Geist (dropped, was a dead
fetch — `globals.css`'s own rules always overrode it). Change fonts by
editing the `--font-*` tokens/`@import` in `globals.css`, not
`layout.tsx`.

## 4. Authentication & security

- **Auth**: single-user Google OAuth only (`app/api/auth/google/*`) — ID
  token cryptographically verified, then checked against one hardcoded
  constant, `lib/googleOAuth.ts`'s `AUTHORIZED_EMAIL`. No User model, no
  allowlist, no registration.
- **Every request is gated by `proxy.ts`** via an iron-session cookie
  (`session.isLoggedIn`, sealed, 7-day expiry). Only `/login`,
  `/api/auth/google*`, and static assets are excluded, via anchored
  exact/prefix matching (not a loose `startsWith()`).
- **CSRF**: the OAuth flow uses a standard cookie-bound `state` token.
  The app's own mutation routes have no separate CSRF token — they rely
  on the session cookie's `sameSite: lax`, an implicit but real
  protection.
- **Sheets writes**: `verifyRowIdentity()` mandatory before every
  update/delete (see [`AGENTS.md`](./AGENTS.md) rule 3) — 409s on a
  stale client-held `rowIndex` instead of overwriting the wrong row.
- **Mongo regex**: `escapeRegex()` mandatory on any user-input `$regex`
  (see [`AGENTS.md`](./AGENTS.md) rule 4).
- **Rate limiting**: `lib/rateLimit.ts`, Mongo-backed atomic `$inc`. 17
  Sheets mutation routes at 30 req/min; `/api/article`+`/api/export` at
  20 req/5min.
- **Secrets**: nothing committed anywhere in tracked files (verified via
  full history search); `.gitignore` excludes all `.env*` but
  `.env.example`.
- **HTTP headers**: `X-Frame-Options`/`nosniff`/`Referrer-Policy`/HSTS +
  a per-request nonce'd CSP, confirmed live on every response path.

**Known, deliberate limitations** (not gaps to "fix"): single hardcoded
auth email, implicit (not per-route-token) CSRF, no fallback if Google
OAuth is down, spoofable rate-limit IP headers outside Vercel, and
Articles' search regex isn't prefix-indexable. Full file/line-cited
detail, including checks run live against a server:
[`SECURITY_VERIFICATION.md`](./SECURITY_VERIFICATION.md).

## 5. Feature / data model reference

Each feature is a page + API routes + a `lib/googleSheets*.ts` module
against one tab of the same Sheet, except DS History/Articles (MongoDB).

| Feature | Files | Notes |
|---|---|---|
| BDD / Suivi RL | `app/suivi-rl/page.tsx`, `lib/googleSheetsBdd.ts`, `/api/bdd*` | 6-field editable allowlist, per-field inline commit (no card save button). Plate/WW search; Prestataire/Flag/Flotte chips, bypassed by plate search. Read-only RDV/CONVOYEUR/Intervention via XLOOKUP. |
| Parking | `app/parking/page.tsx`, `lib/googleSheetsParking.ts`, `/api/parking/*` | GAS port. Delete = real row deletion, not cell-clear; add always appends. |
| Atelier | `app/atelier/page.tsx`, `lib/googleSheetsAtelier.ts`, `/api/atelier/*` | GAS port, reuses Parking's `resolveIMM`/`getIMMList`. No ACTION field; editable surface is COMMENTAIRE/CATÉGORIE/TECHNICIEN/BESOIN PIÈCE only. |
| Depot | `app/depot/page.tsx`, `lib/googleSheetsDepot.ts`, `/api/depot/*` | Structural clone of Parking; only ACTION editable. |
| RDV | `app/rdv/page.tsx`, `lib/googleSheetsRdv.ts`, `lib/googleSheetsRdvMonthly.ts`, `lib/rdvIdentity.ts`, `/api/rdv/*` | Day-grouped table + mobile stacked cards, date picker, cross-day plate search, PNG export. Rules below. |
| DS History | `app/ds-history/page.tsx`, `/api/ds/history`, `/api/parc`, `/api/cp`, `/api/query*`, `/api/sheet` | Plate-only Mongo search (`ds`/`bc`) + `VehicleCard` (`parc`/`cp`) + `SheetCard` (BDD/RL/Import tabs). |
| Articles / Export | `app/articles/page.tsx`, `/api/article`, `/api/export` | Mongo article/BC search, PDF/DOCX export. Rate-limited 20 req/5min. |

**RDV-specific rules** (load-bearing, not optional):
- Writes use `RAW`, never `USER_ENTERED` — the latter strips leading
  zeros from digit-only phone numbers.
- Every add/update/clear is a **dual write**: `googleSheetsRdvMonthly.ts`
  (the monthly calendar tab, real source of truth) always before
  `googleSheetsRdv.ts` (the flat "RDV" mirror) — mirror-only writes are
  silently destroyed on the next GAS rebuild.
- Never trust a client-held `rowIndex` for update/clear —
  `lib/rdvIdentity.ts`'s `resolveUniqueMatch()` re-resolves the target
  row by full-content match on every write, throwing rather than
  guessing on an ambiguous match.

**Zone badges**: `useVehicleZone(imm)` checks Parking/Atelier/RDV/Depot
membership by reusing each page's already-loaded React Query cache. A
plate in multiple zones renders all matching badges — a real fact about
the data, not something to collapse.

Full per-feature history and reasoning (why RDV's page was rebuilt, why
the BC-price lookup was restructured, etc.): see
[`PROJECT_HISTORY.md`](./PROJECT_HISTORY.md).

## 6. Conventions to follow

The mandatory rules (package manager, styling tokens, Sheets/Mongo write
safety, auth model) live in [`AGENTS.md`](./AGENTS.md) — not restated
here. Additional conventions:

- **Don't rebuild a pattern that already exists.** Reuse
  `components/fleet/` (`ListPageHeader`, `RecordCard`, `Field`,
  `PlateSearchInput`, `PlateFilterInput`, `ZoneBadges`,
  `InlineEditSelect`/`InlineEditText`/`InlineEditCombobox`) and
  `components/ui/` (Button, Input, Dialog, AlertDialog, Combobox, Badge,
  ToggleGroup, Sheet, Card) instead of new one-off markup — they exist
  because Parking/Atelier/Depot/BDD used to duplicate ~95% of this
  independently.
- **One shared Sheets client, not per-tab copies.**
  `lib/googleSheetsClient.ts` holds the shared JWT client,
  `verifyRowIdentity()`, retry/caching, and `ApiError`/
  `toErrorResponse()` — every `googleSheets*.ts` module builds on this.

## 7. Where to find more detail

- **[`AGENTS.md`](./AGENTS.md)** — the mandatory cross-assistant rules,
  imported at the top of this file.
- **[`GEMINI.md`](./GEMINI.md)** — the equivalent entry point for Gemini
  CLI / Antigravity sessions.
- **[`PROJECT_HISTORY.md`](./PROJECT_HISTORY.md)** — the full
  commit-by-commit feature timeline and the reasoning behind decisions.
- **[`SECURITY_VERIFICATION.md`](./SECURITY_VERIFICATION.md)** — the
  full, file-and-line-cited security verification §4 summarizes.
- **[`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md)** — color/typography/
  radius/error-banner conventions §3 summarizes.
