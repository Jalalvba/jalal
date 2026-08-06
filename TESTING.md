# Testing

Two suites, for two different jobs. Both are real, persisted test files —
not the ad-hoc one-off Playwright scripts used for manual verification in
past sessions (those were written, run, and thrown away each time; nothing
protected against the same bug coming back).

## Unit + integration tests (Vitest)

```bash
pnpm test          # same as test:unit
pnpm test:unit
```

Fast (~2s), no network, no running dev server needed. Runs on every file
under `**/__tests__/*.test.ts`.

**What's covered:**

| File | What it locks in |
|---|---|
| `lib/__tests__/regex.test.ts` | `escapeRegex()` — regex-injection/ReDoS safety (pre-existing) |
| `lib/__tests__/rdvIdentity.test.ts` | `resolveUniqueMatch()` — RDV row identity resolution (pre-existing) |
| `lib/__tests__/googleSheetsClient.test.ts` | `verifyRowIdentity()` — stale-row-conflict detection (pre-existing) |
| `lib/__tests__/plateVariants.test.ts` | `buildPlateVariants()` — the WW-prefix/suffix matching every zone-detection badge and BDD/RL plate search depends on |
| `lib/__tests__/sheetFieldOptions.test.ts` | `getAllSheetFieldOptions()`'s fallback-to-hardcoded-defaults on Mongo failure (whole collection down, one query failing, and per-key partial fallback), plus `updateFieldOptions()`'s validation (empty list, duplicate value, invalid color) |
| `lib/__tests__/rateLimit.test.ts` | `checkRateLimit()`/`rateLimitOrNull()` failing OPEN (allowing the request) when Mongo throws — the actual root cause of the BDD export 500 found via Vercel's production logs |
| `app/api/bdd/export/__tests__/isValidRow.test.ts` | Row validation rejects a non-string field (the Peugeot 208/508/2008/3008 "modele as a raw number" bug) |
| `app/api/bdd/export/__tests__/route.test.ts` | Route-level validation (empty rows, >2000 rows, malformed filters, bad JSON) and the happy path — asserts a real `%PDF`-prefixed byte stream comes back, not just a 200 |
| `app/api/bdd/export/__tests__/route.mongo-down.test.ts` | The rate-limiter fix verified **at the exact route where it was reported**, with the real (unmocked) `lib/rateLimit.ts` and only Mongo mocked to fail |
| `app/api/trigger-import/__tests__/route.test.ts` | Missing token, rate-limited, network failure, 401, malformed response, successful passthrough, and graceful degradation to the compact step summary when a run's status lookup fails |
| `app/api/import-status/__tests__/route.test.ts` | Missing `run_id`, successful lookup, 404 passthrough, network failure, rate-limited |
| `components/fleet/__tests__/buildSummary.test.ts` | Every `ImportPipelineRunStatus` combination (success / failed / skipped_unchanged / skipped_absent / mixed) — the exact status-string distinction a past bug collapsed into a bare `"skipped"` |

**Mocking approach:** `vi.mock()` at the module boundary (`@/lib/mongo`,
`@/lib/rateLimit`, `global.fetch`), not a database emulator. Justification:
every Mongo-touching function here is a thin wrapper (`getCollection` +
one or two driver calls) — the thing worth testing is *this app's failure
handling*, not the MongoDB driver's own correctness. A tool like
`mongodb-memory-server` would exercise real query semantics, which isn't
where the actual bugs this session found were (`isValidRow`'s type check,
the rate limiter's missing try/catch, the status-string handling) — none
of them were query-correctness bugs. If a future test genuinely needs real
Mongo query behavior (an aggregation pipeline, an index-dependent sort),
reach for `mongodb-memory-server` then rather than retrofitting it now.

`vitest.config.mts` sets dummy `MONGODB_URI`/`MONGODB_DB`/
`GOOGLE_SERVICE_ACCOUNT_KEY_B64` env vars — not because tests use them, but
because `lib/mongo.ts`/`lib/googleSheetsClient.ts` throw at *module import
time* if they're unset, and several routes under test import those modules
transitively (through `lib/rateLimit.ts`) even in files that mock them
away. The dummy `MONGODB_URI` also means `lib/mongo.ts`'s module-level
`client.connect()` fires a real (never-awaited, always-losing) connection
attempt to an unreachable host once per test process — harmless (no test
ever calls the real `getCollection()`), same pattern already established
for the Sheets client's dummy key.

## E2E tests (Playwright)

```bash
pnpm test:e2e
```

**Needs a real environment** — these hit the actual live Sheets/Mongo data
this session worked against all along, the same way every manual
verification pass did:

- `.env.local` with real secrets (`IRON_SESSION_SECRET` to mint a session
  cookie, `MONGODB_URI`, Sheets service-account credentials). If you only
  have Production-scoped Vercel env vars: `vercel env pull .env.local
  --environment=production`.
- Chromium for this Playwright version: `pnpm exec playwright install
  chromium` (one-time).
- A dev server. `playwright.config.ts`'s `webServer` block starts `pnpm
  dev` automatically if port 3000 isn't already serving `/login`
  (`reuseExistingServer: true` — if you already have `pnpm dev` running,
  it's reused instead of a second instance fighting for the port).

Runs with `workers: 1` (`playwright.config.ts`) — every spec shares one
real backend and one real session; running spec files concurrently was
observed to race against each other's page loads.

`expect.timeout` is set to 15s (not Playwright's 5s default): Next.js's
dev-mode Turbopack compiles each route on-demand on its first hit in a
given server process — a real 6+ second delay was observed on
`/api/config/options`'s first POST, purely from cold-compiling the route
handler, nothing to do with the app. A production build (`pnpm build &&
pnpm start`) wouldn't carry this tax, at the cost of losing the dev
server's fast-refresh loop while iterating on a spec.

**Auth**: `e2e/helpers/auth.ts` seals a real iron-session cookie the same
way `lib/session.ts` expects to unseal one — the formalized version of the
`sealData(...)` script every manual Playwright pass this session wrote
from scratch. `e2e/fixtures.ts` wraps `@playwright/test`'s own `test`/
`expect` to apply that cookie automatically; every spec file imports from
`./fixtures`, not `@playwright/test` directly, and gets an already-
authenticated `page`. Google's own OAuth flow is bypassed entirely, not
exercised — see Gaps below.

**What's covered:**

| Spec | What it does |
|---|---|
| `e2e/suivi-rl.spec.ts` | Clicks the Emplacement=ATELIER chip, cross-checks the displayed count against `/api/bdd`'s real data (mirroring the page's own Flotte=INTERNE-default + Emplacement filter cascade) rather than a hardcoded number |
| `e2e/atelier.spec.ts` | Two cases: a named Technicien chip isolates exactly their rows; the new "Non assigné" chip isolates exactly the blank-Technicien rows — both cross-checked against `/api/atelier` |
| `e2e/admin-config.spec.ts` | Adds a uniquely-named test value to Technicien via `/admin/config`, confirms it reaches the dependent Atelier `<select>`, removes it, confirms cleanup in both the UI and (implicitly) Mongo. Wraps the add/verify in try/finally so a failed assertion still triggers cleanup — writes to the same collection the deployed app reads from |

Each spec computes its own expected value from a live API call rather than
asserting a hardcoded count, specifically because this data was observed
to change organically mid-session (real concurrent workshop usage) —
hardcoding "11 unassigned rows" would have made the test flaky against
reality within days.

## Deliberately NOT covered (be honest about the gaps)

- **The real Mongo outage fail-open path is unit-tested with a mock, not
  verified against a real outage** by this persisted suite. It *was*
  manually verified against a genuinely unreachable Mongo host once
  (pointing `MONGODB_URI` at a TEST-NET address, confirming the export
  still returned a PDF) — but that was a one-off manual check, not
  something this suite re-runs. The unit tests only prove the code's own
  try/catch branches correctly; they can't prove the MongoDB driver
  itself behaves the way the mocks assume under a real network partition.
- **No isolated test database or test Sheets tab.** Every E2E spec reads
  (and `admin-config.spec.ts` briefly writes) the real production Mongo/
  Sheets data. There is no seeded fixture dataset — assertions are
  computed from whatever's live at run time, which is intentional (see
  above) but means a spec can't assert something specific doesn't exist
  in the data without checking first.
- **No coverage of the Sheets read/write modules themselves**
  (`lib/googleSheets{Bdd,Atelier,Parking,Depot,Rdv,RdvMonthly}.ts`) beyond
  what `verifyRowIdentity`/`resolveUniqueMatch` already had. Testing these
  properly means mocking the `sheets_v4.Sheets` client per module, which
  wasn't done in this pass — a real gap, not an oversight to hide.
- **No OAuth login flow test.** `e2e/helpers/auth.ts` mints a session
  cookie directly, bypassing Google's OAuth entirely — a broken
  `/api/auth/google/callback` wouldn't be caught here.
- **CI covers the Vitest suite only, not E2E.** `.github/workflows/ci.yml`
  runs `tsc --noEmit`, `pnpm lint`, and `pnpm test` on every push to `main`
  and every pull request. The Playwright suite is intentionally left out
  of that path — it writes to real production Sheets/Mongo data (see
  "Needs a real environment" above) and needs real secrets, so it's wired
  as a separate `e2e` job gated behind `workflow_dispatch` (manual trigger
  from the Actions tab) instead of running unattended on every PR.
- **No visual regression or accessibility testing.**
- **Stage 1 admin/config's option-set VALUES are covered; header/field
  structure is not** (matches Stage 1's own scope — see the
  config-driven-sheet-structure proposal).
