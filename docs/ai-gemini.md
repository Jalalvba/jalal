# Gemini integration — email drafting and comment reformulation

**Primary files:**
[`app/api/generate-email/route.ts`](../app/api/generate-email/route.ts) ·
[`app/api/bdd/reformulate-comment/route.ts`](../app/api/bdd/reformulate-comment/route.ts)
· client: [`hooks/useBddRows.ts:98`](../hooks/useBddRows.ts#L98) and
`ReformulateCommentButton` in
[`app/suivi-rl/page.tsx:408`](../app/suivi-rl/page.tsx#L408) · types:
[`lib/types.ts:747-774`](../lib/types.ts#L747)

Two routes, one provider. `reformulate-comment` was built second and
deliberately mirrors `generate-email`'s structure — it defers to that file for
the model rationale rather than restating it
([`reformulate-comment/route.ts:1`](../app/api/bdd/reformulate-comment/route.ts#L1)).

---

## 1. Shared design

Both routes are hand-rolled `fetch` calls against Gemini's REST API. **No SDK,
no AI-framework dependency** — `package.json` carries no `@google/generative-ai`
or similar. Two ~150-line routes did not justify a dependency.

```
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
headers: { "Content-Type": "application/json", "x-goog-api-key": <GEMINI_API_KEY> }
body:    { contents: [{ parts: [{ text }] }],
           systemInstruction: { parts: [{ text }] },
           generationConfig: { maxOutputTokens, temperature } }
```

| | `generate-email` | `reformulate-comment` |
|---|---|---|
| Rate limit | **30 / min**, bucket `generate-email` | **20 / min**, bucket `bdd-reformulate` |
| Rate-limit call | `checkRateLimit()` + manual 429 | `rateLimitOrNull()` |
| Input cap | `MAX_PROMPT_LENGTH` 5000 | `MAX_COMMENT_LENGTH` 1000 |
| `maxOutputTokens` | 400 | 150 |
| `temperature` | 0.25 | **0.3** |
| Timeout | 20 s (`AbortController`) | 20 s (`AbortController`) |
| Model override by client | **yes** (`body.model`) | **no** — hardcoded |
| Error language | English | French |
| UI caller | **none** — API-only | Suivi RL ✨ button |

**Why the different rate limits:** email drafting is a deliberate one-at-a-time
action; reformulation sits next to every comment field on a list page where ~85
cards are on screen, so a lower ceiling guards against a click-storm. Both are
per-IP, Mongo-backed atomic `$inc` (see [`lib/rateLimit.ts`](../lib/rateLimit.ts)).

**Why `temperature` differs:** 0.25 for drafting a whole email from a short
prompt (needs some freedom); 0.3 for polishing text that already exists. Both
are low — neither task wants invention.

---

## 2. Model choice: `gemini-flash-lite-latest`

Both routes default to the same constant:

```ts
const DEFAULT_MODEL = "gemini-flash-lite-latest";
```

### 2.1 Why a rolling alias and not a pinned snapshot

Recorded verbatim at
[`generate-email/route.ts:5`](../app/api/generate-email/route.ts#L5):

- It is the **cheapest active Flash-Lite tier**, on Gemini's free tier.
- The alias was **verified live** against `GET /v1beta/models/gemini-flash-lite-latest`
  — not assumed from training data.
- A dated snapshot was tried and **failed**: `"gemini-2.5-flash-lite"` returned
  `404 — no longer available` for this key. Google had already retired it once.
- The API key belongs to the **"jalal" project in Google AI Studio**.

### 2.2 ⚠️ The accepted risk

> **A rolling alias can silently swap the underlying model version at any time.**
> Output quality, tone, latency, and token accounting can all change with no
> deploy on our side and no error anywhere.
>
> This was accepted **specifically because both uses are internal, low-stakes,
> and human-reviewed before anything is persisted**. The original comment states
> the boundary explicitly: *"do not reuse this alias-over-snapshot choice for
> anything output-sensitive without flagging that tradeoff again."*

**If either route ever feeds something unreviewed** — an auto-sent email, a
direct sheet write, a value another system consumes — **pin a dated snapshot
first and accept the retirement-maintenance cost instead.**

### 2.3 Client-overridable model — only on `generate-email`

```ts
const model = body.model?.trim() || DEFAULT_MODEL;   // generate-email:64
```

Interpolated into the URL via `encodeURIComponent()` (`:82`). Deliberate: *"Model
is never a secret and stays client-overridable per the route's contract — only
the API key is locked to the server-side env var."* The route is gated by
`proxy.ts`, so the only party who can set it is the single authorised user.

`reformulate-comment` **hardcodes** `DEFAULT_MODEL` into its URL — no override,
no `encodeURIComponent` needed. Deliberate asymmetry: it's called from a fixed
UI button, not a general-purpose API.

---

## 3. `GEMINI_API_KEY` handling

Read from `process.env` **inside the request handler**, never at module scope:

```ts
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("[generate-email] GEMINI_API_KEY is not set");
  return NextResponse.json({ ok: false, error: "Email generation is not configured" }, { status: 500 });
}
```

**Why not module scope:** `lib/googleSheetsBdd.ts` throws at import time on a
missing `GOOGLE_SHEETS_ID` — appropriate for a variable the whole app needs.
`GEMINI_API_KEY` powers two optional features; a missing key must degrade
*those two routes*, not prevent the app from booting.

**The key is never exposed to the client.** It travels as a request header, so
Gemini's error bodies cannot echo it back. Even so, upstream error text is
`console.error`'d server-side and **never** returned:

> *"Gemini error bodies don't carry our key (it's a request header, not response
> content), but the raw text may carry other detail we don't want to promise as
> a stable client-facing contract."*

Clients only ever see the four fixed messages in §5.

---

## 4. `reformulate-comment` — the context-aware prompt

### 4.1 The six context fields

`ReformulateCommentContext` ([`lib/types.ts:757-764`](../lib/types.ts#L757)) —
all optional:

| Key | BDD field | Sent as |
|---|---|---|
| `modele` | `modele` | `Modèle` |
| `etat` | `ETAT` | `ETAT` |
| `prestataire` | `prestataire` | `Prestataire` |
| `flag` | `flag` | `Flag` |
| `categorie` | `Catégorie` | `Catégorie` |
| `technicien` | `Technicien` | `Technicien` |

Populated at [`page.tsx:378`](../app/suivi-rl/page.tsx#L378), each
`String()`-coerced — see [`suivi-rl.md` §10.1](./suivi-rl.md#10-known-limitations--edge-cases).

**What is deliberately NOT sent:** `IMM`, `client`, `date`, `Emplacement`, and
the 15 read-only XLOOKUP columns. Rationale — `IMM`/`client` are identifying
data with no bearing on wording; the rest add tokens without improving a
one-sentence rewrite. **Sending the plate to a third-party LLM was not
necessary for the task, so it isn't sent.**

`Emplacement`'s absence is worth noting: it *is* a filter axis and *is* in the
exports, but it describes where the vehicle sits, not what the comment says.

### 4.2 The system instruction — verbatim

[`reformulate-comment/route.ts:20`](../app/api/bdd/reformulate-comment/route.ts#L20):

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

`generate-email`'s instruction is one line by comparison
([`route.ts:27`](../app/api/generate-email/route.ts#L27)):

```
You draft short, professional business emails. Output only the email body —
no preamble, no commentary.
```

### 4.3 Blank-context handling — `buildUserTurn()`

[`route.ts:38`](../app/api/bdd/reformulate-comment/route.ts#L38):

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

## 5. Error handling — identical shape, different language

| Condition | Status | `generate-email` | `reformulate-comment` |
|---|---|---|---|
| Rate limited (ours) | 429 | `Trop de requêtes. Réessayez dans {n}s.` | (via `rateLimitOrNull`) |
| Bad JSON | 400 | `Invalid JSON body` | `Invalid JSON body` |
| Empty input | 400 | `prompt is required` | `comment is required` |
| Over length | 400 | `prompt exceeds 5000 characters` | `comment exceeds 1000 characters` |
| Missing API key | 500 | `Email generation is not configured` | `Comment reformulation is not configured` |
| Gemini 429 | **429** | `…rate-limited upstream. Try again shortly.` | `Reformulation rate-limited en amont…` |
| Gemini ≥ 500 | **502** | `…temporarily unavailable.` | `Service de reformulation temporairement indisponible.` |
| Gemini 4xx (other) | 500 | `Email generation failed` | `Échec de la reformulation` |
| Timeout (20 s) | **504** | `Email generation timed out. Try again.` | `La reformulation a expiré. Réessayez.` |
| Unexpected shape | 500 | `Email generation failed` | `Échec de la reformulation` |

**Upstream status is mapped, not passed through** — 429→429, 5xx→**502**
(upstream failed, we didn't), timeout→**504**. `clearTimeout` runs in `finally`
in both.

**Response shape validation:** `data?.candidates?.[0]?.content?.parts?.[0]?.text`
must be a non-empty string. `reformulate-comment` additionally requires
`.trim()` to be non-empty and returns the trimmed value — `generate-email`
returns the raw string. Minor, deliberate: an email's leading whitespace may
matter; a one-line comment's does not.

> **Language inconsistency is a known, accepted wart.** `generate-email`'s
> messages are English (it has no UI); `reformulate-comment`'s are French (they
> render in a French dialog). Worth unifying if `generate-email` ever gets a UI.

---

## 6. Review-before-save UX

`ReformulateCommentButton` — [`page.tsx:408`](../app/suivi-rl/page.tsx#L408).

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

Stated three times in the code — the route header (`:5-7`), the hook JSDoc
([`useBddRows.ts:93`](../hooks/useBddRows.ts#L93)), and the component
(`page.tsx:404-407`) — because it is the property that makes the rolling-model-alias
risk (§2.2) acceptable.

Specific decisions:

- **Confirm reuses `commitField("commentaire")`** — the *same* save path as a
  manual edit. No parallel write path exists, so allowlist enforcement,
  `verifyRowIdentity()`, optimistic update, and the success toast all apply
  unchanged.
- **The suggestion is editable before saving** (`<textarea>`, `:492-498`). The
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

`useReformulateComment()` ([`useBddRows.ts:98`](../hooks/useBddRows.ts#L98)) is
the **only** mutation in that file with **no** `meta.successMessage` and **no**
`invalidateQueries`. Both omissions are correct: nothing changed, so there is
nothing to announce and no cache to invalidate.

---

## 7. `generate-email` has no UI caller

**Verified** by grep across `app/`, `components/`, `hooks/`, `lib/`, `e2e/`:
the only references to `/api/generate-email` are inside the route file itself.

It is a **deliberately headless API surface** — `cb13749` describes it as *"a
second, parallel LLM provider alongside this app, not a replacement for anything
existing"*, and `6629251` hardened it to the same cost/security/reliability
rules as the rest of the app. It is reachable (behind the session gate) but
nothing in this repo calls it.

Flagged in Phase 2 as **needs judgment** — dead-by-reference but plausibly
intentional groundwork. Do not remove without confirming no external consumer.

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
6. **No token accounting or cost logging.** Nothing records how many calls or
   tokens were spent. On the free tier this is invisible until quota is hit.
7. **`generate-email` accepts an arbitrary `model` string.** Only the authorised
   user can reach it, but a typo yields an opaque upstream 404 mapped to
   `Email generation failed`.
8. **Context is a flat `k=v` line, not structured.** A `Commentaire` containing
   `Contexte:` or `Commentaire original:` could confuse turn boundaries. No
   escaping is applied — low risk given the 1000-char cap and human review, but
   it is a prompt-injection surface.
9. **No caching.** Reformulating the same comment twice costs two calls.
