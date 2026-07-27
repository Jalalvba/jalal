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

- Searched the full codebase (`proxy.ts`, `next.config.ts`, all API
  routes, any headers/middleware config) for `X-Proxy-Secret`,
  `proxy.secret`, `origin.secret`, `edge.secret`, `x-vercel-protection`,
  and plain `secret` — no header-secret check anywhere. The only two
  `secret`-matching files are `lib/session.ts` (iron-session cookie
  secret) and `lib/googleOAuth.ts` (OAuth client secret), both unrelated.
- No `vercel.json` exists in this repo.
- The only request-gating logic is `proxy.ts`, which checks the
  iron-session cookie (`session.isLoggedIn`) — it never reads or
  validates any custom request header.

**Why this isn't a real gap here:** this app is a single Next.js project
deployed directly on Vercel. `proxy.ts` (Next middleware) runs inside the
same deployment in front of every route — there is no separate,
independently-reachable origin server behind it that a request could
bypass around. The "direct origin bypass" threat model assumes a topology
like CDN/WAF → separate app server with its own reachable hostname; that
second, bypassable origin doesn't exist here. The actual auth boundary
(the session-cookie check in `proxy.ts`) sits in the one and only place
every request passes through, so there's no alternate path to defend
against.

**Conclusion:** no code change made. This is a checklist item from a
generic audit template that doesn't map onto this app's actual deployment
architecture, not an open vulnerability.
