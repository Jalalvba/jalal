# jalal — AVIS Maroc fleet management

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

See [`CLAUDE.md`](./CLAUDE.md) for the stack, environment variables,
theming system, authentication/security architecture, and a feature-by-feature
reference. See [`PROJECT_HISTORY.md`](./PROJECT_HISTORY.md) for the full
development history and [`SECURITY_VERIFICATION.md`](./SECURITY_VERIFICATION.md)
for the full, code-verified security assessment.
