# DS History

> **Summary-level doc.** Full chronology in
> [`PROJECT_HISTORY.md`](../PROJECT_HISTORY.md) §2 ("DS History").

**Files:** [`src/app/ds-history/page.tsx`](../src/app/ds-history/page.tsx) (1211 lines —
the largest page in the app) · `/api/ds/history` · `/api/parc` · `/api/cp` ·
`/api/query` · `/api/sheet` · `/api/export` · `/api/vehicle-suggestions`

The vehicle dossier page: enter a plate, get its full service history, contract
data, and the sheet rows that mention it.

---

## 1. Composition

| Card | Source | Collection / tab |
|---|---|---|
| **VÉHICULE** | `/api/parc`, `/api/cp` | Mongo `parc`, `cp` — merged, §1.5 |
| **DS history** | `/api/ds/history` | Mongo `ds` (+ `bc` for lines) |
| **SheetCard** ×3 | `/api/sheet?sheet=…` | Sheets tabs `bdd`, `rl`, `rl_reunion`, `import` |
| **ANALYSE IA** | `/api/ds-history/analyze` | none — client sends already-loaded data (§7) |

Every card on this page is individually wrapped in `CardErrorBoundary`
(`d0db5fc`) — before that, one card's render error unmounted all of them. See
[`cross-cutting.md` §8.1](./cross-cutting.md#81-render-errors--carderrorboundary);
**wrap any new card the same way.**

`/api/ds/history` returns `DsHistoryItem[]` — `n_ds`, `date_ds`,
`immatriculation`, `entite_nom`, `description`, `fournisseur`, `techniciens[]`,
`km`, and `lines[]` (`cmd_num`, `code_art`, `designation_consommation`, `qte`).

The BDD SheetCard is **editable** (`c1ece8e`) — it reuses Suivi RL's own
`useUpdateBddRow()` hook rather than a second write path, so the same allowlist,
`verifyRowIdentity()` guard, and optimistic update apply.

---

## 1.5 Vehicle identity — `parc` + `cp`, merged

`src/lib/vehicle/identity.ts`'s `mergeVehicleIdentity(parc, contracts)` produces
the single `VehicleIdentity` that the VÉHICULE card, the PDF/DOCX exports and
the AI analysis payload all read. Before `a6ad585`/`25950ea` each of those read
the raw `parc` record directly, and `VehicleCard` took `parc: ParcItem` as a
**required** prop — so the card rendered nothing whenever `parc` had no row.

That is not a rare edge. Measured against live data:

| | plates |
|---|---|
| distinct plates in `ds` | 11,169 |
| **no `parc` record** (card was hidden) | **5,201 — 46.6%** |
| …of those, **with** a `cp` record | **3,202** |
| …with neither (card still hidden, correctly) | 1,999 |

So for 3,202 plates the page was already fetching full identity data and
throwing it away. This surfaced as a bug report — "VehicleCard not rendering in
production" — but it was never a regression: `git blame` dates the conditional
to `adc6469` (2026-03-20). The card had always vanished on nearly half the
fleet; nobody had hit a cp-only plate and noticed.

**Precedence.** `parc` wins field by field where both carry a value — it is the
fleet master record — and `cp` fills the gaps. Any plate *with* a `parc` record
therefore renders exactly as before: same fields, same precedence, same
`parc + cp` stamp. The card now hides only when **neither** source has anything.

**What `cp` can supply.** Across the 3,250 `cp` rows belonging to those plates:
`imm`, `ww`, `vin`, `brand`, `model`, `version`, `mce_date`, both contract dates
and `gestionnaire` at 100%; `location_type` 99%; `jockey` 82%.

**What it cannot.** Three fields exist only in `parc` and are absent from all
10,230 `cp` documents:

    client · vehicle_state · tenant

These are listed in the identity's `unavailable` (labels) / `unavailableKeys`
(ParcItem keys) and rendered **`non disponible`** in italics — deliberately
distinct from `—`, which means "blank in a record that exists". Collapsing the
two would make a *missing source* look like an *empty parc record*, which is
close to the confusion that produced the original bug report. Both projections
come from one `PARC_ONLY_FIELDS` definition, with a test pinning them together:
drift would have the card call a field unavailable while the export shows `—`,
and nothing would fail.

**Provenance is stated, not assumed.** The card's stamp and the exports'
identity heading read `parc + cp`, `parc`, or `cp (aucune fiche parc)` from
`identity.sourceLabel`. The exports previously hardcoded
`Véhicule — Données fixes (parc)` even when rendering `cp` data.

**Downstream.** `25950ea` extended the same identity to the exports (which
resolve values by `ParcItem` key, which `VehicleIdentity` already matches
structurally) and to the AI payload — which for cp-only plates had been sending
`{brand: undefined, model: undefined}`, i.e. no vehicle context at all on a
fleet where marque and modèle are known 100% of the time. `vehicle_state` stays
undefined rather than invented, so `buildDsAnalysisPrompt()` omits the `État:`
line instead of guessing.

`identityFromImmOnly(imm)` covers the plate neither collection knows: exports
still produce a document (the DS history is the point, not the identity block),
and it reports **nothing** as unavailable — no record at all is not the same as
a source that exists but cannot answer, so every field renders `—` as before.

> **Field-name trap.** The raw `cp` documents spell these `num_chassis`,
> `modele`, `libelle_version_long`, `date_mce`; `/api/cp` maps them to the
> `CpItem` names (`src/app/api/cp/route.ts:37-42`). Measuring the `CpItem`
> names directly against Mongo reports **0% coverage** and is wrong — the first
> pass of this investigation fell into exactly that.

---

## 2. Search

**Plate-only, strict prefix match, with browser caching** (`6f24bdf`,
`26e53fb`). Year and limit inputs were dropped (`08a456d`); VIN was dropped
(`d794e82`).

Suggestions come from the **single shared full-plate-universe query**
(`["vehicle-suggestions"]`, `src/hooks/useVehicleSuggestionList.ts`), which spans
`parc` + `cp` and is persisted to `localStorage` by the query-cache persister.
Only the first page visited in a browser session fetches it; every subsequent
page and navigation reads it with zero network round trip.

Plate variants (`src/lib/utils/plateVariants.ts`) let one typed plate match the several
formats the same vehicle appears under across sources.

> **`4742410`** fixed the page auto-loading a hardcoded plate (`48070-B-7`) on
> mount — a leftover from development.

`/api/query/search` was a server-side autocomplete route superseded by the
client-side filtering above (`6f24bdf`) and left in place unused; it was
deleted once confirmed dead. `/api/query` itself is unaffected and is still
called from `page.tsx` to resolve a typed plate.

---

## 3. Export — `/api/export`

`POST`, rate-limited **20 / 5 min** (bucket `article`-sibling sizing; same
reasoning as the [BDD exports](./bdd-exports.md#1-contract)). Produces **PDF**
(`pdf-lib`, `?format=pdf`) or **DOCX** (`docx`, default).

Unlike the BDD exports, the payload is **field-selection driven**: the client
sends `visibleCardFields`, `visibleLineFields`, and the label maps, so the user's
on-screen column choices are reproduced in the document. Layout was compacted in
`24e34cd`.

BC-sourced pricing was **removed entirely** (`323497a`) — an earlier version
exported prices that turned out not to be trustworthy. Do not reintroduce
without re-verifying against the source.

---

## 4. Cross-cutting details worth keeping

- **Zone chips live in the VÉHICULE card header**, and the card is tinted by
  zone priority (`803454a`). They render as separate green chips, never as
  concatenated `"A + B"` text (`6aee573`). The zone lookup keys off
  `identity.imm`, so it works on cp-only vehicles too (§1.5).
- **`RL_reunion` "suivi" status** is surfaced next to the RL Motif (`cbcf1d0`).
- **Full-row `INTROUVABLE` highlight** on `BddEditableRow` (`f016018`), sharing
  `EMPLACEMENT_INTROUVABLE` with Suivi RL — and its
  [rename-drift fragility](./config-options.md#7-known-limitations).
- **`etatBadgeClass()`** is shared with Suivi RL. It previously lived here as
  `etatStyle()` and covered `ANNULEE` but not `ANNULE`, despite both being valid
  options — one of the two drifted copies that centralising fixed.
- **The bc-price lookup was 7 s on heavy plates**, fixed to ~150–250 ms
  (`44760e9`).
- **A request race** was fixed in `86594a7` — a slower earlier response could
  overwrite a newer one.
- `qte: 0` is a legitimate value and must not fall through to the `"—"`
  placeholder (`d4d33be`).

---

## 4.5 ANALYSE IA — the AI health analysis

Sits between the VÉHICULE card and the sheet rows, above the DS entries it
analyses. **Nothing runs on mount** — the call is made on click only, so
opening the page never costs a Gemini call. Prompt, output contract and guards
live in [`src/lib/ai/prompts/dsAnalysis.ts`](../src/lib/ai/prompts/dsAnalysis.ts);
see [`ai.md`](./ai.md) for the module itself.

**The client sends data it already has; the route does not re-fetch.**
`/api/ds/history`'s ~100-line aggregation (with its `$lookup` into `bc`) is not
exported as a reusable helper, so re-fetching would mean a second copy of it —
the duplication class that let `ef630e0`'s bug outlive its own fix — and would
cost a round trip for bytes the page is already holding. The route therefore
treats the payload as untrusted: `parseInput()` narrows every field, caps
entries at 500 and text at 2000 chars, and tolerates junk rather than throwing.

**What is sent:** contract end date (from `cp`), per-entry date/km/description/
part designations, and the **RL replacement rows** — the `rl` sheet is the
vehicle-replacement log, and a plate appearing there with a `Motif` is a real
health signal, already why this page tints the VÉHICULE card red.

**Contract status is computed in code**, not asked of the model. Date
arithmetic is deterministic and models are unreliable at it; the model receives
the computed status as a fact to restate, which also makes the flag testable.
`contractEnd` reads `contracts[0]`, matching what VÉHICULE displays — picking a
different row would flag one contract's status beside another's on screen.

**Truncation at 80 entries is surfaced in the UI**, not only to the model. The
response carries `truncated`/`analysedCount`/`totalCount` and the card renders
an explicit notice, so a 226-entry vehicle cannot show a partial analysis that
looks complete. (Measured: 11,169 vehicles, avg 23 entries, max 226.)

**Two grounding guards**, because `responseSchema` steers rather than
guarantees — see [`ai.md` §0.1](./ai.md#01-validate--schema-steers-it-does-not-guarantee):
`isDsAnalysisShape()` via the `validate` hook, then `ungroundedDates()` drops
any finding citing a date absent from the source. The whole finding is dropped,
not just the date: a recurrence claim stripped of its invented evidence is an
unsupported claim, not a weaker one.

### Internal vs external repairs

Each entry sent to the model is marked `interne`, `externe: <nom>`,
`externe (non nommé)` or `inconnu`. **The rule is not "fournisseur is empty
means internal"** — production carries an explicit sentinel:

```
externe  fournisseur named, OR technicien === "Fournisseur Externe"
interne  neither, but a real technicien name is present
inconnu  neither
```

`"Fournisseur Externe"` is the **single most common `technicien` value in the
whole `ds` collection** (48,834 occurrences, ahead of every real human name),
and **10,277 of those carry no `fournisseur` at all**. A rule keyed only on
`fournisseur` would file every one of them as in-house work. Verified against
production 2026-08-20; measured across 102,336 DS: **40.5% externe, 50.9%
interne, 8.6% inconnu**.

`inconnu` is surfaced as itself, never defaulted to internal — prompt rule 10
tells the model not to draw conclusions from it. The card shows the split next
to the button ("62 interventions (12 internes · 49 externes · 1 inconnu)") so
the user sees what is being sent before spending a call.

**Two fields evaluated and deliberately rejected:**

- **`entite_nom`** holds only 7 values, all AVIS sites (`Garage Ain Sebaa`
  183k, `Entité Siège`, `Garage Tanger`, …). It says *where* a DS was raised,
  not *who* did the work — external repairs are routinely logged against an
  AVIS garage, so using it would classify most external work as internal.
- **`bc.fournisseurs`** is the *parts* supplier on a purchase order, a
  different question from who performed the repair.

**Supplier names are canonicalised in code, not by instruction.** Measured: 179
raw distinct names collapse to 178 — exactly one real collision
(`EQUIPEMENT MOYEN ATLAS ASSALAMA` vs `Equipement moyen atlas assalama`).
Nearly a no-op, and done in code *precisely because* it is: telling a model to
treat "near-identical names" as the same supplier invites it to merge genuinely
different ones, a worse failure than the problem being solved.

**Supplier recurrence is asked for explicitly.** Rule 9's first draft described
how to *cite* a supplier recurrence but never asked for one — and a live run on
`47024-B-7` duly returned only part-based findings, missing a supplier present
8 times. It now instructs an active search at the same level as part
recurrence, with a 3-occurrence threshold. Worth remembering: describing a
format is not the same as requesting the content.

**A third guard, `ungroundedSuppliers()`**, mirrors `ungroundedDates()` on the
same principle — is this literal present in what we sent? It checks candidate
names against the **entire** payload, not just the supplier list, because
descriptions here are upper-case too (`PB MOTEUR`, `4 PNEUS`) and a model
quoting one verbatim would otherwise be accused of inventing a garage.

Cost impact, measured on the same vehicle with and without the fields:
**4,832 → 5,111 input tokens (+5.8%)**. No change to rate limit, timeout or
model.

### Maintenance-interval compliance

Three fixed-threshold checks — **vidange 10,000 km**, **filtre à air 30,000 km**,
**filtre à gasoil 40,000 km** — computed in
[`maintenanceIntervals.ts`](../src/lib/ai/prompts/maintenanceIntervals.ts) and
handed to the model as finished facts. Prompt rules 11–12 forbid it from doing
any km or date arithmetic itself. Same reasoning as the contract date: the math
is deterministic, models are unreliable at it, and computing it here makes each
check unit-testable.

There is **no per-model interval data** in this project — `kb_specs` /
`part_families` do not exist in any collection, in any database on the cluster,
or anywhere in git history. Fixed thresholds are the only option available.

**Service detection is not keyword matching** — see
[`serviceTypes.ts`](../src/lib/ai/prompts/serviceTypes.ts). AVIS logs oil
services as package codes (`VIDANGE 2:HUILE+FILTRE H/A+MO`, where H=huile,
A=air, G=gasoil), so an air-filter change is usually the `A` inside a
VIDANGE 2, not a `FILTRE A AIR` line. Detecting only the latter would miss
~15,000 services and report vehicles as overdue that are not. The obvious
keywords also carry high-volume false positives — `COURROIE ALTERNATEUR`
(724 rows) is not the timing belt, `FILTRE A HUILE` (26,379) is the filter
part not the service — so matching on `courroie` alone is ~75% wrong. Validated
against all **6,098** distinct designations in production.

#### Visite Technique is the single biggest source of bad km

A **Visite Technique** is the regulatory roadworthiness inspection — a legal
check, not a service — and its km is routinely entered late rather than read
off the odometer at the time. Those readings are excluded from **km math only**;
VT entries still appear in the history the model sees and in every UI and export
that shows km, and nothing else in the app does interval arithmetic.

Measured over the same 400-vehicle sample: excluding VT takes clean,
non-decreasing odometers from **72.5% → 81.3%** (35 vehicles fixed outright) and
removes about a third of all backward steps (**2.26% → 1.55%**).

On **44329-B-7** — the vehicle that surfaced this — the VT is the *only* backward
step: it logged 130,000 km, and the next genuine entry read 118,157.

The matcher is typo-tolerant because the data is: `VIISTE TECHNIQUE` alone
appears 110 times, plus `VIISITE`, `VISIITE`, `VSITE`, `TECHNQIUE`, `TECHNQUE`,
`TECHEIQUE`, `TECHNIQIUE`, `TECHNIUQE`, `VISITE VTECHNIQUE`. Validated against
every `TECH`-containing row in production — 3,877 classified as VT, and the rows
it must *not* catch (`TECH. = RACHID …`, `RéVISION: OTHMANE TECHNICIEN`) are all
rejected.

#### The odometer is still not monotonic, and that shaped the design

Over 400 sampled vehicles with ≥10 DS: only **55.3%** non-decreasing, **44.8%**
carry at least one backward step, 68 with a drop over 5,000 km (worst
**−30,574**). Two consequences, both found by testing rather than planning:

1. `currentKmOf()` takes the **maximum** reading, not the latest, so one
   mistyped low value cannot shrink the odometer. That makes a backward step
   invisible to a negative-gap check — a test caught the guard never firing and
   returning a confident "ok". Coherence is now asserted explicitly.
2. That guard was first written over the **whole history**, and a scan of real
   high-DS vehicles returned "indéterminé" for every check on **5 of 6** —
   precisely the long histories most worth analysing. It is now scoped to the
   window **since the last service of that type**, the only span the arithmetic
   depends on. A mistyped reading in 2022 says nothing about the gap since a
   2025 service.

**The guard is tiered, not binary** — VT exclusion only fixes about a third of
cases, so genuine bad readings remain:

1. Window since the last service is coherent → compute normally.
2. Otherwise, keep the **longest non-decreasing run of real readings** inside
   that window and compute against it, returning **every dropped reading with
   its date and km** so nothing is discarded silently.
3. Only then refuse — and say specifically why ("relevés en recul à chaque point
   de la fenêtre, aucun segment cohérent exploitable"), not a generic
   "incohérent".

Nothing is interpolated, averaged, or corrected into a value that was never
recorded. If the **first** reading in a window is itself the inflated outlier,
the clean run collapses to a single reading and the check correctly refuses
rather than rescuing a wrong answer.

**44329-B-7, before and after:**

| Check | Before | After |
|---|---|---|
| Filtre à air | Indéterminé | **ok** — 11,177 km since 2025-12-15 @106,980 |
| Filtre à gasoil | Indéterminé | **ok** — 30,820 km since 2025-05-12 @87,337 |

`now` is **118,157** — the real reading — not the VT's 130,000. The VT exclusion
alone was enough here; no fallback exclusions were needed.

Tolerance is 1,000 km, which separates keying noise (most common observed drop:
−67 km) from odometer swaps. `never` is kept distinct from `overdue` — no
record at all is a different, often more suspicious statement than a late one.

Live example, `28220-B-7`: computed `Filtre à gasoil overdue +61,463 km, last
2023-01-10 @133,841, now 235,304` — and the model restated exactly those
numbers rather than recalculating. Cost 4,940 input tokens; the computed block
is ~4 lines regardless of history size.

#### Rule 2 — kit de distribution / pompe à eau

**Not an interval check.** There is no per-model interval data, so "overdue by
X km" is not a statement this data supports. What it does support: *never
recorded, on a vehicle well past contract with high mileage*.

**Mileage-only.** Flags when the vehicle is over **120,000 km** AND has **no**
distribution-or-water-pump service anywhere in its history — *whatever the
contract status*. The original spec also required >6 months past
`date_fin_contrat`; that condition was **removed** on real-world feedback, since
a high-mileage vehicle that has never had this service is a real risk whether
its contract is active, ending, or long over. `checkBeltPump()` no longer reads
`date_fin_contrat` at all, and a test pins its signature so the dependency
cannot creep back.

Reuses the same matcher and the same odometer helper as the other checks —
including the VT exclusion, so an inflated inspection reading cannot push a
vehicle over the threshold on its own.

**Four states, and the third is the point:**

| State | Rendered | Meaning |
|---|---|---|
| `skipped` | **Non vérifié** badge | Current km could not be established — the check could not run. Deliberately distinct from both compliant and non-compliant; it neither flags nor clears. |
| `never` | **Jamais** badge | In scope and never recorded. The flag. |
| `ok` | **Effectué** badge | A service is on record, with its date and km. |
| `not_applicable` | **nothing at all** | At or below 120,000 km. Silent by design — printing "does not apply" on every low-mileage vehicle would be pure noise, and unlike the other three this check genuinely does not apply. |

The km boundary is strict: exactly 120,000 km does *not* flag.

Km uses the highest recorded reading (VT excluded). Given ~45% of vehicles carry a backward
step, one inflated reading could in principle cross 120,000 — but the flag is
**conjunctive** (also needs >6 months past contract AND no service ever), so a
lone bad reading cannot produce a false flag by itself, and the finding cites
the reading so it can be checked.

**Prompt rule 14 exists because of a repeat failure.** Rule 13 described how to
treat the computed check but never asked for a finding, and the first live run
on `25705-B-7` computed `never` correctly while the model reported tyre and
supplier recurrences instead and omitted it entirely. This is the *second* time
that exact mistake has been made here (the first was supplier recurrence): **a
prompt that describes a format does not request the content.** Rule 14 now
requires any DÉPASSÉ / JAMAIS ENREGISTRÉ / NON VÉRIFIÉ check to get a dedicated
finding, ahead of part or supplier recurrences.

Live-verified after the rewrite on `48070-B-7` (50 entries, **336,349 km**, no
belt or pump ever): computed `never / 336,349 km / threshold 120,000`, and the
model returned it as the **first, `critical`** finding — *"Le kit de distribution
n'a jamais été enregistré alors que le véhicule affiche 336 349 km, dépassant
largement le seuil de 120 000 km"* — **with no mention of contract status**,
which is the point of the change.

> **Output-token cap.** This check plus three interval checks and up to six
> findings pushed one vehicle to 1,040 output tokens. The route's cap was 900,
> and responses were being silently truncated mid-JSON and surfacing as an
> opaque "bad-response". The cap is now 1,800, and `callGemini` detects
> `finishReason === "MAX_TOKENS"` and logs it explicitly rather than letting
> truncation masquerade as a model quirk.

Note the `skipped` state is guaranteed by the **UI row**, not by the model — the
model does not reliably narrate "could not check", and forcing it to on every
vehicle without a contract date would add noise.

### The three mandatory axes

The prompt opens with an explicit checklist **before** the numbered rules:

```
  AXE 1 — Conformité des intervalles d'entretien
  AXE 2 — Récurrences de pièces ou d'organes      ← toujours obligatoire
  AXE 3 — Récurrences de prestataires externes
```

**This exists because axis 2 regressed.** It was the feature's original
capability and the *only* dimension with no "actively search" mandate — rules 2
and 3 describe how to **phrase** a recurrence, neither asks for one to exist,
while rule 9 mandated supplier recurrence and rule 14 explicitly ranked
recurrences *below* interval checks. With a 6-finding cap, the mandated axes ate
the slots.

Measured on `47024-B-7`, same payload, three consecutive runs each time:

| | part-recurrence findings |
|---|---|
| Before | **2, 0, 1** |
| After | **4, 3, 3** |

The data supports them unambiguously — injectors appear **6 times** across
variant spellings, embrayage 3, moyeu 2. `moyeu de roue` and `batterie` were
absent from every run before and are back in all three after.

Rule **2b** mandates the active search (threshold **2+**, looser than suppliers'
3+, because a component failing twice is already a signal) and requires
**grouping spelling variants** — `Changement des injecteurs` / `réparation
injecteurs` / `TARAGE INJECTEUR` are one system, not three findings. Rule 14 is
now a *slot guarantee*, not a priority ranking. Cap raised **6 → 10**.

> This was the **third** occurrence of the same failure mode in this feature —
> *a prompt that describes a format does not request the content*. The first two
> were supplier recurrence and the belt/pump check. If a new axis is ever added,
> it needs its own imperative mandate, not a description of its output format.

### Follow-up questions

After an analysis, a text input lets someone challenge it — *"pourquoi tu n'as
pas mentionné la récurrence sur l'embrayage ?"* — and get an answer grounded in
the **same payload**. Exchanges are **appended** as Q → A blocks; the analysis is
never replaced.

**Single-shot with context re-supplied, not multi-turn.** `callAI` takes
`prompt: string` and `gemini.ts` builds `contents` from it alone; adding a
`messages[]` array to serve one two-turn use case is the speculative abstraction
that module was deliberately built without. The model is stateless anyway.

Same route, optional `followUp: { question, previousAnalysis }`, detected
**before** rate limiting so it draws its own bucket: **5/min** (`ds-history-followup`)
against the analysis's 10/min, because a follow-up re-sends the payload *and*
the analysis. Billed to its own action so the spend is separable.

**Measured:** 6,040 in / 110–153 out, versus 6,176 / 1,173 for the analysis —
comparable input, far cheaper output.

Two failures were found by live testing, not review, and both are guarded now:

1. **A wrong date.** The first live answer cited `2025-01-04` for an entry
   actually dated `2025-02-04` — right part, right km, wrong month. The analysis
   path had `ungroundedDates()`; this path had nothing.
   `ungroundedDatesInText()` now applies the same standard. Prose cannot have a
   bad finding *removed* the way an analysis can, so an ungrounded date is
   **surfaced to the reader** as an appended caveat and logged.
2. **Reflexive concession.** Rule 2 supplied the verbatim phrase *"Vous avez
   raison, je ne l'ai pas relevé"*, and the model opened a *correct rebuttal*
   with it. Rule 2 is now **"VÉRIFIE D'ABORD, CONCÈDE ENSUITE"** with an explicit
   ban on conceding before checking.

Both re-verified live afterwards: the same question returns `2025-02-04`
correctly with `ungroundedDates: []`, and an invalid challenge now opens
*"Après vérification des données sources, la boîte de vitesses n'apparaît pas
5 fois"*.

`dsAnalysisShapeError()` also now names **which field** failed the shape check
rather than returning a bare boolean — a non-deterministic model against a
six-field schema made "failed validation" impossible to act on.

**Nothing is persisted.** The analysis is advisory output from a
non-deterministic model and would go stale the moment a new DS entry lands;
`gemini_usage` already records that the call happened and what it cost, under
action `ds-history-analysis`.

**Data quality shapes the prompt.** Measured against production, DS
`description` values are terse French shop notes and frequently content-free
("PB MOTEUR", "pb", "."), while `designation_consommation` carries the real
signal ("turbo moteur"). Rule 4 of the prompt states this outright, because a
model handed both without it will narrate a confident story out of "pb".

---

## 5. Mongo field names

All four collections (`ds`, `bc`, `parc`, `cp`) were migrated to clean,
post-backfill key names (`e2e3a4f`, `fa9f3ec`).

`designation_consommation` had a **dual-read window** during the backfill
(`985e3d8`), which is also what introduced
[`field_registry.json` CI enforcement](./fleet-data-import.md#6-related-field_registryjson).
The underlying cause — whitespace variance in `"Désignation Consomation"`
breaking prod twice with *opposite* whitespace — was class-fixed upstream in
the **separate `~/import` repo** (its commit `77f3c9d`, not in this repo's
log), not just patched here.

---

## 6. Known limitations

1. **1211 lines in one page component.** The largest single file in the repo.
2. **Search regexes are not prefix-anchored** for the Articles-style lookups, so
   they can't use a B-tree index — documented as a deliberate accepted limit in
   `PROJECT_HISTORY.md` §3.
3. **`/api/ds/history` has no rate limit** — unlike `/api/article` and
   `/api/export`. It is session-gated but unthrottled.
4. **Sheet lookups fire 6 parallel `/api/sheet` requests** (IMM + WW variants ×
   3 tabs) on every search.
5. **1,999 plates still show no VÉHICULE card** — they exist in `ds` but in
   neither `parc` nor `cp`, so there is genuinely no identity to render (§1.5).
   Their exports still generate, with `—` throughout the identity block.
6. **`client`, `vehicle_state` and `tenant` are unrecoverable for cp-only
   vehicles** (§1.5). Filling them would need the `parc` import to cover those
   3,202 plates; nothing in this app can derive them.
