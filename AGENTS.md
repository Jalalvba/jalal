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
   `rowIndex` must call `src/lib/sheets/googleSheetsClient.ts`'s `verifyRowIdentity()`
   before writing — it re-reads the row's key cell and refuses the write
   (409) if another change shifted rows in between. See
   [`CLAUDE.md` §4](./CLAUDE.md#4-authentication--security) and
   [`SECURITY_VERIFICATION.md` §4](./SECURITY_VERIFICATION.md#4-data-write-safety).

4. **MongoDB regex safety: `escapeRegex()` is mandatory.** Any `$regex`
   filter built from user input must be passed through `src/lib/utils/regex.ts`'s
   `escapeRegex()` first — never interpolate raw user input into a
   `$regex` filter. Closes both regex-injection and ReDoS. See
   [`SECURITY_VERIFICATION.md` §5](./SECURITY_VERIFICATION.md#5-input-validation--injection-protection).

5. **Auth model: single hardcoded user.** Authorization is one literal
   email constant — `src/lib/auth/googleOAuth.ts`'s `AUTHORIZED_EMAIL` — checked
   after cryptographic ID-token verification. There is no User model, no
   database-backed allowlist, and no registration flow; this is a
   deliberate design decision, not a gap to "fix" by adding one. See
   [`CLAUDE.md` §4](./CLAUDE.md#4-authentication--security).

Do not restate or fork these rules elsewhere. If a rule needs to change,
edit it here once — every other doc links in rather than duplicating it.

## Multi-Tool Workflow: two writers, one system of record

This project uses two AI tools. Both may write **code**; only Claude Code
may write **data**.

- **Claude Code**: full read/write on the repository, and the only tool
  permitted to run write operations against Google Sheets, MongoDB,
  Drive, or Gmail.
- **Antigravity CLI / Gemini**: full read/write on repository **files** —
  create, edit, delete, run commands, run `tsc`/lint/tests, commit — but
  **strictly read-only on every connected service**.

The split is about what a mistake costs, not about trust. A bad file edit
is caught by a diff and undone with `git revert`. A bad Sheets or Mongo
write lands in the live fleet system of record, where the PARKING/BDD/RDV
tabs drive real physical work — a wrongly-placed vehicle is a move
someone has to undo, and no code review will catch it. That surface keeps
exactly one writer.

### Hard rules for Gemini/Antigravity sessions in this repo

1. **Never run a write operation against MongoDB, Google Sheets, Google
   Drive, Gmail, or any other connected Google API/service** — read-only
   access to all of these, always, with no exceptions. This holds even
   when a task would be easier with a write, and even when the write
   looks trivially small or obviously correct. Editing repo files is
   permitted; touching live data is not. If a task genuinely requires a
   data write, say so explicitly and hand it to Claude Code.
2. **Never claim something is true without citing where it was verified**
   (a specific file/line, a specific live read of a Sheet tab, a specific
   query result). Given this project relies heavily on Google Sheets/
   service-account data, any claim about spreadsheet structure, tab
   names, or data contents must be based on an actual read performed
   during that session — not assumed, not remembered from a prior
   session, not inferred from a filename.
3. **Anything written to the repo must be verified before the session
   ends**: `pnpm exec tsc --noEmit`, `pnpm lint`, and `pnpm test` all
   green, and `git status` reported so nothing is left uncommitted by
   surprise. Code that was never type-checked is not a finished change.
4. **Commit small and often, and never force-push.** Each commit should
   be revertible on its own — that revertibility is the entire reason
   file writes are permitted at all. Leave the working tree clean.
5. **Neither tool may edit this file, `CLAUDE.md`, or `GEMINI.md` to
   widen its own permissions.** These three state one policy and are
   changed together, deliberately, by the human — never as a side effect
   of another task. An agent that finds them in conflict must stop and
   report the conflict rather than pick whichever reading grants it more
   access.
6. **Each tool must independently verify the other's findings against the
   real, live codebase/data before acting on them** — same as any other
   unverified claim, per the Mandatory Verification Protocol below. Any
   agent can be wrong or working from stale context; verification stays
   required regardless of source.

### Mandatory Verification Protocol (applies to all findings, any source)

- Factual claims about project structure, Sheet/tab contents, database
  state, or bug causes must be checked against real, live data (`git
  diff`, `grep`, a direct Sheets/MongoDB read, or a real running test)
  before either tool acts on them.
- Neither tool's assertions override direct, observable output.

### Checklist after any change (both tools)

- Verify claims against the real repo/data first, per the protocol above.
- After any change: `git status`, `pnpm exec tsc --noEmit`, `pnpm lint`,
  `pnpm test`.
- Commit small and often so any mistaken change is trivially revertible
  (`git revert`).
- A data change — anything in Sheets or Mongo — is Claude Code's alone.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
