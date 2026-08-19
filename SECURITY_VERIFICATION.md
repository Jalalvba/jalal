# Security verification log

Ad-hoc re-verifications of specific security claims, checked directly
against the current code rather than trusted from a prior report. See
`git log --grep="audit" -i` for the original audit's fix history
(`AUDIT_REPORT.md` itself was a scratch file, never committed, and was
deleted once its items were actioned — see commit `86594a7`).

## 2026-07-27 — "Direct API Origin Bypass" protection

**Claim checked:** whether the app has a mechanism where a reverse proxy /
edge layer adds a secret header (e.g. `X-Proxy-Secret`) to every request,
and the origin server rejects any request missing that exact header —
meant to stop someone from bypassing a protective front layer by hitting
the origin directly.

**Result: does not exist in the code, and doesn't apply to this app's
deployment.**

- Searched the full codebase (`src/proxy.ts`, `next.config.ts`, all API
  routes, any headers/middleware config) for `X-Proxy-Secret`,
  `proxy.secret`, `origin.secret`, `edge.secret`, `x-vercel-protection`,
  and plain `secret` — no header-secret check anywhere. The only two
  `secret`-matching files are `src/lib/auth/session.ts` (iron-session cookie
  secret) and `src/lib/auth/googleOAuth.ts` (OAuth client secret), both unrelated.
- No `vercel.json` exists in this repo.
- The only request-gating logic is `src/proxy.ts`, which checks the
  iron-session cookie (`session.isLoggedIn`) — it never reads or
  validates any custom request header.

**Why this isn't a real gap here:** this app is a single Next.js project
deployed directly on Vercel. `src/proxy.ts` (Next middleware) runs inside the
same deployment in front of every route — there is no separate,
independently-reachable origin server behind it that a request could
bypass around. The "direct origin bypass" threat model assumes a topology
like CDN/WAF → separate app server with its own reachable hostname; that
second, bypassable origin doesn't exist here. The actual auth boundary
(the session-cookie check in `src/proxy.ts`) sits in the one and only place
every request passes through, so there's no alternate path to defend
against.

**Conclusion:** no code change made. This is a checklist item from a
generic audit template that doesn't map onto this app's actual deployment
architecture, not an open vulnerability.

## 2026-07-27 — Full protection-layer assessment

Genuine, from-scratch verification of what actually protects this app —
not a repeat of claims from the original audit or any security matrix.
Every claim below cites the real file/line, and several were checked live
(a dev server was started, `curl -I` run against real routes, then
stopped) rather than trusted from reading config alone.

### 1. Authentication — who gets in

**Start route** — `src/app/api/auth/google/route.ts:11-32`
Generates a 32-byte random CSRF `state`, requests only `openid email`
scope, forces `select_account`, redirects to Google, and stores `state`
in an `oauth_state` cookie (`httpOnly`, `secure` in prod, `sameSite: lax`,
10-minute expiry).

**Callback route** — `src/app/api/auth/google/callback/route.ts:13-59`
- Line 27: rejects if `code`/`state` missing or `state !== expectedState`
  (cookie value) → redirects to `/login?error=state`.
- Line 21: deletes the `oauth_state` cookie unconditionally — one-time use
  regardless of outcome.
- Lines 40-43: exchanges the code, then cryptographically verifies the ID
  token via `oauth2Client.verifyIdToken()` against Google's own public
  keys (not a call to an unauthenticated userinfo endpoint).
- **Line 46 — the actual authorization check**:
  ```ts
  if (!payload?.email || !payload.email_verified || payload.email !== AUTHORIZED_EMAIL) {
    return NextResponse.redirect(new URL("/login?error=unauthorized", req.url));
  }
  ```

**Still a single hardcoded email?** Yes — `src/lib/auth/googleOAuth.ts:7`:
`export const AUTHORIZED_EMAIL = "chafiq.jalal@gmail.com";`. No User
model, no DB-backed allowlist. Confirmed unchanged.

**Different Google account?** The ID token still verifies fine (any real
Google account produces a valid, verifiable token) — it fails at line
46's equality check, redirects to `/login?error=unauthorized`, and no
session is ever created (line 51's `session.isLoggedIn = true` is never
reached). It's a plain string `!==` comparison, not a list/regex — exactly
one email can ever pass.

### 2. Session handling

**`src/lib/auth/session.ts:7-16`** — full config:
```ts
export const sessionOptions: SessionOptions = {
  password: process.env.IRON_SESSION_SECRET as string,
  cookieName: "auth_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
};
```
- Session content: `{ isLoggedIn: boolean }` only (`src/lib/auth/session.ts:3-5`) —
  no PII, no tokens stored.
- Encryption: iron-session's sealed cookie encryption keyed by
  `IRON_SESSION_SECRET` — the cookie value is encrypted+signed state, not
  a readable session ID.
- `secure`: true only in production — correct for HTTP localhost dev vs.
  the real deployment. Not independently re-verified that `NODE_ENV` is
  actually `"production"` on Vercel at runtime — that's a platform default
  being trusted, not re-checked here.
- `httpOnly: true` — confirmed, not JS-readable. `sameSite: "lax"` —
  confirmed (not `strict`/`none`).

**`src/proxy.ts` (lines 41-91)** — checked on every request:
- Lines 61-71: excluded from the session check: `/login`,
  `/api/auth/google` (+ `/api/auth/google/*`), `/_next/*`,
  `/favicon.ico` — anchored exact/prefix matches, not loose `startsWith`
  (lines 54-60 explain why: a bare prefix would let a future route like
  `/login-x` slip through). Each exclusion is necessary: `/login` and the
  OAuth routes must be reachable *while unauthenticated* (that's the login
  mechanism itself); `_next`/favicon are static assets.
- Lines 73-87: everything else calls `getIronSession` and checks
  `session.isLoggedIn`. If false: API routes (`startsWith("/api/")`) get a
  401 JSON (line 79), everything else gets a 307 redirect to `/login`
  (lines 84-86).
- Matcher (lines 99-100): `/((?!_next/static|_next/image|favicon.ico).*)`
  — deliberately does *not* exclude prefetch requests (lines 93-98), since
  this is the actual auth boundary, not just a CSP layer.

Confirmed live (§8) this exclusion list is exactly what gates access.

### 3. CSRF protection (OAuth flow)

Walked the real failure modes in
`src/app/api/auth/google/callback/route.ts:19-29`:
- **Missing state**: `!state || !expectedState` → redirect to
  `/login?error=state`, no token exchange attempted.
- **Tampered state**: `state !== expectedState` → same rejection.
- **Replay**: the `oauth_state` cookie is deleted at line 21 before any
  further processing, so a captured `code`+`state` pair can't be replayed
  through a second request — no cookie means automatic rejection.

Standard OAuth `state` CSRF pattern, correctly implemented: random,
cookie-bound, single-use, checked before any external call. There is no
separate CSRF token system for the app's own mutation routes — see
"What is NOT protected" below for why that's likely fine here.

### 4. Data write safety

**Google Sheets — real row-identity verification**,
`src/lib/sheets/googleSheetsClient.ts:138-159`:
```ts
export async function verifyRowIdentity(sheets, spreadsheetId, cellRange, expected) {
  const expectedNorm = expected.trim().toUpperCase();
  ...
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: cellRange, valueRenderOption: "UNFORMATTED_VALUE" });
  const actual = String(res.data.values?.[0]?.[0] ?? "").trim().toUpperCase();
  if (actual !== expectedNorm) throw new RowIdentityError(...); // 409
}
```
Called before every update/delete — e.g. `src/lib/sheets/googleSheetsParking.ts:398`
(update) and `:430` (delete) both call it against the plate column at the
client-supplied `rowIndex` before writing; same pattern in
`googleSheetsAtelier.ts:363`. Mechanism: a client holds a `rowIndex` from
whenever it last loaded data; if another delete elsewhere shifted rows in
between (Sheets row-deletion renumbers everything below it), this re-reads
the identity cell fresh and refuses the write on mismatch (409, "refresh
and try again") instead of silently overwriting the wrong row.

**MongoDB — no comparable race handling, and none appears needed.**
Searched for `findOneAndUpdate`/`updateOne`/`insertOne` tied to plate data
and found none — Mongo here is read-only lookup data
(`getIMMListSafe()` in `src/lib/sheets/googleSheetsParking.ts:212-219` degrades to
`[]` on failure rather than blocking the Sheets write — the "fail-soft"
behavior, confirmed at those exact lines). The only Mongo *writes* found
are the rate limiter's own atomic `$inc` (`src/lib/http/rateLimit.ts:46-55`), which
is race-safe by construction. There's no Mongo collection holding
authoritative Parking/Atelier/Depot/RDV records — that data lives in
Sheets; Mongo's `parc` collection is a separate read-side reference
dataset. Not a gap — there's no concurrent-write path into Mongo to
protect in this app's actual design.

### 5. Input validation / injection protection

- `src/app/api/parc/route.ts:20-29`: `imm` query param used as a plain string
  equality value in `$match` (`{ Immatriculation: q }`), not interpolated
  into an operator — `URLSearchParams.get()` always returns a string, so
  there's no NoSQL operator-injection vector here.
- `src/app/api/query/route.ts:29`: builds a `$regex` filter from user input and
  passes it through `escapeRegex()` first (`src/lib/utils/regex.ts:6`:
  `s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")`), confirmed running at the
  exact line the regex object is constructed. Closes both regex-injection and
  ReDoS (attacker-controlled quantifiers). (`src/app/api/query/search/route.ts`
  carried the same verified guard and was deleted as dead code.)
- Zero unescaped `$regex`/`new RegExp` construction from request input
  found anywhere in `src/app/api` or `lib` — grepped explicitly for both.

### 6. Rate limiting

**`src/lib/http/rateLimit.ts`** (lines 35-61): fixed-window counter, keyed
`route:ip:windowBucket`, incremented atomically via Mongo
`findOneAndUpdate`'s `$inc` (race-safe across concurrent/multi-instance
requests). TTL index expires old window docs.

Verified real call sites and limits by grepping every call site, not from
memory of the commit message:
- **17 Sheets mutation routes** (atelier/parking/depot/rdv/bdd
  add/update/delete/clear/action) — **all 17 use `30, 60_000`** → 30
  req/min, identical across every one.
- `src/app/api/article/route.ts:7-8,17-21`: `RATE_LIMIT = 20`,
  `RATE_WINDOW_MS = 5 * 60 * 1000` → 20 req/5min.
- `src/app/api/export/route.ts:11-12,85-89`: same shape, also 20 req/5min.
- Both article/export call the lower-level `checkRateLimit()` directly
  rather than the `rateLimitOrNull()` wrapper (predate it), same
  underlying atomic Mongo mechanism.

Stale-comment note: `src/lib/http/rateLimit.ts:63` says the IP-precedence logic
mirrors "`src/app/login/actions.ts`'s clientKey()" — grepped the whole repo,
`clientKey` doesn't exist anywhere, including in `src/app/login/actions.ts`
(read in full — now just a 14-line `logout()` server action, no rate
limiting). Leftover from before the username/password login was replaced
with Google OAuth (`003cb74`). Harmless, but a doc/reality mismatch.

### 7. Secrets management

- `git grep` across all tracked files for Google API key patterns,
  private-key PEM headers, Mongo connection strings with embedded
  credentials, and generic `clientSecret`/`apiKey`/`password` literal
  assignments: zero matches anywhere except `.env.example` (empty
  placeholder `KEY=` lines only).
- `.gitignore` excludes `.env*` except `.env.example`, and explicitly
  ignores `secret.json` (the OAuth client secret from Google Cloud
  Console) and `.vercel`.
- `git ls-files | grep -i env` → only `.env.example`.
- `git log --all --diff-filter=A --name-only | grep env` → nothing; no
  env file was ever committed and later removed either.
- Not checked: what's actually set in Vercel's dashboard/env store — no
  access to that from this environment. Given `.env.example`'s comments
  (referencing `vercel env pull`), real values live in Vercel's Production
  scope; whether Preview/Development scopes also have values, or anything
  there is over-permissioned, needs `vercel env ls` against the real
  project, not a code read.

### 8. HTTP security headers — verified live

`next.config.ts:12-24` declares `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`,
`Strict-Transport-Security: max-age=63072000; includeSubDomains`. Started
the actual dev server and ran real `curl -I` requests:

- `GET /` (unauthenticated) → `307` to `/login`, all four headers present,
  plus a per-request nonce'd CSP from `src/proxy.ts` (different nonce on each
  of three separate requests, confirmed by comparison).
- `GET /login` (public path) → `200`, same four headers + CSP, plus
  Next's own `Cache-Control: no-store, must-revalidate`.
- `GET /api/parc?imm=TEST` (unauthenticated API route) → `401` JSON, same
  four headers + CSP — confirming `src/proxy.ts`'s claim that these reach
  every response branch (public passthrough, 401 JSON, redirect,
  authenticated passthrough) is actually true, not just commented as true.

Dev server was shut down after this check (confirmed via a follow-up curl
returning connection refused).

### 9. What is NOT protected / honest gaps

- **No app-level CSRF token on the 17 Sheets mutation routes.** These rely
  on `sameSite: lax` session cookies as the actual defense: a `lax`
  cookie isn't sent on cross-site POST/fetch/XHR (only top-level GET
  navigations), so a third-party page can't forge an authenticated
  mutation via the victim's browser. Real, working — but implicit via
  cookie policy, not an explicit per-route CSRF check. If `sameSite` policy
  ever changes or cross-site embedding is ever needed, this protection
  disappears with nothing else behind it.
- **Single-user model is a hard architectural assumption.**
  `AUTHORIZED_EMAIL` is a literal string constant — adding a second
  legitimate user requires a code change and redeploy, not config. If
  multi-user ever becomes a real requirement, the whole auth model (no
  User collection, no roles) needs redesigning, not extending.
- **No fallback if Google's OAuth service is down.** No username/password
  path remains (intentionally removed in `003cb74`) — this app cannot
  function without Google OAuth being reachable, by design.
- **Rate limiting is per-IP, not per-session**, trusting
  `x-forwarded-for`/`x-real-ip` (`src/lib/http/rateLimit.ts:64-69`). Reliable behind
  Vercel's own edge; if ever exposed behind another untrusted proxy, these
  headers are client-influenceable and the limit could be bypassed by
  spoofing them. Not verified from the code what strips/sets these headers
  at Vercel's edge — that's platform behavior, not visible in this repo.
- **Stale comment** in `src/lib/http/rateLimit.ts:63` referencing a nonexistent
  `clientKey()` (see §6) — cosmetic only.
- **Vercel's actual environment variable scopes were not verified** (§7)
  — requires platform access not available here.
- **CSP allows `'unsafe-eval'` in development only**
  (`src/proxy.ts:26`, conditional on `NODE_ENV === "development"`) — confirmed
  absent from the production CSP curled against in §8, but worth naming
  since it's a real weakening if that condition were ever wrong.
