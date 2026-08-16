# jalal — AVIS Maroc fleet management

[![CI](https://github.com/Jalalvba/jalal/actions/workflows/ci.yml/badge.svg)](https://github.com/Jalalvba/jalal/actions/workflows/ci.yml)

A Next.js app for tracking fleet vehicles across parking, workshop, depot,
and appointment logs, backed by Google Sheets and MongoDB.

## Getting started

Package manager is **pnpm**.

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Copy `.env.example` to `.env.local` and fill in real values before running
the dev server — the app won't start without them.

## Everything else

Start with [`ARCHITECTURE.md`](./ARCHITECTURE.md) — the index to the
per-feature reference documentation in [`docs/`](./docs), covering what each
feature does, why it was built that way, and its known limitations.

This repo documents itself for two AI assistants side by side: see
[`CLAUDE.md`](./CLAUDE.md) for the Claude Code entry point — stack,
environment variables, theming system, authentication/security
architecture, and a feature-by-feature reference — and
[`GEMINI.md`](./GEMINI.md) for the equivalent entry point used by Gemini
CLI / Antigravity sessions. Both defer to [`AGENTS.md`](./AGENTS.md) for
the small set of rules that apply no matter which assistant is driving.
See [`PROJECT_HISTORY.md`](./PROJECT_HISTORY.md) for the full development
history and [`SECURITY_VERIFICATION.md`](./SECURITY_VERIFICATION.md) for
the full, code-verified security assessment.
