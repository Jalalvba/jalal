# Fleet Data Import — the `~/import` proxy

**Primary files:**
[`src/app/api/trigger-import/route.ts`](../src/app/api/trigger-import/route.ts) ·
[`src/app/api/import-status/route.ts`](../src/app/api/import-status/route.ts) ·
[`src/components/fleet/ImportTrigger.tsx`](../src/components/fleet/ImportTrigger.tsx)
(rendered from [`src/app/page.tsx`](../src/app/page.tsx)) ·
[`src/types/index.ts:690-756`](../src/types/index.ts#L690)

Tests: `src/app/api/trigger-import/__tests__/route.test.ts`,
`src/app/api/import-status/__tests__/route.test.ts`.

Added `e6e44a4`; status-string bug fixed `9fe833d`.

---

## 1. The boundary

> **This repo contains no Drive code, no ETL code, and no import logic.** It
> contains two thin proxy routes and a button.

The actual DS/CP/PARC/BC Drive→Mongo pipeline lives in a **separate Vercel
project**, `~/import`, deployed at `https://import-red.vercel.app`. Pipeline
internals — skip-if-unchanged logic, `?force=true`, the `pipeline_runs` schema —
are documented in **that project's own `CLAUDE.md`**, deliberately not
duplicated here.

```
Browser  ──►  this repo                        ──►  ~/import (separate project)
              POST /api/trigger-import          GET  /api?token=…      (blocks 60–90 s)
                └─ then, per run_id ───────────► GET  /api/status?run_id=…
              GET  /api/import-status ─────────► GET  /api/status?run_id=…
```

Both repos read the **same** Mongo collections (`ds`, `bc`, `parc`, `cp`);
`~/import` writes them, this app only reads them.

---

## 2. `POST /api/trigger-import`

`runtime = "nodejs"`, **`maxDuration = 180`**.

**Why 180 s:** the upstream `GET /api` blocks synchronously until all four
pipelines finish — confirmed live at typically **60–90 s** against real
Drive/Mongo Atlas traffic. `~/import`'s own `vercel.json` sets 180 for headroom;
this route mirrors it, plus margin for the `/api/status` follow-ups.

**Rate limit: 3 requests / 15 minutes** (bucket `trigger-import`) — far tighter
than anything else in the app. Each trigger is a real, expensive Drive+Mongo
run. The limit guards against double-submits and accidental repeat clicks, not
against legitimate reuse.

### 2.1 The two-call pattern, and why it exists

The trigger response's `steps` are compact `"step:status"` strings — **no
timestamp, no detail text**. Full step detail exists only in each run's status
document.

So once the trigger resolves — at which point **every pipeline has already
finished** — the route fetches `/api/status?run_id=…` for each run *in parallel*
(`Promise.all`) to backfill real timestamps and detail before handing the
combined result to the browser.

**If a status fetch fails**, that pipeline degrades to
`stepsFromCompactSummary()` and carries an explicit `stepDetailWarning`:

```
Full step detail unavailable ({reason}) — showing compact summary only, no real timestamps.
```

> **Degraded data must never look identical to the real thing.** The warning is
> surfaced in the UI rather than left implicit.

### 2.2 Timestamp normalisation

`~/import` serialises datetimes via Python's `json.dumps(..., default=str)`,
i.e. `str(datetime)` → `"2026-08-03 20:14:23.680208+00:00"` — space-separated,
microsecond precision. **Not reliably parseable by every JS `Date`
implementation.**

`normalizeTimestamp()` regex-parses it and emits real ISO 8601, truncating
microseconds to milliseconds and defaulting a missing offset to `Z`. Anything
unparseable returns `null` rather than an Invalid Date. The parsing risk is
absorbed server-side rather than pushed to the browser.

### 2.3 The token tradeoff — accepted, not overlooked

```ts
fetch(`${IMPORT_API_BASE}/api?token=${encodeURIComponent(token)}`, { cache: "no-store" })
```

The token travels as a **query param**, so it lands in `~/import`'s access logs.
A header would avoid that — but `~/import`'s `api/index.py` reads the token via
`query.get("token")` **only**; there is no header-auth path on the receiving
side (confirmed by reading that project's source, not assumed).

Fixing it properly requires coordinated changes across two Vercel
projects/deployments, and per [`AGENTS.md`](../AGENTS.md) `~/import` is a
separate repo this repo's sessions don't touch unasked. Recorded as audit item
**M7** (`db9fa96`).

> **If `~/import` ever gains header auth, switch this to an `Authorization`
> header at the same time.**

`IMPORT_PIPELINE_TOKEN` (this repo) must byte-match `PIPELINE_TRIGGER_SECRET`
(`~/import`). Set it on **this** project: `vercel env add IMPORT_PIPELINE_TOKEN`.

### 2.4 Error mapping

| Condition | Status | Message |
|---|---|---|
| `IMPORT_PIPELINE_TOKEN` unset | 500 | `…is not configured on this deployment.` |
| Network error reaching `~/import` | 502 | `Could not reach the import pipeline service (network error).` |
| Upstream **401** | 502 | `…rejected the trigger token (401) — check that IMPORT_PIPELINE_TOKEN matches ~/import's PIPELINE_TRIGGER_SECRET.` |
| Non-JSON / no `results` array | 502 | `…returned an unexpected response (HTTP {n}).` |

The 401 message names both env vars explicitly — a token mismatch across two
projects is otherwise near-impossible to diagnose from a bare 401.

### 2.5 Cache invalidation on success

```ts
if (results.some((r) => r.pipeline === "parc" && r.status === "success")) invalidateIMMListCache();
if (results.some((r) => (r.pipeline === "parc" || r.pipeline === "cp") && r.status === "success")) invalidateVehicleSuggestionListCache();
```

- `getIMMList()`'s cache has a **one-week TTL** (`143041a`) — a real `parc`
  change refreshes it immediately rather than waiting that out.
- The combined plate-suggestion list draws from **both** `parc` and `cp`, so
  either changing invalidates it.

**Only `"success"` counts.** `skipped_unchanged` / `skipped_absent` mean the data
didn't actually change; `failed` means it may not be trustworthy. Invalidating
on those would throw away a warm week-long cache for nothing.

---

## 3. `GET /api/import-status`

Read-only lookup of a **past** run's step history — for re-viewing a prior run,
**not** for polling during a trigger (the trigger route already backfills detail
once it resolves).

Rate limit: 30 / min. **No token required** — `~/import`'s `api/status.py` is
itself unauthenticated because `run_id` is an unguessable UUID4. This route just
forwards the query param.

Missing `run_id` → 400. Upstream 404 → 404; anything else → 502.

### 3.1 Run-status validation — and the bug that was here

Run statuses go through `normalizeRunStatus()`
([`route.ts:52-56`](../src/app/api/import-status/route.ts#L52)), which validates
against **`KNOWN_RUN_STATUSES`**
([`route.ts:41-50`](../src/app/api/import-status/route.ts#L41)) — the run-level
vocabulary — and coerces anything unrecognised to `"failed"`.

> **The bug this replaced.** The route previously validated a **run** status
> against `KNOWN_STEP_STATUSES`, the **step**-level set (`src/types/index.ts:708` vs
> `:727` — two different vocabularies). Since neither `skipped_absent` nor
> `skipped_unchanged` is a step status, **both silently became `"failed"`**,
> reporting a legitimately skipped run as a failed one.
>
> This was the exact bug `9fe833d` fixed in `/api/trigger-import`; the fix had
> never been applied here. It survived because
> `src/app/api/import-status/__tests__/route.test.ts` only exercised
> `status: "success"`.
>
> Impact was limited — `/api/import-status` is a re-lookup path, and the trigger
> flow the UI actually uses was unaffected — but a user re-viewing a skipped
> past run saw it as failed.

Current behaviour, covered by a parameterised regression test over all five real
statuses plus an unrecognised one:

| `doc.status` from `~/import` | Result |
|---|---|
| `success` · `failed` · `running` | passed through |
| `skipped_absent` · `skipped_unchanged` | **passed through** |
| anything else (incl. a bare `"skipped"`) | `failed` |

A bare `"skipped"` is deliberately *not* accepted: `src/types/index.ts:718-727`
records that it is never a real run status —

> *"Confirmed against `~/import/run.py`'s `run_all()` … never a bare 'skipped' —
> 'skipped_absent' … and 'skipped_unchanged' … are distinct outcomes callers
> should tell apart."*

`KNOWN_STEP_STATUSES` still exists in the same file and is still correct — it
validates the per-**step** statuses a few lines below. The two sets are
deliberately separate; collapsing them recreates the bug.

---

## 4. Status vocabularies — keep these apart

Two distinct enums in [`src/types/index.ts`](../src/types/index.ts), easy to conflate (and
already conflated once, see §3.1):

**`ImportPipelineStepStatus`** (per step, `:696`):
`started` · `success` · `failed` · `skipped`

**`ImportPipelineRunStatus`** (per pipeline run, `:715`):
`success` · `failed` · `skipped_absent` · `skipped_unchanged` · `running`

- `skipped_absent` — the file wasn't in the Drive folder at all.
- `skipped_unchanged` — present, but unchanged since the last successful run.
- `running` — exists **only** for `/api/status`'s in-progress poll
  (`PipelineLogger.status` starts `"running"` until `finish()`); the trigger
  route can never return it.

Both were confirmed by reading `~/import/run.py`'s `run_all()` and
`src/lib/pipeline_log.py`'s `PipelineLogger.to_document()` **directly** — not
inferred from HTTP docs.

`ImportTrigger.tsx:116` carries the same "two distinct skip reasons" note, so
the UI distinguishes them too.

---

## 5. UI — `ImportTrigger.tsx`

A button on the home page (`src/app/page.tsx`) driving a terminal-style replay.

- Phase machine: `idle` → running → done, with an elapsed-seconds counter (the
  run genuinely takes 60–90 s, so a spinner alone is not enough feedback).
- `visibleCount` / `runningTick` drive a staggered reveal of step lines.
- `lastRun` starts as the sentinel `"loading"` (distinct from `null` = "no
  previous run").
- Per-pipeline results render with their real status, including the two distinct
  skip reasons and any `stepDetailWarning`.

---

## 6. Related: `field_registry.json`

Not part of the import proxy, but the same cross-repo boundary.

[`field_registry.json`](../field_registry.json) is a **copy** of a live-scan
snapshot of every real field name in `ds`/`bc`/`cp`/`parc`, generated by
`~/import`'s `scripts/export_field_registry.py`. **Ground truth — not what
either repo's code assumes.**

`pnpm verify-field-names` ([`scripts/verify-field-names.cjs`](../scripts/verify-field-names.cjs),
wired into [CI](../.github/workflows/ci.yml)) scans every `src/app/api/**` file's
`"$fieldname"`-style Mongo references and **fails the build** if any doesn't
byte-match an entry for the collection(s) that file touches.

Temporary exceptions use a same-file marker:

```ts
// verify-field-names:allow <fieldname> -- <reason>
```

**Re-copy the registry** (`cp ~/import/field_registry.json ./field_registry.json`,
after re-running that export script) whenever a real Mongo field changes: a
backfill runs, `~/import`'s `FIELD_MAPS` changes, or a manual migration touches
those collections.

> **Skipping this does not fail loudly** — CI just keeps validating against a
> stale snapshot. Last resync: `6a4ecf0`.

---

## 7. Known limitations

1. **`IMPORT_API_BASE` is hardcoded** in both routes
   (`https://import-red.vercel.app`), not an env var. Pointing at a staging
   `~/import` requires a code change.
2. **The trigger blocks for 60–90 s.** No job queue, no polling handoff. A
   browser tab closed mid-run loses the result view — though the run itself
   completes and stays retrievable by `run_id`.
3. **`run_id`s are not persisted by this app.** Only the current session's
   results are held in component state; `/api/import-status` needs a `run_id`
   the user must already have.
4. **`stepDetailWarning` is only produced by the trigger route.**
   `/api/import-status` has no equivalent degraded-detail signal.
5. **The token query-param exposure** — §2.3, accepted.
6. **Both routes still duplicate `normalizeTimestamp()` and
   `KNOWN_STEP_STATUSES`** verbatim. That duplication is *how* §3.1's bug
   outlived its own fix — the fix landed in one copy only. Extracting them into
   a shared module is a Phase 2 candidate.
