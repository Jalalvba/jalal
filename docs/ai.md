# AI — the `src/lib/ai` module and comment reformulation

**Primary files:** [`src/lib/ai/`](../src/lib/ai) · consumer:
[`src/app/api/bdd/reformulate-comment/route.ts`](../src/app/api/bdd/reformulate-comment/route.ts)
· client: [`src/hooks/useBddRows.ts:98`](../src/hooks/useBddRows.ts#L98) and
`ReformulateCommentButton` in
[`src/app/suivi-rl/page.tsx:410`](../src/app/suivi-rl/page.tsx#L410)

> **This page used to document two routes.** `/api/generate-email` was a
> second, headless Gemini route that nothing in the repo ever called; it was
> deleted as dead code. Its model rationale — which `reformulate-comment` used
> to defer to — now lives in `reformulate-comment`'s own header comment, and
> the comparison tables below have been reduced to the surviving route.

---

## 0. Module layout

Everything AI-related lives in one module. Application code imports `callAI`
from [`src/lib/ai`](../src/lib/ai) and nothing else from it.

| File | Holds | Notes |
|---|---|---|
| `types.ts` | `AiCallParams`, `AiResult`, `AiCallError`, `AiErrorKind`, `CostInfo` | **Import-free.** `src/types/index.ts` re-exports `CostInfo` from here so client components can type a `costInfo` field without pulling the Mongo driver into their import graph. |
| `pricing.ts` | `PRICING`, `MODEL_ALIASES`, `resolvePricingKey`, `detectAliasDrift`, `computeCallCost`, `FREE_TIER_LIMITS`, `quotaDayKey` | Pure — no I/O. Which is why its tests need no mocks. |
| `usage.ts` | `claimFreeTierSlot`, `recordUsage`, `getRemainingCredit` | The Mongo side: `gemini_quota`, `gemini_usage`, `gemini_usage_totals`. |
| `gemini.ts` | the `fetch` call + response normalization | The **only** file that knows Gemini's wire format. |
| `index.ts` | `callAI()` | The single entry point. |

**What is deliberately NOT here:** no provider field, no registry, no
selection layer, no adapter interface with one implementor. `callAI` forwards
straight to `callGemini`. None of that can be designed honestly against a
single provider, and building it now would be guessing at requirements that do
not exist. What would actually make a second provider cheap is not machinery —
it is that `AiCallParams`/`AiResult`/`AiCallError` carry no Gemini vocabulary,
so callers would not change.

**The translation boundary.** `gemini.ts` is where neutral names become Gemini
names: `systemPrompt` → `systemInstruction`, `maxTokens` →
`generationConfig.maxOutputTokens`. Nothing outside that file uses Gemini's
vocabulary, and nothing outside it sees Gemini's response shape — a caller gets
`{ text, costInfo }`, never `candidates[0].content.parts[0].text`.

### 0.1 `validate` — schema steers, it does not guarantee

`AiCallParams.validate` is an optional `(text: string) => boolean` the caller
supplies, run by this module **after** the response arrives.

There is deliberately **no strict mode** in this interface. Gemini's
`responseSchema` steers generation; it does not constrain the decoder, so a
response can still come back the wrong shape. Advertising strictness would be a
lie the caller then trusts — which is exactly the trap the (since-removed)
complaint-handler port hit when moving off Anthropic's grammar-level
`json_schema`, and why it had to hand-write a shape validator.

A rejection raises `AiCallError` with kind `"bad-response"` — the same kind an
unparseable response produces, because from the caller's side they are the same
failure: the model did not return something usable.

It runs **after** `recordUsage()` on purpose: the call was made and billed
whether or not the output is usable, so skipping the record would understate
real spend.

---

## 1. Shared design

Gemini access is a hand-rolled `fetch` against the REST API. **No SDK, no
AI-framework dependency** — `package.json` carries no `@google/generative-ai`
or similar. (This is also why the module's tests mock global `fetch` rather
than an SDK.)

The route does **not** issue that `fetch` itself. Since `221b1a9` every call
goes through the module, today via `callAI()` in
[`src/lib/ai/index.ts`](../src/lib/ai/index.ts), which owns the request, the
API key, the timeout, and the cost bookkeeping (§8.6). The route's own comment
states the rule:
*"All AI access goes through callAI — never fetch a model API directly from a
route, or the call escapes cost tracking entirely."*
([`route.ts:110`](../src/app/api/bdd/reformulate-comment/route.ts#L110))

```
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
headers: { "Content-Type": "application/json", "x-goog-api-key": <GEMINI_API_KEY> }
body:    { contents: [{ parts: [{ text }] }],
           systemInstruction: { parts: [{ text }] },
           generationConfig: { maxOutputTokens, temperature } }
```

| | `reformulate-comment` |
|---|---|
| Rate limit | **20 / min**, bucket `bdd-reformulate` |
| Rate-limit call | `rateLimitOrNull()` |
| Input cap | `MAX_COMMENT_LENGTH` 1000 |
| `maxOutputTokens` | 150 |
| `temperature` | **0.3** |
| Timeout | 20 s (`AbortController`) |
| Model override by client | **no** — hardcoded |
| Error language | French |
| UI caller | Suivi RL ✨ button |

**Why 20/min:** reformulation sits next to every comment field on a list page
where ~85 cards are on screen, so a low ceiling guards against a click-storm.
It is per-IP, Mongo-backed atomic `$inc` (see
[`src/lib/http/rateLimit.ts`](../src/lib/http/rateLimit.ts)).

**Why `temperature` 0.3:** low, because polishing text that already exists does
not want invention.

---

## 2. Model choice: two models, not one

| Route / caller | Model | Why |
|---|---|---|
| `reformulate-comment` | `gemini-flash-lite-latest` | Cheapest active tier; every suggestion is reviewed by a human before it reaches the Sheet. |
| `ds-history/analyze` — default (`quality` absent) | `gemini-flash-lite-latest` | Free. What DS History's card, and the Parking / Atelier / Depot buttons, get. |
| `ds-history/analyze` — `quality: "pro"` | **`gemini-flash-latest`** (served by `gemini-3.7-flash`) | Paid, ~$0.008 a call. Asked for by **Suivi RL / BDD only**, whose summary is written into the sheet and later read as fact. |

**The tier is chosen by name, never by model id** (§2.3 still holds: a client
cannot name a model). The route's `TIERS` map carries the model AND its token
cap together, because the paid model is a thinking model whose thoughts are
capped as output — 1,800 truncated 31 of 101 real calls, so a tier that
changed the model but not the cap would fail a third of the time.

Which page opts in is a product decision, not a technical one: `pro` is passed
by `src/app/suivi-rl/page.tsx` alone, through `GeminiSummaryBlock` →
`AnalyseAndSaveButton`. Everything else stays free by omission — a page has to
opt in to spend. `e2e/geminiSummaryBlock.spec.ts` pins that with a real click
on both pages, reading the request the browser actually sent.

The reformulate route pins one constant:

```ts
const DEFAULT_MODEL = "gemini-flash-lite-latest";
```

### 2.1 Why a rolling alias and not a pinned snapshot

Recorded verbatim at
[`reformulate-comment/route.ts:1`](../src/app/api/bdd/reformulate-comment/route.ts#L1)
(relocated there when `generate-email` was deleted):

- It is the **cheapest active Flash-Lite tier**, on Gemini's free tier.
- The alias was **verified live** against `GET /v1beta/models/gemini-flash-lite-latest`
  — not assumed from training data.
- A dated snapshot was tried and **failed**: `"gemini-2.5-flash-lite"` returned
  `404 — no longer available` for this key. Google had already retired it once.
- The API key belongs to the **"jalal" project in Google AI Studio**.

### 2.1b Why the analysis route does NOT share it

Measured, not assumed. `scripts/audit-ds-analysis.ts` ran the real analysis
pipeline over all 101 Suivi RL / BDD plates on each model and graded every
answer against the source data in code — same prompt, same computed checks,
same guards, 98 vehicles analysable on both:

| Defect | `gemini-flash-lite-latest` | `gemini-flash-latest` |
|---|---|---|
| Cited a date absent from the source | 11 % of vehicles | **0** |
| Supplier occurrence count wrong | 14 claims | **0** |
| Claimed *N* occurrences, cited fewer than *N* dates | 6 claims | **0** |
| Produced a finding for a check that was never computed | 1 vehicle | **0** |
| Missed a supplier with ≥ 3 interventions | 2 | **0** |

Rules 2d/2e were added after a second, manual pass: the 11 Suivi RL plates
with `ETAT = INTERNE` and `flag = REP` were read entry by entry by hand and
analysed against the same rules, then compared with what the model produced.
Its counts and dates were right every time; what it missed was everything
that lives ONLY in `description` — on 47129-B-7, three FAP interventions and
the open "manque de puissance, témoin de défaut moteur" entry that is the
reason the vehicle is in the workshop. Rule 4 had told it to lean on part
designations, and it obeyed too well.

Cost of the upgrade: ~$0.008 (≈0.08 MAD) per analysis against free-tier, i.e.
$0.81 to analyse the whole Suivi RL list once. The trade is accuracy for a
figure that rounds to nothing at this volume.

**The upgrade is not just a model string.** `gemini-3.7-flash` is a thinking
model and its `thoughtsTokenCount` is billed — and capped — as output, so the
route's old `maxTokens: 1_800` truncated **31 of 101** calls into an opaque
`bad-response`. It now sets 5_000; see the constant's comment for the
measurement behind that number.

Re-run the audit after any change to the prompt or the model:

```bash
pnpm audit-ds-analysis                              # current model
pnpm audit-ds-analysis --model=gemini-flash-lite-latest --limit=20
```

It writes nothing to Sheets or Mongo beyond the ordinary `gemini_usage` cost
row, and every call it makes is real and billed.

### 2.2 ⚠️ The accepted risk

> **A rolling alias can silently swap the underlying model version at any time.**
> Output quality, tone, latency, and token accounting can all change with no
> deploy on our side and no error anywhere.
>
> This was accepted **specifically because the use is internal, low-stakes, and
> human-reviewed before anything is persisted**. The original comment states
> the boundary explicitly: *"do not reuse this alias-over-snapshot choice for
> anything output-sensitive without flagging that tradeoff again."*

**If this route ever feeds something unreviewed** — an auto-sent email, a
direct sheet write, a value another system consumes — **pin a dated snapshot
first and accept the retirement-maintenance cost instead.**

### 2.3 The model is not client-overridable

`reformulate-comment` **hardcodes** `DEFAULT_MODEL` into its URL — no override,
no `encodeURIComponent` needed, because it is called from a fixed UI button
rather than as a general-purpose API. (The deleted `generate-email` route did
accept a `body.model` override; with it gone, no route lets a client choose the
model.)

---

## 3. `GEMINI_API_KEY` handling

Read from `process.env` **inside the call**, never at module scope — and since
`221b1a9` that read lives in the wrapper, not the route
([`gemini.ts`](../src/lib/ai/gemini.ts)):

```ts
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error(`[${action}] GEMINI_API_KEY is not set`);
  throw new GeminiCallError(500, "unconfigured");
}
```

The route never sees the key. It catches `GeminiCallError` and maps
`kind: "unconfigured"` to its own French message (§5).

**Why not module scope:** `src/lib/sheets/googleSheetsBdd.ts` throws at import time on a
missing `GOOGLE_SHEETS_ID` — appropriate for a variable the whole app needs.
`GEMINI_API_KEY` powers one optional feature; a missing key must degrade
*that route*, not prevent the app from booting.

**The key is never exposed to the client.** It travels as a request header, so
Gemini's error bodies cannot echo it back. Even so, upstream error text is
`console.error`'d server-side and **never** returned:

> *"Gemini error bodies don't carry our key (it's a request header, not response
> content), but the raw text may carry other detail we don't want to promise as
> a stable client-facing contract."*

Clients only ever see the fixed messages in §5.

---

## 4. `reformulate-comment` — the context-aware prompt

### 4.1 The six context fields

`ReformulateCommentContext` ([`src/types/index.ts:762-769`](../src/types/index.ts#L762)) —
all optional:

| Key | BDD field | Sent as |
|---|---|---|
| `modele` | `modele` | `Modèle` |
| `etat` | `ETAT` | `ETAT` |
| `prestataire` | `prestataire` | `Prestataire` |
| `flag` | `flag` | `Flag` |
| `categorie` | `Catégorie` | `Catégorie` |
| `technicien` | `Technicien` | `Technicien` |

Populated at [`page.tsx:378`](../src/app/suivi-rl/page.tsx#L378), each
`String()`-coerced — see [`suivi-rl.md` §10.1](./suivi-rl.md#10-known-limitations--edge-cases).

**What is deliberately NOT sent:** `IMM`, `client`, `date`, `Emplacement`, and
the 15 read-only XLOOKUP columns. Rationale — `IMM`/`client` are identifying
data with no bearing on wording; the rest add tokens without improving a
one-sentence rewrite. **Sending the plate to a third-party LLM was not
necessary for the task, so it isn't sent.**

`Emplacement`'s absence is worth noting: it *is* a filter axis and *is* in the
exports, but it describes where the vehicle sits, not what the comment says.

### 4.2 The system instruction — verbatim

[`reformulate-comment/route.ts:34`](../src/app/api/bdd/reformulate-comment/route.ts#L34):

```
You are reformulating a short internal fleet-maintenance comment (Commentaire)
written by a technician, in French. You are given the following context about
the vehicle/case:
- Modèle (vehicle model)
- ETAT (current status/state)
- Prestataire (service provider)
- Flag (issue category flag)
- Catégorie (category)
- Technicien (technician name)

Use this context ONLY to understand what the comment likely refers to and to
reformulate it more clearly and professionally — do NOT restate the context
fields in the output, do NOT invent details not present in the original comment,
do NOT change the comment's actual meaning. Fix grammar, tighten wording, keep
it concise and professional French. If a context field is blank, ignore it.
Return only the reformulated Commentaire text, nothing else — no labels, no
quotes, no explanation.
```

Four negative constraints, in priority order: **don't restate context · don't
invent · don't change meaning · don't wrap the output.** The context is
disambiguation input, not content to merge in.

### 4.3 Blank-context handling — `buildUserTurn()`

[`route.ts:52`](../src/app/api/bdd/reformulate-comment/route.ts#L52):

```ts
const contextLine = pairs
  .map(([k, v]) => [k, String(v ?? "").trim()] as const)
  .filter(([, v]) => v.length > 0)
  .map(([k, v]) => `${k}=${v}`)
  .join(", ");

return contextLine
  ? `Contexte: ${contextLine}\nCommentaire original: ${comment}`
  : `Commentaire original: ${comment}`;
```

Three deliberate behaviours:

1. **Blank fields are omitted entirely** — never `Modèle=undefined`, never
   `Modèle=`. A literal `undefined` is a token the model can and will try to
   interpret.
2. **If every field is blank, the whole `Contexte:` line disappears** — not an
   empty `Contexte: `.
3. **`String(v ?? "").trim()`, not `v.trim()`** — the declared type is
   `string | undefined`, but this is client-supplied JSON and a `BddRow` field
   like `modele` can genuinely be a raw number from the Sheet. Calling `.trim()`
   on a number throws. This is the same footgun documented across the codebase.

**Example** (`Flag` and `Technicien` blank):

```
Contexte: Modèle=208, ETAT=INTERNE, Prestataire=SCAL, Catégorie=En réparation atelier
Commentaire original: vehicule en panne moteur attente piece
```

---

## 5. Error handling

| Condition | Status | `reformulate-comment` |
|---|---|---|
| Rate limited (ours) | 429 | `Trop de requêtes. Réessayez dans {n}s.` (via `rateLimitOrNull`, + `Retry-After`) |
| Bad JSON | 400 | `Invalid JSON body` |
| Empty input | 400 | `comment is required` |
| Over length | 400 | `comment exceeds 1000 characters` |
| Missing API key | 500 | `La reformulation n'est pas configurée` |
| Gemini 429 | **429** | `Reformulation rate-limitée en amont. Réessayez dans un instant.` |
| Gemini ≥ 500 | **502** | `Échec de la reformulation` |
| Gemini 4xx (other) | 500 | `Échec de la reformulation` |
| Timeout (20 s) | **504** | `La reformulation a expiré. Réessayez.` |
| Unexpected shape | 500 | `Échec de la reformulation` |

**Upstream status is mapped, not passed through** — 429→429, 5xx→**502**
(upstream failed, we didn't), timeout→**504**. `clearTimeout` runs in `finally`.

**Response shape validation:** `data?.candidates?.[0]?.content?.parts?.[0]?.text`
must be a non-empty string, and must still be non-empty after `.trim()`; the
trimmed value is what is returned.

Messages are French throughout, because they render in a French dialog. (The
deleted `generate-email` route used English, which this page previously
recorded as an accepted inconsistency; with that route gone, so is the
inconsistency.)

---

## 6. Review-before-save UX

`ReformulateCommentButton` — [`page.tsx:410`](../src/app/suivi-rl/page.tsx#L410).

```
✨ click
 │
 ├─ comment is blank ──► dialog opens with "Aucun commentaire à reformuler."
 │                       (no network call at all)
 │
 └─ comment present ───► dialog opens immediately, shows "Génération…"
                          │
                          ├─ success ─► Original (read-only) + Suggestion (EDITABLE textarea)
                          │              │
                          │              ├─ "Confirmer" ─► commitField("commentaire") ─► /api/bdd/update
                          │              └─ "Annuler"   ─► close, no mutation
                          │
                          └─ failure ─► error text; "Confirmer" is not rendered
```

### The load-bearing property

> **`/api/bdd/reformulate-comment` never writes to the Google Sheet.** It calls
> Gemini and returns a string. Nothing is persisted unless the user presses
> Confirmer.

Stated three times in the code — the route header (`:1-3`), the hook JSDoc
([`useBddRows.ts:93`](../src/hooks/useBddRows.ts#L93)), and the component
(`page.tsx:405-409`) — because it is the property that makes the rolling-model-alias
risk (§2.2) acceptable.

Specific decisions:

- **Confirm reuses `commitField("commentaire")`** — the *same* save path as a
  manual edit. No parallel write path exists, so allowlist enforcement,
  `verifyRowIdentity()`, optimistic update, and the success toast all apply
  unchanged.
- **The suggestion is editable before saving** (`<textarea>`, `:498`). The
  user can accept, tweak, or rewrite. It is a starting point, not a verdict.
- **The dialog opens *before* the request resolves** — feedback is immediate,
  with `"Génération…"` while pending.
- **Blank comments short-circuit client-side** — no wasted call, no rate-limit
  budget spent.
- **`Confirmer` is disabled** while pending, while the suggestion is empty, or
  while saving; it is not rendered at all on error.
- **Save failure keeps the dialog open** with the error, so the suggestion isn't
  lost.
- The dialog description reads *"Suggestion générée par IA — vérifiez avant
  d'enregistrer."* — the AI origin is disclosed in the UI, not just in code.

`useReformulateComment()` ([`useBddRows.ts:98`](../src/hooks/useBddRows.ts#L98)) is
the **only** mutation in that file with **no** `meta.successMessage` and **no**
`invalidateQueries`. Both omissions are correct: nothing changed, so there is
nothing to announce and no cache to invalidate.

---

## 6.5 Second consumer — DS History analysis

`/api/ds-history/analyze` (action `ds-history-analysis`, so its cost is
traceable separately in `gemini_usage`) is the second and currently last
consumer of `callAI`. It is the first to use the `validate` hook.

| | `reformulate-comment` | `ds-history-analysis` |
|---|---|---|
| Rate limit | 20 / min | **10 / min** |
| Input size | ~200 tokens | **~4,800 tokens** (a whole vehicle history) |
| Model | `gemini-flash-lite-latest` | **`gemini-flash-latest`** (see §2.1b) |
| `maxTokens` | 150 | **5,000** (thinking tokens count) |
| `temperature` | 0.3 | **0.2** |
| Timeout | 20 s | **45 s** |
| `validate` | not used | **yes** — JSON shape check |
| Grounding guards | none | **3** — shape, dates, supplier names |
| Output | plain text | structured JSON, rendered as fields |

**Why the lower rate limit:** each call carries a whole vehicle history rather
than one comment, and it is a deliberate one-at-a-time action rather than a
button beside every row on a list page.

Prompt, output contract and both guards live in
[`src/lib/ai/prompts/dsAnalysis.ts`](../src/lib/ai/prompts/dsAnalysis.ts).
Full behaviour: [`ds-history.md` §4.5](./ds-history.md#45-analyse-ia--the-ai-health-analysis).

---

## 7. The deleted `generate-email` route

`/api/generate-email` (added by `cb13749`, hardened by `6629251`) was a second,
headless Gemini route for drafting business emails. Nothing in this repo ever
called it: it was dead by reference from the day it landed, and a
`gemini_usage` query later confirmed that **0 of 7 tracked Gemini calls** used
its `generate-email` action, while `reformulate-comment` was logging real calls
in the same window. Phase 2 flagged it as *needs judgment* rather than *safe*,
on the theory that it might be intentional groundwork for an external consumer;
that judgment was made and it was deleted.

Kept deliberately when it went: the alias-over-snapshot rationale (moved into
`reformulate-comment`'s header, §2.1), the `CostInfo` type, and all of
`src/lib/ai/` (then `src/lib/gemini/`). Removed with it: the `GenerateEmailRequest` /
`GenerateEmailResponse` types, which nothing else used.

---

## 8. Known limitations

1. **Rolling model alias** — §2.2. The headline risk.
2. **No output validation beyond non-empty.** A hallucinated, meaning-changed,
   or English reply is accepted by the route; only the human review step catches
   it. Acceptable *only* because review is mandatory.
3. **No retry.** A single transient 5xx surfaces as an error; the user re-clicks.
   Deliberate — a retry doubles cost and latency on a human-triggered action.
4. **Rate limit is per-IP and Mongo-backed.** It fails *open* if Mongo is down
   (`6a82a3e`), so an outage removes the ceiling on upstream Gemini calls.
5. **20 s timeout is not enforced upstream.** `AbortController` abandons our
   request; Gemini may still bill the completion.
6. **Cost tracking exists** (since `221b1a9`) — this entry previously claimed
   it did not. `callAI()` records every call to the
   `gemini_usage` collection (timestamp, action, model, `served_model`,
   `priced_as`, `alias_drift`, input/output/total tokens, tier, `cost_usd`,
   `cost_mad`) plus a JSON-lines copy on stdout, and folds it into per-model
   running totals in `gemini_usage_totals`. `thoughtsTokenCount` is added to
   output tokens because it bills at the output rate. Remaining prepaid credit
   is *derived* from the totals, never stored. The real limits: `PRICING` is a
   hand-maintained table with **no time dimension** — the `gemini-3-7-flash`
   promotional entry must be bumped on **2027-01-01** or every call through it
   is costed at half price — and there is no cached-token pricing, since the
   table carries text in/out rates only.
7. **Context is a flat `k=v` line, not structured.** A `Commentaire` containing
   `Contexte:` or `Commentaire original:` could confuse turn boundaries. No
   escaping is applied — low risk given the 1000-char cap and human review, but
   it is a prompt-injection surface.
8. **No caching.** Reformulating the same comment twice costs two calls.
