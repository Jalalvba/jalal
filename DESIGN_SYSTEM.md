# Design System — Audit & Proposal

Status: **proposal only, nothing in this document has been implemented.**
Every finding below was verified fresh against the code on `main`
(commit `8620d86`) on 2026-07-27 — grepped and counted, not recalled or
assumed. File:line citations are given throughout so each claim can be
re-checked directly.

---

## 1. Audit

### 1.1 Color inventory

**Semantic tokens** (`app/globals.css`, `@theme` block) — `background`,
`foreground`, `card`, `card-foreground`, `muted`, `muted-foreground`,
`border`, `input`, `popover`, `popover-foreground`. Well-adopted:
Parking, Atelier, Depot, Suivi RL, Articles, Login, and every
`components/ui`/`components/fleet` primitive consume these instead of
literal `zinc-*`.

**Literal accent-hue usage** (non-zinc, grepped across `app/`,
`components/`, `lib/`, counted by Tailwind property+hue):

| Hue | Hits | Where |
|---|---|---|
| red | 78 (27 border + 26 bg + 25 text) | destructive UI, error banners, Urgent flag, EXTERNE état, BDD nav card |
| amber | 38 | Atelier brand, Suivi RL brand, INST flag, yellow prestataire dot |
| emerald | 22 | Prêt flag, green prestataire dot, "saved" ring flash, BC badge |
| blue | 15 | DS History brand, ESSAI flag, a few text links |
| sky | 12 | Parking brand (page + ZoneBadges + Home nav) |
| lime | 10 | Depot brand (page + ZoneBadges + Home nav) |
| violet/fuchsia/orange | 1 each | ZoneBadges' Atelier badge (violet), ZoneBadges' RDV badge (fuchsia), REP flag (orange) |

9 accent hues are in active use. **No 10th hue ("teal" or otherwise)
exists anywhere in the codebase** — that's not a live concern here.

**Zone/page/nav-card accent consistency** — for each zone, compared the
zone's own page header accent (`ListPageHeader`'s `accentClassName`),
`ZoneBadges.tsx`'s badge color for that zone, and Home's `NavCard` accent
(`app/page.tsx`):

| Zone | Page header | ZoneBadges | Home nav card | Consistent? |
|---|---|---|---|---|
| Parking | `text-sky-400` (`app/parking/page.tsx:145`) | `sky` (`ZoneBadges.tsx:15`) | `bg-sky-500` (`page.tsx:109`) | ✅ |
| Atelier | `text-amber-400` (`app/atelier/page.tsx:233`) | **`violet`** (`ZoneBadges.tsx:18`) | `bg-amber-400` (`page.tsx:85`) | ❌ ZoneBadges disagrees with both |
| Depot | `text-lime-400` (`app/depot/page.tsx:146`) | `lime` (`ZoneBadges.tsx:24`) | `bg-lime-500` (`page.tsx:131`) | ✅ |
| BDD / Suivi RL | `text-amber-400` (`app/suivi-rl/page.tsx:276`) | *(no BDD badge — not a `VehicleZone`)* | **`bg-red-500`** (`page.tsx:120`) | ❌ page and nav card disagree, and page's amber collides with Atelier's amber |
| RDV (appointments) | *(no standalone page — removed per project history)* | `fuchsia` (`ZoneBadges.tsx:21`) | — | uncontested, nothing to compare against |

Two genuine, verifiable mismatches: **Atelier's own badge color in
`ZoneBadges` doesn't match Atelier's own page/nav color**, and **BDD/Suivi
RL's Home nav card color doesn't match its own page header color** (and
that page header color, amber, is already claimed by Atelier).

**Semantic overload** — several hues carry more than one meaning:
- **amber**: Atelier brand + Suivi RL brand + `INST` flag
  (`lib/types.ts:191`) + yellow prestataire dot (`lib/types.ts:248`) — 4
  meanings on one hue.
- **red**: BDD brand (Home nav) + `Urgent` flag (`lib/types.ts:188`) +
  hardcoded `EXTERNE` état color (`app/ds-history/page.tsx:538`) + every
  destructive/error affordance in the app (delete buttons, error
  banners) — the single most-used hue in the codebase (78 hits) is also
  the one meant to universally signal "danger," yet it's also a brand
  color for one zone.

**ÉTAT badges bypass the color system entirely** — `etatStyle()`
(`app/ds-history/page.tsx:535-540`) hardcodes raw hex
(`#1a7a4a`/`#f4c430`/`red-600`/`zinc-700`), not Tailwind's named palette
or the semantic tokens, and always renders white text regardless of
theme. Separately, `ZoneBadges.tsx:4`'s comment claims ÉTAT is
"amber/blue" — that's stale; the real implementation is
green/yellow/red/gray. Not a functional bug (badges still render), but a
misleading comment worth fixing alongside any color-system change.

**Migration completeness** — literal `zinc-*`/`black`/`white` utility
hits per file:

| File | Hits |
|---|---|
| `app/ds-history/page.tsx` | 225 |
| `app/page.tsx` (Home) | 44 |
| `app/articles/page.tsx` | 3 |
| everything else combined | 5 |

97% of all remaining non-token color usage lives in exactly two files —
Home and DS History are the real, quantified holdouts from the token
migration; everywhere else is done.

### 1.2 Typography

- Only **5 real heading tags exist in the whole app**: `<h1>` in
  `app/articles/page.tsx:79`, `app/ds-history/page.tsx:1020`,
  `app/login/page.tsx:21`, `app/page.tsx:61`, and one `<h2>` in
  `app/page.tsx:33`. Playfair Display is wired globally
  (`app/globals.css:96-98`, `h1,h2,h3,h4 { font-family:
  var(--font-display) }`) but, given how few heading tags exist, it
  visually renders in only these 5 spots despite being one of the app's
  three declared typefaces.
- `font-mono` is used 10 times across 6 files. 9 of 10 are legitimate —
  plate numbers, article codes, references, count badges (all genuine
  data identifiers). The 1 exception:
  **`components/fleet/ListPageHeader.tsx:56`** renders the page *title*
  ("Parking"/"Atelier"/"Dépôt"/"Suivi RL" — a proper-noun label, not an
  identifier) in `font-mono` instead of a heading/display style.
- `font-sans` (a Tailwind utility) has 0 hits anywhere — body font is
  applied via a plain CSS rule on `body` (`globals.css:72-79`), which
  matches what `CLAUDE.md` §3 already documents. Not a bug.

### 1.3 Spacing / radius

Six distinct radius values are in concurrent use with no declared scale:

| Class | Px | Hits |
|---|---|---|
| `rounded` | 4 | 6 |
| `rounded-md` | 6 | 4 |
| `rounded-lg` | 8 | 12 |
| `rounded-xl` | 12 | 18 |
| `rounded-2xl` | 16 | 13 |
| `rounded-full` | pill | 15 |

Concrete conflict: the shared `Card` primitive
(`components/ui/card.tsx:14`) uses `rounded-xl`, but Home's `NavCard`
(`app/page.tsx:24`) — visually the same card pattern — doesn't use the
shared `Card` component at all, and hand-rolls its own markup at
`rounded-2xl`. `AlertDialog` and Login's message box also use
`rounded-2xl`, while most other card-like surfaces use `rounded-xl`, with
no evident tiering logic connecting the two — it reads as per-author
choice, not a system.

Micro text sizes: 4 ad hoc values, only one of which has a real Tailwind
name — `text-xs` (12px, 56 hits), `text-[11px]` (11), `text-[10px]` (9),
`text-[9px]` (8). No tokenized "micro-label" scale exists; these are all
bespoke arbitrary-value classes.

**Touch target**: `Button`'s shared `icon` size is `h-10 w-10`
(`components/ui/button.tsx:29`), used consistently by every icon button
in `ListPageHeader`. The one exception is
**`components/fleet/RecordCard.tsx:64`**, whose delete button overrides
this down to `h-9 w-9` via `className` — the only place in the app a
`Button`'s default size is fought rather than used as-is.

### 1.4 Cross-component consistency — error banners

7 near-identical inline error-banner blocks exist with no shared
component, across `app/parking/page.tsx:169`, `app/atelier/page.tsx:257`,
`app/depot/page.tsx:170`, `app/suivi-rl/page.tsx:340`,
`app/articles/page.tsx:145`, `app/ds-history/page.tsx:1111`, and
`app/login/page.tsx:27`.

**4 of them are byte-identical** (Parking/Atelier/Depot/Suivi RL:
`rounded-lg border border-red-900/40 bg-red-950/30 px-3 py-2 text-sm
text-red-300`) — and **none of the four have a `dark:` variant**. They're
hardcoded to dark-mode-only colors. In light mode, these four pages'
error banners render a dark-red-on-dark-red combination that never
adapts — a real theming/legibility bug, not just style drift. Only
Articles/DS History's banners (`rounded-xl`, with actual `dark:`
variants) and Login's (a third, separate variant) are theme-aware to any
degree.

---

## 2. Proposal

Nothing below is implemented. This is the shape of the fix, for approval
before any code changes.

### 2.1 Zone/accent color — single source of truth

Create `lib/constants/zones.ts` mapping each zone to exactly one color,
consumed identically by `ZoneBadges.tsx`, each page's own
`accentClassName`, and Home's `NavCard`. Proposed assignments — **zero
new hues introduced**, only a reassignment of ones already in the
9-hue inventory:

| Zone | Color | Change from current |
|---|---|---|
| Parking | sky | none — already consistent everywhere |
| Atelier | amber | fix `ZoneBadges.tsx:18` (currently violet) to match the page/nav consensus |
| Depot | lime | none — already consistent everywhere |
| BDD / Suivi RL | **violet** (newly assigned) | fix both `app/suivi-rl/page.tsx` header and Home's `NavCard` (currently amber vs red) to a single, uncontested color — violet is freed up once Atelier's `ZoneBadges` entry is corrected, and reusing it means the palette doesn't grow |
| RDV (appointments) | fuchsia | none — uncontested |

This also breaks red's overload: once BDD stops using red as a brand
color, **red is reserved exclusively for destructive/error/urgent
semantics** app-wide (delete actions, error banners, the `Urgent` flag,
`EXTERNE` état) — one hue, one meaning. Blue/orange/emerald stay
strictly status colors (ÉTAT/flag/prestataire), not brand colors, for the
same reason. `etatStyle()`'s hardcoded hex should be replaced with the
same named palette (or its own small token set) so it's no longer the one
place colors bypass the system — a color-value change only, not a
behavior change (same 4 states render, same visual weight).

### 2.2 Typography — 2-font system

Drop Playfair Display (its footprint is 5 headings app-wide — not enough
to justify a second display face, and a decorative serif is a mismatch
for a data-dense fleet-ops tool). Consolidate to:
- **One UI sans** for all headings and body text — recommend **Inter**
  (a standard, highly-legible enterprise-dashboard choice) replacing both
  Playfair Display and DM Sans.
- **JetBrains Mono**, kept exactly as-is, for data/identifiers only.

Fix `ListPageHeader.tsx:56` to use the new sans (page titles are labels,
not data) instead of `font-mono`.

### 2.3 Radius — 3-tier scale

| Tier | Radius | Use |
|---|---|---|
| control | `rounded-lg` (8px) | inputs, buttons, badges, small chips |
| surface | `rounded-xl` (12px) | cards, list rows, sheets — what `components/ui/card.tsx` already uses |
| container | `rounded-2xl` (16px) | modals/dialogs, Home's nav cards, page-level panels |
| pill | `rounded-full` | count chips, pill buttons — unchanged |

This retires bare `rounded` (4px) and `rounded-md` (6px) as ungoverned
one-offs, and gives Home's `NavCard` a documented reason to be
`rounded-2xl` (container tier) while `Card` stays `rounded-xl` (surface
tier) — currently that's an accidental-looking split, this makes it a
deliberate one.

### 2.4 Micro-label text scale

Add a single `--text-micro` token (~10–11px) to `@theme` to replace the
3 ad hoc arbitrary values (`text-[9px]`, `text-[10px]`, `text-[11px]`).
`text-xs` (12px) stays as the next tier up, unchanged.

### 2.5 Fix touch-target override

Remove the `h-9 w-9` override on `components/fleet/RecordCard.tsx:64`;
let it use `Button`'s default `icon` size (`h-10 w-10`) like every other
icon button in the app.

### 2.6 Shared error-banner component

Extract the 7 inline banners into `components/ui/alert.tsx`, migrate all
7 call sites. Every instance must ship with a real `dark:` variant —
this is what fixes the light-mode bug on Parking/Atelier/Depot/Suivi RL,
not just the duplication.

### 2.7 Complete the token migration

Migrate Home (44 hits) and DS History (225 hits) off literal
`zinc-*`/`black`/`white` onto the semantic tokens, matching what was
already done for the other 6 pages+shared components. Color values only
— no layout or behavior changes.

---

## 3. Sequencing (once approved)

Same discipline as every prior change in this project: separate commits
per numbered item in §2, `tsc`/`eslint` + a real light/dark/375px
click-through after each before moving to the next. Item 2.7 (Home/DS
History token migration) is the largest single diff (269 of the 274
literal-color hits in the app) and should go last.
