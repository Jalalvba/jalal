# Cleanup candidates — Phase 2 report

**Working document, 2026-08-16, against `b2fcb80`.** A proposal only — nothing
in this report has been deleted, renamed, or modified. Each item states what it
is, why it is a candidate, and a confidence level:

- 🟢 **Safe to remove** — machine-verified zero references, no behavioural risk.
- 🟡 **Needs your judgment** — genuinely unused, but plausibly deliberate. The
  call is about intent, not facts.
- 🔵 **Refactor, not deletion** — nothing to delete; the candidate is a
  structural change that closes a defect class.

## Method

Every claim below comes from a scripted scan over `git ls-files`, not from
reading and guessing:

| Check | How | Result |
|---|---|---|
| Unused exports | 269 exported symbols; word-boundary reference count across all `.ts`/`.tsx`/`.cjs`/`.mts`, discounting each symbol's own declaration | 3 candidates |
| Orphaned API routes | 46 routes; quoted/templated URL search across non-route source, tests counted separately | 3 candidates |
| Unused dependencies | 33 deps vs `import`/`require`/`@import`/`@plugin` across 168 tracked files **including configs and scripts** | 0 candidates |
| Temp/scratch files | `git ls-files` + `find` + `git log --diff-filter=A` over all history | 0 found |
| `TODO`/`FIXME`/`XXX`/`HACK` | full source grep | 0 found |
| Commented-out code | comment lines matching code syntax (`// const`, `// return`, `// if (`, …) | 0 found |
| Duplicated logic | per-function `md5sum` across sibling routes | §1 |

---

# 1. 🔵 The `~/import` contract is re-implemented in two places

**This is the priority item, and it is not a tidiness complaint.** This exact
duplication is what allowed the run-status bug (fixed in `ef630e0`) to survive
its own fix for four months. The recommendation below is aimed at making that
recurrence structurally impossible, not just at deleting repeated lines.

**Files:** [`app/api/trigger-import/route.ts`](../app/api/trigger-import/route.ts)
(231 lines) · [`app/api/import-status/route.ts`](../app/api/import-status/route.ts)
(121 lines)

## 1.1 The evidence

Both routes independently consume the same upstream contract — `~/import`'s
`GET /api/status` response — and each re-declares the whole thing:

| Duplicated | trigger-import | import-status | Verified |
|---|---|---|---|
| `IMPORT_API_BASE` | `:22` | `:19` | identical |
| `RawStep` | `:40` | `:21` | identical |
| `RawStatusDoc` | `:42` | `:22` | identical **except** import-status adds `error?: string` |
| `normalizeTimestamp()` | `:55-62` | `:58-65` | **`md5sum` identical** — `10ca5d01c85f7b77f0109e75c6814749` both |
| `KNOWN_STEP_STATUSES` | `:64` | `:31` | identical |
| step normalisation | `normalizeStep()`, `:66-74` | **inlined**, `:107-113` | same semantics, different shape |

That last row is the important one.

## 1.2 Why grep did not catch it

The step-normalisation logic exists as a **named function** in one route and is
**inlined into a `.map()`** in the other:

```ts
// trigger-import/route.ts — named
function normalizeStep(raw: RawStep): ImportPipelineStep {
  const status = KNOWN_STEP_STATUSES.has(raw.status ?? "") ? (raw.status as …) : "failed";
  return { step: raw.step ?? "unknown", status, detail: raw.detail ?? "", timestamp: normalizeTimestamp(raw.timestamp) };
}

// import-status/route.ts — inlined, identical behaviour
doc.steps.map((s) => ({
  step: s.step ?? "unknown",
  status: (KNOWN_STEP_STATUSES.has(s.status ?? "") ? s.status : "failed") as …,
  detail: s.detail ?? "",
  timestamp: normalizeTimestamp(s.timestamp),
}))
```

> **A developer fixing `normalizeStep` greps for `normalizeStep`, finds one
> definition and one call site, and concludes there is one copy.** The second
> copy is invisible to name-based search because it has no name. That is
> precisely what happened with `9fe833d`.

## 1.3 The actual root cause — a missing runtime vocabulary

Deduplication alone would **not** have prevented the bug. The bug was a
*category error*: a **run** status validated against the **step** status set.
Both routes would have imported the same wrong set.

The real cause is that `lib/types.ts` declares both vocabularies as
hand-written type unions with **no runtime counterpart**:

```ts
export type ImportPipelineStepStatus = "started" | "success" | "failed" | "skipped";                        // :697
export type ImportPipelineRunStatus  = "success" | "failed" | "skipped_absent" | "skipped_unchanged" | "running";  // :716
```

A TypeScript union cannot be enumerated at runtime. So when a route needed to
*validate* a status, there was nothing to import — and the author hand-wrote a
`Set`. Only one such `Set` was ever named (`KNOWN_STEP_STATUSES`), so it became
the thing both levels reached for. **The run-level `Set` did not exist anywhere
in the repo until `ef630e0` created it.**

## 1.4 The fix: apply the pattern this repo already uses

This codebase has an established idiom for exactly this — declare the runtime
array `as const`, derive the type from it, and the two can never drift:

```ts
export const PALETTE_COLORS = [...] as const;
export type PaletteColor = (typeof PALETTE_COLORS)[number];          // lib/types.ts:228
export type OptionKey = (typeof OPTION_KEYS)[number];                // :281
export type AtelierEditableField = (typeof ATELIER_EDITABLE_FIELDS)[number];  // :519
export type RdvEditableField = (typeof RDV_EDITABLE_FIELDS)[number];          // :578
```

**Four uses of the pattern — and the two import-status vocabularies are the
anomaly that skipped it.** Bringing them in line is not a new convention; it is
applying the house rule to the two places that missed it.

### Step 1 — invert the declarations in `lib/types.ts`

```ts
export const IMPORT_STEP_STATUSES = ["started", "success", "failed", "skipped"] as const;
export type ImportPipelineStepStatus = (typeof IMPORT_STEP_STATUSES)[number];

export const IMPORT_RUN_STATUSES = [
  "success", "failed", "skipped_absent", "skipped_unchanged", "running",
] as const;
export type ImportPipelineRunStatus = (typeof IMPORT_RUN_STATUSES)[number];
```

Both types keep their exact current members, so **no consumer changes**. What
changes is that a runtime list now exists at *both* levels — so a validator can
import the right one instead of hand-writing an approximation, and adding a
member to either type automatically updates its `Set`.

### Step 2 — one module for the upstream contract

`lib/importPipeline.ts`, exporting `IMPORT_API_BASE`, `RawStep`,
`RawStatusDoc`, `normalizeTimestamp()`, `normalizeStep()`, and
`normalizeRunStatus()` — each built from the arrays above:

```ts
const RUN = new Set<string>(IMPORT_RUN_STATUSES);
const STEP = new Set<string>(IMPORT_STEP_STATUSES);

export const normalizeRunStatus  = (r: unknown): ImportPipelineRunStatus  =>
  typeof r === "string" && RUN.has(r)  ? (r as ImportPipelineRunStatus)  : "failed";
export const normalizeStepStatus = (r: unknown): ImportPipelineStepStatus =>
  typeof r === "string" && STEP.has(r) ? (r as ImportPipelineStepStatus) : "failed";
```

Then **delete the inlined copy** in `import-status` and call `normalizeStep()`.
Keep `RawStatusDoc`'s `error?: string` — widen the shared type to include it.

### Step 3 — the guard that makes recurrence impossible

Two names differing by one word (`normalizeRunStatus` vs `normalizeStepStatus`)
are still confusable. Make the confusion fail loudly:

```ts
// lib/__tests__/importPipeline.test.ts
it("run and step vocabularies stay distinct", () => {
  expect(IMPORT_RUN_STATUSES).toContain("skipped_unchanged");
  expect(IMPORT_STEP_STATUSES).not.toContain("skipped_unchanged");
  // a bare "skipped" is a STEP status only — never a run status
  expect(IMPORT_STEP_STATUSES).toContain("skipped");
  expect(IMPORT_RUN_STATUSES).not.toContain("skipped");
});

it.each(IMPORT_RUN_STATUSES)("normalizeRunStatus passes %s through", (s) =>
  expect(normalizeRunStatus(s)).toBe(s));
it.each(IMPORT_STEP_STATUSES)("normalizeStepStatus passes %s through", (s) =>
  expect(normalizeStepStatus(s)).toBe(s));
```

Driving the cases *from the arrays* means adding a status to either vocabulary
automatically extends its test. A future status can never be silently
unhandled — which is the failure mode that produced the original bug.

**Net effect:** ~20 duplicated lines removed, and — more importantly — the
question *"which status set applies here?"* becomes answerable by import name
rather than by memory.

## 1.5 The same class exists in two other places

Fixing only the import routes leaves the pattern alive. Both of these are
**latent**, not currently broken:

### (a) The two BDD export routes — `MAX_*` caps and the row validator

Verified identical:

| Constant | `export/route.ts` | `export-excel/route.ts` |
|---|---|---|
| `RATE_LIMIT` / `RATE_WINDOW_MS` | 20 / 5 min | 20 / 5 min |
| `MAX_ROWS` | 2000 | 2000 |
| `MAX_FIELD_LENGTH` | 500 | 500 |
| `MAX_COMMENTAIRE_LENGTH` | 2000 | 2000 |

`isValidRow()` and `isValidExcelRow()` are **byte-identical modulo the type and
function name** (verified by `diff` after normalising both). Both files
acknowledge the hand-sync in their own comments.

**Risk if left:** tightening `MAX_COMMENTAIRE_LENGTH` in one route silently
leaves the other accepting oversized payloads — the same shape of divergence as
the run-status bug, in the one code path whose entire job is rejecting bad
input.

**Suggested shape:** a shared `BDD_EXPORT_LIMITS` + `isValidExportRow()`. Keep
the two routes' *separate rate-limit buckets* — those are deliberately distinct
(see [`bdd-exports.md` §1](./bdd-exports.md#1-contract)) and must not be merged.

### (b) `getTimeBasedTheme()` vs the inline no-flash script

[`lib/themeDefault.ts:11`](../lib/themeDefault.ts#L11) implements the
light/dark cutoff in TypeScript. `app/layout.tsx` imports only
`LIGHT_START_HOUR` / `LIGHT_END_HOUR` and **re-implements the comparison inside
a template-literal script string**. The function itself has zero callers
(see §2.3).

Same class, worse variant: the duplicate lives across a TS-to-string boundary,
so the type checker cannot see it and no test can reach the real consumer. The
one that ships is the untested one.

---

# 2. Orphaned code

## 2.1 🟡 `app/api/query/search/route.ts` — no caller

**Verified:** the only two references in the entire repo are the route's own
first-line path comment, and a comment in
[`app/ds-history/page.tsx:822`](../app/ds-history/page.tsx#L822) that describes
it in the past tense:

> `// already-fetched list (unlike the old /api/query/search server route`

Superseded by `26e53fb`, which moved plate search to a single shared
client-side list over `parc` + `cp`. No test, no fetch, no link.

**Why judgment, not 🟢:** it is a reachable authenticated endpoint. Confirm
nothing external (a bookmark, a script, another tool) calls it before deleting.
Within this repo, nothing does.

## 2.2 🟡 `app/api/generate-email/route.ts` — no UI caller

**Verified:** zero references outside the route file. Its types
(`GenerateEmailRequest` / `GenerateEmailResponse`, `lib/types.ts:747-754`) are
used only by it.

**Do not treat this as dead code by default.** `cb13749` describes it as *"a
second, parallel LLM provider alongside this app, not a replacement for anything
existing"*, and `6629251` deliberately hardened it to the app's
cost/security/reliability rules. It reads as intentional groundwork.

**Options:** (a) keep and add a one-line note that it is intentionally headless;
(b) keep and build the UI; (c) delete route + its two types together. Your call
— this one is about product intent, which the code cannot tell me.

## 2.3 🟡 `getTimeBasedTheme()` — no callers

[`lib/themeDefault.ts:11`](../lib/themeDefault.ts#L11). Zero references
repo-wide. `app/layout.tsx` imports only the two hour constants.

**Complication:** [`CLAUDE.md` §3](../CLAUDE.md) names this function as the
mechanism —

> *"default is light 7am–7pm, dark otherwise (local time, via
> `lib/themeDefault.ts`'s `getTimeBasedTheme()`…)"*

— so deleting it **falsifies CLAUDE.md**, and the file's own docstring already
says the inline script is "the actual runtime consumer".

**Recommended instead of deletion:** keep it, and add a unit test asserting it
agrees with the inline script's boundaries (06:59 → dark, 07:00 → light,
18:59 → light, 19:00 → dark). That turns an unused duplicate into an executable
specification of the shipped behaviour. See §1.5(b).

## 2.4 🟢 `ETAT_ANNULE` / `ETAT_ANNULEE` — no references

[`lib/types.ts:354-355`](../lib/types.ts#L354). Zero references anywhere,
including `etatBadgeClass()` a few lines above, which branches only on
`DISPONIBLE` / `INTERNE` / `EXTERNE` and lets everything else fall through to
the muted default.

Their own comment claims they exist because `suivi-rl` and `ds-history`
*"compare against [them] directly"* — neither does, any more.

**Caveat before removing:** they document that `ANNULE`/`ANNULEE` are real
`ETAT_OPTIONS_FALLBACK` values deliberately rendered muted rather than
overlooked. If you delete them, keep that fact as a comment on
`etatBadgeClass()`'s fallback branch. `ETAT_INTERNE`, `ETAT_EXTERNE`, and
`ETAT_DISPONIBLE` are all in live use — **do not** remove those.

## 2.5 🟡 `/api/import-status` — live route, no client caller

**Verified:** no `fetch` anywhere; only its own file and the
`ImportStatusResponse` type reference it. `ImportTrigger.tsx` calls
`/api/trigger-import` only.

It is correct, now tested (`ef630e0`), and documented as an intentional
re-lookup path — but no UI reaches it. **Keep** unless you have decided that
re-viewing a past run by `run_id` is not a feature you want; in that case it,
its test, and `ImportStatusResponse` go together.

---

# 3. Files and dependencies

## 3.1 ✅ No temp/scratch files — confirmed clean

You asked specifically about leftover `e2e/_tmp-*.spec.ts`. **None exist, and
none were ever committed.**

`git log --all --diff-filter=A --name-only -- 'e2e/*'` shows only six files ever
added to `e2e/`: `admin-config.spec.ts`, `atelier.spec.ts`, `logout.spec.ts`,
`suivi-rl.spec.ts`, `fixtures.ts`, `helpers/auth.ts` — all current and all real.
No `.bak`, `.orig`, `-copy`, or `tmp-` files on disk or in history.

`test-results/` and `playwright-report/` are gitignored; `.env*` (except
`.env.example`) and `secret.json` are gitignored and untracked — verified.

## 3.2 ✅ No unused dependencies — do not "clean" these four

All 33 deps are referenced. Four **look** unused to a naive import scan and are
not — flagged here so a future pass doesn't remove them:

| Dep | Why it has no `import` statement |
|---|---|
| `@types/node`, `@types/react`, `@types/react-dom` | Ambient type packages consumed by `tsc` via `node_modules/@types`. Never imported by design. |
| `typescript` | Used as a CLI by `pnpm exec tsc` and by Next's build. |
| `react-dom` | Required by React 19 / Next App Router at runtime; a peer of `next`, not a direct import in app code. |

Deps referenced from exactly one place, all legitimate: `exceljs`
(`export-excel`), `docx` (`/api/export`), `html-to-image` (`rdv`), `cmdk`
(`combobox`), `tailwindcss` (`globals.css` `@import`), `@tailwindcss/postcss`
(`postcss.config.mjs`).

## 3.3 🟡 `scripts/add-indexes.ts` — self-declared deprecated

Its own header says: *"DEPRECATED — retired, not maintained. Do not run this
against production anymore"* — its field-name literals predate the
dirty→clean Mongo key migration, and index ownership moved to `~/import`'s
`ensure_indexes()` (`8264de0`).

It is kept deliberately, *"only for historical reference (the before/after
timing methodology below may still be a useful pattern to copy elsewhere)"*.

**Candidate because** a deprecated script that must never be run is a live
footgun — the deprecation is a comment, not a guard. Options: delete it; or keep
it and add a runtime `process.exit(1)` refusing to run without an explicit
`--i-know-this-is-deprecated` flag. It also cites `AUDIT_REPORT.md §8.1`, a file
that was never committed and no longer exists.

`scripts/seed-sheet-field-options.ts` and `scripts/test-service-account.ts` are
**not** candidates — both are documented one-time/diagnostic tools with accurate
headers.

## 3.4 🟡 `DESIGN_SYSTEM.md` reads as a pending proposal that already shipped

Titled *"Design System — Audit & Proposal"*, with §2 "Proposal" and §3
"Sequencing (**once approved**)". Every numbered item in §2 was implemented —
`f7eeb33`, `873ad79`, `e321bad`, `eb5960c`, `0fb7fc6`, `9837433`, `f14af4e`.

Nothing in it is factually wrong; the **framing** is. A reader arriving at §3
reasonably concludes there is unstarted work.

**Not a deletion candidate** — `CLAUDE.md` §3 and `ARCHITECTURE.md` both cite it
as the canonical colour/typography/radius reference. Suggested: retitle to
"Design System" and mark §2/§3 as implemented, citing the commits.

## 3.5 ✅ No duplicate or superseded `.md` files

The Phase 1 docs were written to complement, not replace: `PROJECT_HISTORY.md`
is the chronology, `docs/` is the current-state reference, `AGENTS.md` holds the
rules both link to. No `.md` file is now redundant.

`PROJECT_HISTORY.md` §4's entry about the never-committed `AUDIT_REPORT.md` is
**deliberate** — it explains why early commit messages cite a file that isn't in
the repo. Keep it.

---

# 4. Stale comments

Six were corrected in `443626c`. Scanning found **one more of the same family**,
plus two minor imprecisions.

## 4.1 🟢 `app/suivi-rl/page.tsx:531-533` — falsified by `c0d5965`

```ts
// … Fleet is a plain string (not a literal union) because
// the chip row below renders every option.ETAT_OPTIONS value, not just the
// two that used to be hardcoded here.
type Fleet = string;
```

**The chip row no longer renders `options.ETAT_OPTIONS`.** Since `c0d5965` it
renders `visibleFleetValues` — derived from live row data
([`page.tsx:615-618`](../app/suivi-rl/page.tsx#L615)). The stated justification
is exactly backwards from the current source.

The conclusion (`Fleet` must stay a plain string) is still *correct*, just for a
different reason: the values now come from arbitrary live sheet data, which is
an even stronger argument against a literal union.

**Same family as the six already fixed** — accurate when written, falsified by a
later commit that changed behaviour without revisiting the prose.

## 4.2 🟡 `type Fleet = string` is a no-op alias

Same location. `Fleet` is exactly `string`, and `activeFleet: Fleet[]` is
exactly `string[]` — which is how the **other three axes** are declared. It buys
no type safety and makes one of four parallel axes look special.

Either drop it (use `string[]` like its three siblings) or keep it purely as
documentation — but then fix its comment per §4.1. Behaviour is identical
either way.

## 4.3 🟡 `etatBadgeClass()` docstring — "branches" that aren't

[`lib/types.ts:366-367`](../lib/types.ts#L366) refers to *"The
fallback/unknown-value **and** `ANNULE`/`ANNULEE` **branches**"*, implying
separate branches. There is one shared `return`; `ANNULE`/`ANNULEE` reach it by
falling through.

Behaviourally fine — they do render muted, as intended. Only the wording implies
structure that isn't there. Relevant to §2.4: if `ETAT_ANNULE`/`ETAT_ANNULEE`
are deleted, this is where the fact belongs.

## 4.4 🟢 `TESTING.md` — two test files missing

`lib/__tests__/adminConfigKeys.test.ts` and `lib/__tests__/etatBadgeClass.test.ts`
exist and pass but aren't listed. Repo has 26 test files / 146 passing tests.

---

# Summary

| § | Candidate | Confidence | Action |
|---|---|---|---|
| **1** | **`~/import` contract duplicated across two routes** | 🔵 | **Refactor — highest value; already caused one production-visible bug** |
| 1.5a | BDD export routes: `MAX_*` + validator duplicated | 🔵 | Refactor — same class, latent |
| 1.5b | `getTimeBasedTheme()` vs inline script | 🔵 | Refactor — same class, latent |
| 2.1 | `/api/query/search` — no caller | 🟡 | Delete after confirming no external consumer |
| 2.2 | `/api/generate-email` — no UI caller | 🟡 | Product decision |
| 2.3 | `getTimeBasedTheme()` — no callers | 🟡 | Prefer a test over deletion (see 1.5b) |
| 2.4 | `ETAT_ANNULE` / `ETAT_ANNULEE` | 🟢 | Safe — preserve the fact in a comment |
| 2.5 | `/api/import-status` — no client caller | 🟡 | Keep unless the feature is cancelled |
| 3.3 | `scripts/add-indexes.ts` deprecated | 🟡 | Delete, or add a runtime guard |
| 3.4 | `DESIGN_SYSTEM.md` framing | 🟡 | Retitle — don't delete |
| 4.1 | `page.tsx:531-533` stale comment | 🟢 | Safe |
| 4.2 | `type Fleet = string` no-op alias | 🟡 | Style call |
| 4.3 | `etatBadgeClass()` "branches" wording | 🟡 | Trivial |
| 4.4 | `TESTING.md` missing 2 test files | 🟢 | Safe |

**Clean, no action needed:** temp/scratch files (none ever committed) ·
dependencies (0 unused; 4 look-unused-but-required) · `TODO`/`FIXME` (none) ·
commented-out code (none) · duplicate `.md` files (none).

**If you only do one thing:** §1. It is the only item with a demonstrated
production consequence, and §1.4's inverted `as const` declarations plus the
§1.3 guard test are what stop it recurring — the deduplication is the smaller
half of the value.
