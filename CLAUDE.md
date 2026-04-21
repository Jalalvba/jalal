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
- **`app/suivi/page.tsx`** — BDD immobilization tracking dashboard (see Suivi section below)
- **`app/login/page.tsx` + `actions.ts`** — iron-session auth

### Suivi BDD Feature

`app/suivi/page.tsx` is a fully client-side tracking dashboard that merges two data sources at runtime:

- **Sheet rows** (`_source: "sheet"`): fetched from `/api/sheet?sheet=bdd` — read-only, only 9 fields are used (IMM, date, client, modele, ETAT, prestataire, commentaire, flag, "Reunion N-1")
- **Draft rows** (`_source: "draft"`): stored in `avis.suivi_draft` MongoDB collection via `/api/suivi` (GET/POST) and `/api/suivi/[id]` (PATCH/DELETE)

**Draft workflow**: Clicking ✏️ on a sheet row opens a modal pre-filled with that row's values. Saving POSTs to `/api/suivi` creating a new draft — the sheet row itself is never modified. Drafts appear at the top with a DRAFT badge and support inline tap-to-edit per field.

**Cascading filters**: ETAT → prestataire → flag. Changing ETAT resets prestataire and flag to "TOUS". `visiblePrestataires` and `visibleFlags` are derived inline from `rows` (not stored in state) to always reflect the current filter context. `sheetPrestataires` (all unique prestataires) is kept separately for the modal form's select options.

**Flag system**: `FLAG_COLOR` map drives badge colors on cards and active chip colors in the filter bar. Flag options: Urgent, Prêt, NTR, INST, REP, ESSAI.

**Model**: `lib/models/suivi.ts` exports `SuiviDraft` interface and `SUIVI_FIELDS` array (used to drive form rendering). `ETAT_OPTIONS` is exported but unused in the page — ETAT values are derived dynamically from sheet data (`sheetEtats`).

**PDF export**: Browser `window.open` + `window.print()` — pure HTML/CSS, no server call.

### Auth Flow

`lib/session.ts` defines `SessionData` and `sessionOptions` (7-day cookie, name `auth_session`). The `login/actions.ts` Server Action validates credentials and sets `session.isLoggedIn`.

`proxy.ts` contains middleware-style auth guard logic but is **not active** — it must be renamed to `middleware.ts` at the repo root to be enforced by Next.js. Until then, API routes have no route-level auth protection.

`next.config.ts` allows `192.168.11.110:3000` as a dev origin (local network access).

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
