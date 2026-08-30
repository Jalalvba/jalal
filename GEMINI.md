# Gemini CLI — Developer Role, Read-Only on Live Data

You may write code in this repository. You may not write data to any
connected service. That line is absolute, and everything below follows
from it.

This file is one of three that state a single policy — the others are
[`AGENTS.md`](./AGENTS.md) (canonical) and [`CLAUDE.md`](./CLAUDE.md) §5.
If they disagree with this file, that is a doc bug: stop and report it,
and do not act on whichever reading grants you the most access.

## What you may do

- Read any file in this repository
- Create, edit, and delete repository files — code, tests, config, docs
- Run commands: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`,
  `git status`, `git diff`, and the rest of the local toolchain
- Commit your work
- Read from connected Google services (Sheets, Drive, Gmail) and query
  MongoDB — read-only operations only
- Analyse, summarise, and audit anything you find

## What you must NEVER do

- **Write, update, or delete ANY data in MongoDB, Google Sheets, Google
  Drive, or Gmail.** Read-only, always, no exceptions. This holds even
  when the write is one cell, even when it is obviously correct, even
  when the task is otherwise impossible without it. A bad file edit is
  caught by a diff and undone with `git revert`; a bad Sheets write lands
  in the live fleet system of record, where PARKING/BDD/RDV drive real
  physical work and a wrongly-placed vehicle is a move a human has to
  undo. If a task requires a data write, say so plainly and hand it to
  Claude Code.
- **Edit `AGENTS.md`, `CLAUDE.md`, or this file to widen your own
  permissions.** These change together, deliberately, by the human —
  never as a side effect of another task.
- **Force-push, rewrite published history, or leave the tree dirty.**

## Before you write

Read `CLAUDE.md` and `AGENTS.md` first — architecture, conventions, env
vars, and the mandatory rules (pnpm only, semantic styling tokens,
`verifyRowIdentity()` on every Sheets mutation route, `escapeRegex()` on
every user-input `$regex`). Those rules bind the code you write even
though you never execute the writes yourself.

## Before you finish

- `pnpm exec tsc --noEmit`, `pnpm lint`, and `pnpm test` — all green.
  Code that was never type-checked is not a finished change.
- `git status` reported, so nothing is left uncommitted by surprise.
- Commit small and often. Each commit should be revertible on its own;
  that revertibility is the entire reason you are allowed to write files.

## Grounding

Never claim something is true without citing where you verified it — a
specific file and line, a specific live read of a Sheet tab, a specific
query result. This project leans heavily on Google Sheets and
service-account data, so any claim about spreadsheet structure, tab
names, or data contents must come from a read you actually performed
this session: not assumed, not remembered from a prior session, not
inferred from a filename. The same applies in reverse — verify Claude
Code's findings against the live codebase before acting on them. Any
agent can be wrong or working from stale context.
