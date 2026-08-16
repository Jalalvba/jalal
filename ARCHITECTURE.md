# Architecture

Index to the per-feature reference documentation in [`docs/`](./docs). Every
page here documents **what the code does now**, **why it was built that way**,
**what it is explicitly not supposed to do**, and **the limitations found while
testing it**.

- **Current state** → this index and `docs/`.
- **Chronology** ("when and why did this change") →
  [`PROJECT_HISTORY.md`](./PROJECT_HISTORY.md).
- **Rules that must never be violated** → [`AGENTS.md`](./AGENTS.md).

---

## System map

```
                          Browser (Next 16 App Router, React 19)
                                        │
                              proxy.ts  │  iron-session gate on every request
                                        ▼
   ┌────────────────────────────── app/api/* ──────────────────────────────┐
   │                                                                        │
   │  Sheets side (system of record)          Mongo side (read-mostly)      │
   │  ────────────────────────────            ───────────────────────       │
   │  /api/bdd/*        → BDD tab             /api/ds/history   → ds, bc    │
   │  /api/parking/*    → PARKING             /api/parc         → parc      │
   │  /api/atelier/*    → ATELIER             /api/cp           → cp        │
   │  /api/depot/*      → DEPOT               /api/article      → ds, bc    │
   │  /api/rdv/*        → RDV + monthly       /api/config/options           │
   │  /api/sheet        → RL / import           → sheetFieldOptions         │
   │                                          lib/rateLimit    → rateLimits │
   │  Report generators          External providers                         │
   │  ─────────────────          ──────────────────                         │
   │  /api/bdd/export        → PDF        /api/generate-email      → Gemini │
   │  /api/bdd/export-excel  → XLSX       /api/bdd/reformulate-... → Gemini │
   │  /api/export            → PDF/DOCX   /api/trigger-import  → ~/import   │
   │                                      /api/import-status   → ~/import   │
   └────────────────────────────────────────────────────────────────────────┘
```

Two data stores, one boundary: **Google Sheets is the system of record** for
everything a human edits; **MongoDB holds large read-mostly reference
collections** (`ds`, `bc`, `parc`, `cp`) written by a *separate* repo (`~/import`)
and only ever read here — plus two small app-owned collections
(`sheetFieldOptions`, rate-limit counters).

---

## Feature documentation

### Pages

| Doc | Covers | Depth |
|---|---|---|
| [`docs/suivi-rl.md`](./docs/suivi-rl.md) | Suivi RL — 4 filter axes, cascade, "Non renseigné", inline edit, card surface | full |
| [`docs/fleet-pages.md`](./docs/fleet-pages.md) | Parking · Atelier · Depot · RDV | summary |
| [`docs/ds-history.md`](./docs/ds-history.md) | DS History + `/api/export` (PDF/DOCX) | summary |
| [`docs/articles.md`](./docs/articles.md) | Articles + `/api/article` | summary |

### Features

| Doc | Covers | Depth |
|---|---|---|
| [`docs/bdd-exports.md`](./docs/bdd-exports.md) | `/api/bdd/export` (PDF) + `/api/bdd/export-excel` | full |
| [`docs/ai-gemini.md`](./docs/ai-gemini.md) | `/api/generate-email` + `/api/bdd/reformulate-comment` | full |
| [`docs/config-options.md`](./docs/config-options.md) | Mongo-backed dropdown options + `/admin/config` | full |
| [`docs/fleet-data-import.md`](./docs/fleet-data-import.md) | `~/import` proxy + `field_registry.json` contract | full |

### Shared concerns

| Doc | Covers | Depth |
|---|---|---|
| [`docs/sheets-data-layer.md`](./docs/sheets-data-layer.md) | Shared Sheets client, tab map, write safety, caching | summary |
| [`docs/cross-cutting.md`](./docs/cross-cutting.md) | Query/caching, toasts, row order, refresh, auth, theming, testing | summary |

> **"summary" means** the area is already covered in depth by
> `PROJECT_HISTORY.md`, `CLAUDE.md`, `SECURITY_VERIFICATION.md`, or
> `DESIGN_SYSTEM.md`; the page maps it and links out rather than restating it.
> **"full"** means this is the only place the reasoning is written down.

---

## Root-level documents

| File | Role |
|---|---|
| [`AGENTS.md`](./AGENTS.md) | **The 5 inviolable rules**, for any AI assistant. Never fork or restate. |
| [`CLAUDE.md`](./CLAUDE.md) | Claude Code entry point — stack, env vars, theming, feature table |
| [`GEMINI.md`](./GEMINI.md) | Gemini CLI / Antigravity entry point (read-only sessions) |
| [`PROJECT_HISTORY.md`](./PROJECT_HISTORY.md) | Commit-by-commit chronology and reasoning |
| [`SECURITY_VERIFICATION.md`](./SECURITY_VERIFICATION.md) | File/line-cited security verification |
| [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) | Colour, typography, radius, error-banner conventions |
| [`TESTING.md`](./TESTING.md) | What the two suites cover, and what they deliberately don't |

---

## Decisions that look like bugs but are not

Collected here because each has been "fixed" or nearly-fixed by someone reading
the code without the context.

| Looks wrong | Actually deliberate | Where |
|---|---|---|
| Page named "Suivi RL" reads the **BDD** tab | No RL tab exists; "RL" is a business label | [suivi-rl](./docs/suivi-rl.md#1-what-this-page-is) |
| Flotte's "TOUS" doesn't mean all `ETAT` values | Scoped to INTERNE+EXTERNE so DISPONIBLE/ANNULE don't flood the default view | [suivi-rl](./docs/suivi-rl.md#22-empty-selection--tous-with-one-exception) |
| Filter chips and row editors read **different** option sources | Chips must not offer empty filters; editors must be able to introduce new values | [suivi-rl](./docs/suivi-rl.md#5-data-derived-vs-hardcoded-chip-options) |
| Plate search ignores the active chip filters | Chips browse; search finds a known plate | [suivi-rl](./docs/suivi-rl.md#7-search-bypasses-the-chip-cascade) |
| `*_FALLBACK` constants look like dead code | Three live uses: server degradation, client degradation, seed data | [config-options](./docs/config-options.md#2-the-_fallback-constants-are-not-dead-code) |
| The two export routes duplicate each other | They validate independently, by design — kept in sync by hand | [bdd-exports](./docs/bdd-exports.md) |
| RDV writes use `RAW`, everything else `USER_ENTERED` | `USER_ENTERED` strips leading zeros from phone numbers | [sheets-data-layer](./docs/sheets-data-layer.md#33-raw-vs-user_entered) |
| RDV writes the same row **twice** | Monthly tab is the source; the flat tab is a mirror destroyed on GAS rebuild | [sheets-data-layer](./docs/sheets-data-layer.md#34-rdv-dual-write-ordering) |
| `TECHNICEIN`, `FOUNISSEUR`, `Technicein_ds` misspelled | They match the real header cells (sic) | [sheets-data-layer](./docs/sheets-data-layer.md#2-tabs) |
| Article search is a collection scan | Non-prefix regex can't use a B-tree index; accepted, rate-limit compensates | [articles](./docs/articles.md#2-search-behaviour) |
| Rate limiting fails **open** | An outage should remove the ceiling, not the app | [cross-cutting](./docs/cross-cutting.md#7-auth-session-rate-limiting) |
| The import token travels as a query param | `~/import` has no header-auth path; cross-repo fix, audit M7 | [fleet-data-import](./docs/fleet-data-import.md#23-the-token-tradeoff--accepted-not-overlooked) |
| Single hardcoded auth email, no User model | Deliberate design decision, not a gap | [AGENTS.md](./AGENTS.md) rule 5 |

---

## Defects found during this documentation pass

Found by reading current code against its own comments and types.

### Fixed

The behavioural bug in `ef630e0`; the six stale comments in `443626c`.

| Where | Issue |
|---|---|
| [`app/api/import-status/route.ts`](./app/api/import-status/route.ts) | **Bug.** `skipped_absent` / `skipped_unchanged` run statuses coerced to `"failed"` — the *step*-status set was validating a *run* status. The fix `9fe833d` applied to `/api/trigger-import` had never been applied here. Now validated against `KNOWN_RUN_STATUSES` via `normalizeRunStatus()`, with a parameterised regression test over all five real statuses (verified to fail against the old implementation). → [detail](./docs/fleet-data-import.md#31-run-status-validation--and-the-bug-that-was-here) |
| [`app/api/bdd/export/route.ts`](./app/api/bdd/export/route.ts) | Stale rationale — excluded columns "since none of those axes support selecting multiple values"; all four axes are multi-select since `c0d5965`. Now states the real current constraint (portrait A4 page width). |
| [`app/suivi-rl/page.tsx`](./app/suivi-rl/page.tsx) | Stale — claimed the PDF export omits Emplacement. It includes it (`e3bc354`). |
| [`app/api/bdd/export-excel/route.ts`](./app/api/bdd/export-excel/route.ts) | Stale — "Unlike the PDF export's `BddExportRow`…". Both row types are identical; corrected, with the reason they stay separately declared. |
| [`app/api/bdd/export/route.ts`](./app/api/bdd/export/route.ts) | Stale — "only 4 (narrower) columns now". There are 5. |
| [`CLAUDE.md`](./CLAUDE.md) §6 | Stale — "6-field editable allowlist" (it's 7); "Plate/WW search" (it's plate-only); listed 3 chip axes (there are 4). |
| [`lib/types.ts`](./lib/types.ts) | Stale — "27 real columns". `BDD_HEADERS` has 28. |

### Open

Full analysis, with confidence levels and verification method, in
**[`docs/cleanup-candidates.md`](./docs/cleanup-candidates.md)** — a proposal
only; nothing there has been removed. Headlines:

| Where | Issue |
|---|---|
| `app/api/import-status` + `app/api/trigger-import` | **Highest value.** Both re-implement the `~/import` contract — `normalizeTimestamp()` is `md5`-identical, and the step normaliser is a named function in one route and *inlined* in the other, so name-based search can't find the second copy. This is *how* the run-status bug above outlived its own fix. |
| `lib/types.ts:708` / `:727` | The two import status vocabularies are hand-written unions with **no runtime counterpart** — the reason a validator had to hand-write a `Set` and reached for the wrong one. Four other types in the same file already use the `as const` → `(typeof X)[number]` pattern that prevents this. |
| `app/api/bdd/export{,-excel}/route.ts` | Same class, latent: `MAX_*` caps duplicated and the row validators byte-identical. |
| `app/api/query/search/route.ts` | No caller found; superseded by client-side filtering (`26e53fb`). |
| `app/api/generate-email/route.ts` | No UI caller. Deliberately headless, but unreferenced. |
| `scripts/add-indexes.ts` | Self-declared deprecated, but the deprecation is a comment rather than a runtime guard. |
| `DESIGN_SYSTEM.md` | Still framed as a proposal ("Sequencing — once approved") for work that shipped across seven commits. |

Every 🟢 candidate has been actioned: `ETAT_ANNULE`/`ETAT_ANNULEE` removed, the
`type Fleet` and `etatBadgeClass()` comments corrected, and `TESTING.md`
completed (it was missing seven test files, three of them security-model
coverage — not the two originally reported).

---

## Keeping this accurate

1. **Cite file paths and line numbers**, so drift is findable by grep.
2. **Record the *why*, not just the *what*** — the what is readable from the
   code; the why is what gets lost.
3. **When behaviour changes, update the doc in the same commit.** Every stale
   entry above exists because a follow-up commit changed behaviour and left the
   surrounding prose alone.
4. **Never restate an `AGENTS.md` rule here** — link to it.
5. **Flag contradictions rather than trusting a comment.** A comment describing
   behaviour is evidence, not proof; verify against current code.
