# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev       # dev server at http://localhost:3000
pnpm build     # production build
pnpm lint      # ESLint check
```

No test suite is configured.

## Project Overview

**jalal** is a Next.js 16 + MongoDB fleet maintenance dashboard for AVIS vehicle operations. It aggregates service records, inventory, contracts, and supply chain data into a unified interface with PDF/DOCX export.

Stack: Next.js 16 App Router · TypeScript · React 19 · Tailwind CSS 4 · MongoDB Atlas · iron-session · pdf-lib / docx · pnpm

## Architecture

### Data Sources

| Source | MongoDB collection / external | Purpose |
|--------|-------------------------------|---------|
| DS | `avis.ds` | Service records (Dossiers de Service) |
| Parc | `avis.parc` | Vehicle inventory |
| CP | `avis.cp` | Contracts |
| BC | `avis.bc` | Supply chain pricing (Bon de Commande) |
| BDD / RL / Import | Google Sheets (GVIZ API) | Immobilization, replacement vehicles, import records |
| Query/search | `avis360` database | IMM/WW/VIN autocomplete |

The `avis360` database is separate from `avis` — `/api/query` uses it while most other routes use `MONGODB_DB` (`avis`).

### API Routes (`app/api/`)

- **`/api/ds/history`** — Core aggregation pipeline: groups DS records by N°DS, deduplicates technicians, looks up BC prices per line item, calculates KM max. Most complex route.
- **`/api/parc`** — Vehicle inventory lookup
- **`/api/cp`** — Contract lookup
- **`/api/bc`** — Supply chain pricing
- **`/api/article`** — Article search joining bc + parc + cp
- **`/api/query`** — Smart search: returns suggestions if <10 exact matches, auto-resolves if exactly 1
- **`/api/query/search`** — Autocomplete by IMM/WW/VIN prefix
- **`/api/sheet`** — Google Sheets integration (BDD immobilization, RL replacement, import records) via GVIZ protocol
- **`/api/export`** — PDF (pdf-lib) and DOCX (docx) export

### Pages

- **`app/page.tsx`** (~1200 lines) — Main dashboard (DS history). Contains rich client-side state for field visibility, dark mode, search, card/line display toggling.
- **`app/articles/page.tsx`** — Article price search with BC/DS toggle
- **`app/login/page.tsx` + `actions.ts`** — iron-session auth

### Key Patterns

**Field visibility system**: Users toggle which card/line fields to show. Selections are persisted to cookies (`ds_visible_card`, `ds_visible_line`) and respected by the export route. Mandatory fields (Description, Techniciens, ENTITE) always appear.

**Price source tracking**: DS line items carry `price_source: "bc" | "ds"` to distinguish BC-lookup prices from DS-recorded prices. BC prices override DS prices when available.

**Replacement vehicle flagging**: UI highlights red when RL (remplacement) records exist or CP contract type is "remplacement".

**MongoDB singleton**: `lib/mongo.ts` caches the client across hot reloads in dev.

**Localization**: All labels, number formatting (comma decimal, space thousands), and dates are French.

## Environment Variables

```
MONGODB_URI       # MongoDB Atlas connection string
MONGODB_DB        # = "avis"
AUTH_USERNAME     # Simple credential auth
AUTH_PASSWORD
IRON_SESSION_SECRET
```
