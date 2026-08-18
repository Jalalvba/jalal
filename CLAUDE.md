# jalal — AVIS Maroc fleet management

@AGENTS.md

Canonical reference for Claude Code sessions — the rules imported above
apply regardless of which AI assistant is driving; this file adds
Claude-Code-specific detail on top. Gemini CLI / Antigravity sessions use
[`GEMINI.md`](./GEMINI.md); if the two disagree, that's a doc bug, fix
both. Full detail lives in the linked documents in §8, not duplicated here.

## 1. Project overview

AVIS Maroc fleet management — tracks vehicles across parking, workshop
(Atelier), storage (Depot), and appointments/convoyage (RDV), backed by a
live Google Sheet as the system of record, with MongoDB holding large
read-mostly reference collections (`ds`, `bc`, `parc`, `cp`) for
search/lookup and export.

**Stack:** Next.js App Router (Next 16, React 19) · MongoDB (native
driver) · Google Sheets API via a service-account JWT client
(`src/lib/sheets/googleSheetsClient.ts` + per-tab `googleSheets*.ts` modules) ·
iron-session · TanStack Query · Tailwind v4 + shadcn-pattern primitives on
Radix UI. **Deployed on Vercel** — `NODE_ENV` gates cookie `secure`/CSP
`unsafe-eval` between dev/prod.

## 2. Getting started

```bash
pnpm install
pnpm dev      # start the dev server at http://localhost:3000
pnpm build    # production build
pnpm start    # run a production build
pnpm lint     # eslint
pnpm test     # vitest unit/integration suite (fast, no network)
pnpm test:e2e # playwright E2E suite (needs real .env.local + a dev server) — see TESTING.md
```

Copy `.env.example` to `.env.local` and fill in real values:

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB connection string |
| `MONGODB_DB` | Database name (`avis`) |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth 2.0 web client — authorizes exactly one account, see §4 |
| `IRON_SESSION_SECRET` | Encrypts the session cookie, ≥32 chars |
| `GOOGLE_SERVICE_ACCOUNT_KEY_B64` | Base64-encoded service account JSON, grants Sheets/Drive access |
| `GOOGLE_SHEETS_ID` | The spreadsheet ID every `src/lib/sheets/googleSheets*.ts` module reads/writes |
| `GOOGLE_RDV_SHEETS_ID` | **Separate** spreadsheet holding the monthly appointment-calendar tabs — see §6's RDV entry. **Production scope only** on Vercel; a Preview deployment touching RDV code needs its own value added via `vercel env add` |
| `GOOGLE_DRIVE_FOLDER_ID` | Only needed for the optional `scripts/test-service-account.ts` diagnostic |
| `VERCEL_OIDC_TOKEN` | Auto-populated by `vercel env pull`/`vercel dev` — not set by hand |

`MONGODB_URI`, `IRON_SESSION_SECRET`, and `GOOGLE_OAUTH_*` currently only
exist in Production scope on Vercel — pull with `vercel env pull
.env.local --environment=production`, or add dev/preview values via `vercel env add`.

## 3. Theming system

Single app-wide light/dark system — no per-page theme logic. Use the
tokens below, never a literal `zinc-*`/`bg-black`/`bg-white` class.

- **Mechanism**: [`next-themes`](https://github.com/pacocoursey/next-themes)
  toggles `.dark` on `<html>`; default is **light 7am–7pm, dark
  otherwise** (local time, via `src/lib/utils/themeDefault.ts`'s
  `getTimeBasedTheme()` — edit `LIGHT_START_HOUR`/`LIGHT_END_HOUR` there
  to change the cutoff) until an explicit choice sets
  `localStorage['theme-explicit']`, which then sticks. Full wiring:
  PROJECT_HISTORY.md's "Theming" section.
- **Toggle**: `src/components/fleet/ThemeToggle.tsx` is the *only* toggle —
  `variant="pill"` or `"icon"` (wired into `ListPageHeader`). Don't build
  another one.

| Token | Utility classes | Light → Dark | Use for |
|---|---|---|---|
| `background` / `foreground` | `bg-background` / `text-foreground` | zinc-50→black / zinc-900→zinc-50 | Page root |
| `card` / `card-foreground` | `bg-card` / `text-card-foreground` | white→zinc-900 / zinc-900→zinc-100 | Card surfaces |
| `muted` / `muted-foreground` | `bg-muted` / `text-muted-foreground` | zinc-100→zinc-800 / zinc-500 | Dimmed/secondary chrome |
| `border` | `border-border` | zinc-200→zinc-800 | Every border |
| `input` | `bg-input` | white→zinc-900 | Inputs, textareas |
| `popover` / `popover-foreground` | `bg-popover` / `text-popover-foreground` | white→zinc-950 / zinc-900→zinc-100 | Dropdowns, `Combobox`, `AlertDialog` |

**Deliberate literal-color exceptions** (not bugs): zone/brand accents
(sky/amber/emerald/lime/violet/fuchsia — see
[`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) for the mapping), translucent
washes (`FLAG_STYLE`, ÉTAT badges, `ZoneBadges`), modal scrims
(`bg-black/70`), and `focus:border-zinc-500` on inputs.

**Font**: Inter (body/headings) + JetBrains Mono (`font-mono`,
identifiers only), via a Google Fonts `@import` in `src/app/globals.css`. Do
**not** reintroduce Playfair Display (dropped, too little footprint) or
Geist (dropped, was a dead fetch). Change fonts via the `--font-*`
tokens/`@import` in `globals.css`, not `layout.tsx`.

## 4. Authentication & security

- **Auth**: single-user Google OAuth only (`src/app/api/auth/google/*`) — ID
  token verified, then checked against one hardcoded constant,
  `src/lib/auth/googleOAuth.ts`'s `AUTHORIZED_EMAIL`. No User model/allowlist.
- **Every request gated by `src/proxy.ts`** via an iron-session cookie
  (`session.isLoggedIn`, sealed, 7-day expiry) — only `/login`,
  `/api/auth/google*`, and static assets excluded (anchored matching).
- **CSRF**: OAuth flow uses a cookie-bound `state` token; the app's own
  mutation routes rely on `sameSite: lax` instead of a separate token.
- **Sheets writes / Mongo regex**: `verifyRowIdentity()` and
  `escapeRegex()` are mandatory (see [`AGENTS.md`](./AGENTS.md) rules 3–4).
- **Rate limiting**: `src/lib/http/rateLimit.ts`, Mongo atomic `$inc` — 17 Sheets
  mutation routes at 30 req/min; article/export at 20 req/5min.
- **Secrets**: nothing committed anywhere (verified via full history
  search); `.gitignore` excludes all `.env*` but `.env.example`.
- **HTTP headers**: `X-Frame-Options`/`nosniff`/`Referrer-Policy`/HSTS +
  a per-request nonce'd CSP, confirmed live on every response path.

**Known, deliberate limitations** (not gaps to "fix"): single hardcoded
auth email, implicit CSRF, no OAuth fallback, spoofable rate-limit IP
headers outside Vercel, and non-prefix-indexable Articles search regex.
Full file/line-cited detail: [`SECURITY_VERIFICATION.md`](./SECURITY_VERIFICATION.md).

## 5. Multi-tool workflow: Gemini/Antigravity is read-only

This project uses two AI tools with strictly separated roles. Kept in
sync with [`AGENTS.md`](./AGENTS.md)'s copy of this section — if they
ever diverge, that's a doc bug, fix both.

- **Claude Code**: the ONLY tool permitted to write, edit, or execute
  changes in this repository. All code changes, file edits, commits, and
  test runs happen exclusively through Claude Code.
- **Antigravity CLI / Gemini**: READ-ONLY audit and research tool. No
  exceptions.

**Hard rules for Gemini/Antigravity sessions:**
1. Never write, edit, delete, or modify any file, or run any write
   operation against MongoDB, Google Sheets, Google Drive, Gmail, or any
   other connected Google API/service — read-only access, always.
2. Never claim something is true without citing where it was verified
   (a file/line, a live Sheet-tab read, a query result) — not assumed,
   not remembered from a prior session, not inferred from a filename.
3. Every session must end with a single, ready-to-use prompt for Claude
   Code to execute, summarizing findings and the recommended action —
   the only output the human should need to copy.
4. If a task requires an actual change, decline explicitly and hand back
   the prompt for Claude Code instead of attempting it.
5. **Claude Code must independently verify any Gemini/Antigravity-sourced
   finding against the real, live codebase/data before acting on it** —
   same as any other unverified claim. A read-only audit tool can still
   be wrong or stale; verification stays required regardless of source.

**After any change** (either tool's handoff): `git status`,
`pnpm exec tsc --noEmit`, `pnpm lint`, then commit small and often so a
mistake is trivially revertible (`git revert`).

## 6. Feature / data model reference

Each feature is a page + API routes + a `src/lib/sheets/googleSheets*.ts` module
against one Sheet tab, except DS History/Articles (MongoDB).

| Feature | Files | Notes |
|---|---|---|
| BDD / Suivi RL | `src/app/suivi-rl/page.tsx`, `src/lib/sheets/googleSheetsBdd.ts`, `/api/bdd*` | 7-field editable allowlist, per-field inline commit (no card save button). Plate-only search, which bypasses the chips. Four multi-select chip axes (Flotte/Emplacement/Prestataire/Flag), OR within an axis and AND across, each with a data-derived option list + "Non renseigné" blank chip. PDF + Excel export of the filtered view; AI comment reformulation. Read-only RDV/CONVOYEUR/Intervention via XLOOKUP. Full detail: [`docs/suivi-rl.md`](./docs/suivi-rl.md). |
| Parking | `src/app/parking/page.tsx`, `src/lib/sheets/googleSheetsParking.ts`, `/api/parking/*` | GAS port. Delete = real row deletion, not cell-clear; add always appends. |
| Atelier | `src/app/atelier/page.tsx`, `src/lib/sheets/googleSheetsAtelier.ts`, `/api/atelier/*` | GAS port, reuses Parking's `resolveIMM`/`getIMMList`. No ACTION field; editable surface is COMMENTAIRE/CATÉGORIE/TECHNICIEN/BESOIN PIÈCE only. |
| Depot | `src/app/depot/page.tsx`, `src/lib/sheets/googleSheetsDepot.ts`, `/api/depot/*` | Structural clone of Parking; only ACTION editable. |
| RDV | `src/app/rdv/page.tsx`, `src/lib/sheets/googleSheetsRdv.ts`, `src/lib/sheets/googleSheetsRdvMonthly.ts`, `src/lib/sheets/rdvIdentity.ts`, `/api/rdv/*` | Day-grouped table + mobile stacked cards, date picker, cross-day plate search, PNG export. Rules below. |
| DS History | `src/app/ds-history/page.tsx`, `/api/ds/history`, `/api/parc`, `/api/cp`, `/api/query*`, `/api/sheet` | Plate-only Mongo search (`ds`/`bc`) + `VehicleCard` (`parc`/`cp`) + `SheetCard` (BDD/RL/Import tabs). |
| Articles / Export | `src/app/articles/page.tsx`, `/api/article`, `/api/export` | Mongo article/BC search, PDF/DOCX export. Rate-limited 20 req/5min. |
| Fleet Data Import | `src/components/fleet/ImportTrigger.tsx` (used from `src/app/page.tsx`), `/api/trigger-import`, `/api/import-status` | Button that proxies a **separate** Vercel project (`~/import`, deployed at `https://import-red.vercel.app`) which runs the DS/CP/PARC/BC Drive→Mongo ETL — this repo has no Drive/ETL code of its own. Rules below. |

**Fleet Data Import rules**: `/api/trigger-import` calls that project's
token-gated `GET /api?token=...` (blocks ~60–90s until all 4 pipelines
finish), then backfills real per-step timestamps/detail via its
unauthenticated `GET /api/status?run_id=...` for each run (the trigger
response itself only carries a compact `"step:status"` string per step).
`IMPORT_PIPELINE_TOKEN` (this repo's env var) must exactly match that
project's `PIPELINE_TRIGGER_SECRET` — see `.env.example`'s comment; set
via `vercel env add IMPORT_PIPELINE_TOKEN` on **this** project, not
`~/import`. `/api/import-status` re-looks-up a past run's detail
read-only, no token needed (`run_id` is an unguessable UUID4). Full
backend documentation — pipeline internals, skip-if-unchanged logic,
`?force=true`, the `pipeline_runs` Mongo schema — lives in that
project's own `CLAUDE.md` (`~/import/CLAUDE.md`, a separate repo — not
a relative link since it isn't part of this one), not duplicated here.

**RDV-specific rules** (load-bearing): writes use `RAW`, never
`USER_ENTERED` (strips leading zeros from phone numbers); every
add/update/clear **dual-writes** `googleSheetsRdvMonthly.ts` (monthly
tab, real source of truth) before `googleSheetsRdv.ts` (flat mirror —
mirror-only writes are destroyed on the next GAS rebuild); update/clear
never trust a client-held `rowIndex` — `src/lib/sheets/rdvIdentity.ts`'s
`resolveUniqueMatch()` re-resolves the row by full-content match,
throwing on an ambiguous match rather than guessing.

**Zone badges**: `useVehicleZone(imm)` checks Parking/Atelier/RDV/Depot
membership via each page's already-loaded React Query cache; a plate in
multiple zones renders all matching badges. Full per-feature history and
reasoning: [`PROJECT_HISTORY.md`](./PROJECT_HISTORY.md).

## 7. Conventions to follow

The mandatory rules (package manager, styling tokens, Sheets/Mongo write
safety, auth model) live in [`AGENTS.md`](./AGENTS.md) — not restated
here. Additional conventions:

- **Don't rebuild a pattern that already exists.** Reuse
  `src/components/fleet/` (`ListPageHeader`, `RecordCard`, `Field`,
  `PlateSearchInput`, `PlateFilterInput`, `ZoneBadges`, `InlineEdit*`)
  and `src/components/ui/` (Button, Input, Dialog, AlertDialog, Combobox,
  Badge, ToggleGroup, Sheet, Card) instead of new markup — they exist
  because Parking/Atelier/Depot/BDD used to duplicate ~95% of this.
- **One shared Sheets client, not per-tab copies.**
  `src/lib/sheets/googleSheetsClient.ts` holds the shared JWT client,
  `verifyRowIdentity()`, retry/caching, and `ApiError`/
  `toErrorResponse()` — every `googleSheets*.ts` module builds on this.

## 7.5 field_registry.json — CI-enforced Mongo field-name verification

`field_registry.json` (repo root) is a **copy** of a live-scan snapshot of
every real field name in `ds`/`bc`/`cp`/`parc`, generated by
`~/import`'s `scripts/export_field_registry.py` — ground truth, not what
either repo's code assumes. `pnpm verify-field-names`
(`scripts/verify-field-names.cjs`, wired into CI at
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml)) scans every
`src/app/api/**` file's `"$fieldname"`-style Mongo references and fails the
build if any of them don't byte-for-byte match an entry in this file (for
whichever collection(s) that file's `getCollection()`/`$lookup` calls
touch). A deliberate, temporary exception (e.g. a dual-read during a
backfill window) is allowed via a same-file marker comment:
`// verify-field-names:allow <fieldname> -- <reason>`.

**Regenerate/re-copy `field_registry.json`** (`cp ~/import/field_registry.json
./field_registry.json`, after re-running `~/import`'s export script) whenever
a real Mongo field changes — same triggers as `~/import/CLAUDE.md`'s
"field_registry.json" section: a backfill actually runs, `~/import`'s
`FIELD_MAPS` changes, or any other manual migration touches `ds`/`bc`/`cp`/
`parc`. Skipping this doesn't fail loudly — CI just keeps validating against
a stale snapshot.

## 8. Where to find more detail

- **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** — index to [`docs/`](./docs), the per-feature current-state reference: what each feature does, **why** it was built that way, what it explicitly is *not* meant to do, and its known limitations. Deepest coverage of Suivi RL's filters, the BDD PDF/Excel exports, the two Gemini routes, config-driven options, and the `~/import` proxy. Also carries the running list of decisions-that-look-like-bugs and open defects.
- **[`AGENTS.md`](./AGENTS.md)** — mandatory cross-assistant rules, imported at the top of this file.
- **[`GEMINI.md`](./GEMINI.md)** — the equivalent entry point for Gemini CLI / Antigravity sessions.
- **[`PROJECT_HISTORY.md`](./PROJECT_HISTORY.md)** — full commit-by-commit feature timeline and reasoning.
- **[`SECURITY_VERIFICATION.md`](./SECURITY_VERIFICATION.md)** — full, file/line-cited security verification.
- **[`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md)** — color/typography/radius/error-banner conventions.
- **[`TESTING.md`](./TESTING.md)** — how to run the Vitest unit/integration suite and the Playwright E2E suite, what each test actually covers, and the gaps left deliberately uncovered.
