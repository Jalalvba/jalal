# AGENTS.md — universal AI assistant standards

This is the shared rulebook for every AI coding assistant working in this
repo (Claude Code, Gemini CLI, Antigravity, or any other agent). It holds
only the rules that must never be violated regardless of which assistant
is driving — not feature docs, not architecture, not history. The
assistant-specific entry points — [`CLAUDE.md`](./CLAUDE.md) (Claude Code)
and [`GEMINI.md`](./GEMINI.md) (Gemini CLI / Antigravity) — link to this
file rather than restating it; follow those (and the deep-dive docs they
in turn link to — [`PROJECT_HISTORY.md`](./PROJECT_HISTORY.md),
[`SECURITY_VERIFICATION.md`](./SECURITY_VERIFICATION.md),
[`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md)) for the reasoning and full
context behind each rule below — this file states the rule, not the case
for it.

## Rules

1. **Package manager: `pnpm` only.** Never run `npm install`, `yarn`, or
   `bun` — `pnpm-lock.yaml` is the only lockfile in the repo, and a second
   lockfile from another manager would conflict with it. See
   [`CLAUDE.md` §2](./CLAUDE.md#2-getting-started).

2. **Semantic styling tokens, not raw `zinc-*`.** Use the `@theme`
   CSS-variable tokens (`bg-background`, `text-foreground`, `bg-card`,
   `bg-muted`, `border-border`, `bg-input`, `bg-popover`, etc.) instead of
   a literal Tailwind color class like `zinc-900` or `bg-black`/`bg-white`
   in any new or edited component. See
   [`CLAUDE.md` §3](./CLAUDE.md#3-theming-system) for the full token table
   and the documented literal-color exceptions (zone/brand accents,
   translucent washes, modal scrims).

3. **Google Sheets mutation safety: `verifyRowIdentity()` is mandatory.**
   Every Sheets update/delete route that acts on a client-supplied
   `rowIndex` must call `lib/googleSheetsClient.ts`'s `verifyRowIdentity()`
   before writing — it re-reads the row's key cell and refuses the write
   (409) if another change shifted rows in between. See
   [`CLAUDE.md` §4](./CLAUDE.md#4-authentication--security) and
   [`SECURITY_VERIFICATION.md` §4](./SECURITY_VERIFICATION.md#4-data-write-safety).

4. **MongoDB regex safety: `escapeRegex()` is mandatory.** Any `$regex`
   filter built from user input must be passed through `lib/regex.ts`'s
   `escapeRegex()` first — never interpolate raw user input into a
   `$regex` filter. Closes both regex-injection and ReDoS. See
   [`SECURITY_VERIFICATION.md` §5](./SECURITY_VERIFICATION.md#5-input-validation--injection-protection).

5. **Auth model: single hardcoded user.** Authorization is one literal
   email constant — `lib/googleOAuth.ts`'s `AUTHORIZED_EMAIL` — checked
   after cryptographic ID-token verification. There is no User model, no
   database-backed allowlist, and no registration flow; this is a
   deliberate design decision, not a gap to "fix" by adding one. See
   [`CLAUDE.md` §4](./CLAUDE.md#4-authentication--security).

Do not restate or fork these rules elsewhere. If a rule needs to change,
edit it here once — every other doc links in rather than duplicating it.

## Multi-Tool Workflow: Gemini/Antigravity is Read-Only

This project uses two AI tools with strictly separated roles:

- **Claude Code**: the ONLY tool permitted to write, edit, or execute
  changes in this repository. All code changes, file edits, commits, and
  test runs happen exclusively through Claude Code.
- **Antigravity CLI / Gemini**: READ-ONLY audit and research tool. No
  exceptions.

### Hard rules for Gemini/Antigravity sessions in this repo

1. **Never write, edit, delete, or modify any file.** No code changes, no
   config changes, no committing, no running write operations against
   MongoDB, Google Sheets, Google Drive, Gmail, or any other connected
   Google API/service — read-only access to all of these, always.
2. **Never claim something is true without citing where it was verified**
   (a specific file/line, a specific live read of a Sheet tab, a specific
   query result). Given this project relies heavily on Google Sheets/
   service-account data, any claim about spreadsheet structure, tab
   names, or data contents must be based on an actual read performed
   during that session — not assumed, not remembered from a prior
   session, not inferred from a filename.
3. **Every Gemini/Antigravity session must end by producing a single,
   ready-to-use prompt** — written for Claude Code to execute —
   summarizing the audit findings and the exact recommended action. This
   prompt is the ONLY output the human should need to copy; Gemini/
   Antigravity itself makes zero changes to the project directly.
4. **If a task requires making an actual change, Gemini/Antigravity must
   decline and say so explicitly** — e.g. "This requires a code change,
   which I cannot make. Here is the prompt to give Claude Code instead:"
   — rather than attempting the change itself under any circumstance.
5. **Claude Code must independently verify any finding from a Gemini/
   Antigravity-sourced prompt against the real, live codebase/data before
   acting on it** — same as any other unverified claim, per the Mandatory
   Verification Protocol below. A read-only audit tool can still be wrong
   or working from stale context; verification stays required regardless
   of source.

### Mandatory Verification Protocol (applies to all findings, any source)

- Factual claims about project structure, Sheet/tab contents, database
  state, or bug causes must be checked against real, live data (`git
  diff`, `grep`, a direct Sheets/MongoDB read, or a real running test)
  before Claude Code acts on them.
- Neither tool's assertions override direct, observable output.

### Handoff Checklist (Claude Code only, since it's the sole writer)

- Before starting work from a Gemini-sourced prompt: verify its claims
  against the real repo/data first, per the protocol above.
- After any change: `git status`, `pnpm exec tsc --noEmit`, `pnpm lint`.
- Commit small and often so any mistaken change is trivially revertible
  (`git revert`).
