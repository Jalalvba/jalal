# Theming system

This app has a single, app-wide light/dark theme system. There is no per-page
theme logic anywhere — if you're adding a new page or component, it must use
the tokens below, not a literal Tailwind color like `zinc-900` or `bg-black`.

## How it works

- **Library**: [`next-themes`](https://github.com/pacocoursey/next-themes),
  wired into the root layout (`app/layout.tsx`) via `<ThemeProvider
  attribute="class" enableSystem={false} storageKey="theme">`. It toggles a
  `.dark` class on `<html>`; Tailwind's `dark:` variant is bound to that
  class via `@variant dark (&:where(.dark, .dark *))` in `app/globals.css`.
- **The toggle**: `components/fleet/ThemeToggle.tsx` is the *only* toggle
  component in the app. It renders in two shapes — `variant="pill"` (text +
  icon, used on Home/DS History/Articles/Login) and `variant="icon"` (bare
  icon button, wired into `ListPageHeader` so Parking/Atelier/Depot/Suivi RL
  get it automatically). Don't build another toggle — add `<ThemeToggle
  variant="icon" />` (or `"pill"`) wherever a page needs one.
- **Default for first-time visitors**: if no explicit choice has ever been
  made, the theme defaults to **light 7am–7pm, dark otherwise** (local
  client time), via `lib/themeDefault.ts`'s `getTimeBasedTheme()`. This is
  implemented as an inline script in `app/layout.tsx` that runs
  synchronously before hydration (same positioning next-themes' own
  no-flash script uses) — it re-evaluates the current hour on *every* visit
  until the user makes an explicit choice.
- **Explicit override**: clicking `ThemeToggle` sets
  `localStorage['theme-explicit'] = 'true'` in addition to calling
  `setTheme()`. The layout's inline script checks this flag first — if set,
  it honors whatever's in `localStorage['theme']` and skips the time-of-day
  computation entirely. This is what makes an explicit choice "stick"
  across visits instead of being silently overwritten by the time default.
  Clearing site storage (or the `theme-explicit` key specifically) reverts
  to time-based auto-detection.

If you need to change the light/dark cutoff hours, edit
`lib/themeDefault.ts`'s `LIGHT_START_HOUR`/`LIGHT_END_HOUR` — `app/layout.tsx`
imports these directly into the inline script, so there's one source of
truth, not a duplicated magic number.

## Color tokens

Defined in `app/globals.css`'s `@theme` block (mapping `--color-X` →
`--X`) plus `:root`/`.dark` blocks giving each token its light/dark value.
**Always use these instead of a literal `zinc-*`/`black`/`white` class:**

| Token | Utility classes | Light value | Dark value | Use for |
|---|---|---|---|---|
| `background` / `foreground` | `bg-background` / `text-foreground` | zinc-50 / zinc-900 | black / zinc-50 | Page root wrapper |
| `card` / `card-foreground` | `bg-card` / `text-card-foreground` | white / zinc-900 | zinc-900 / zinc-100 | Card-like surfaces (`components/ui/card.tsx`, `RecordCard`) |
| `muted` / `muted-foreground` | `bg-muted` / `text-muted-foreground` | zinc-100 / zinc-500 | zinc-800 / zinc-500 | Dimmed/secondary backgrounds and text (read-only fields, labels, disabled-ish chrome) |
| `border` | `border-border` | zinc-200 | zinc-800 | Every border |
| `input` | `bg-input` | white | zinc-900 | Text inputs, textareas |
| `popover` / `popover-foreground` | `bg-popover` / `text-popover-foreground` | white / zinc-900 | zinc-950 / zinc-100 | Floating surfaces (dropdowns, `Combobox`, `SelectSheet`, `AlertDialog`) |

**What deliberately still uses literal colors** (not a bug, don't "fix"
these into tokens): accent/brand colors per page or per zone-badge (sky,
amber, emerald, lime, violet, fuchsia, etc.), translucent colored washes
(`bg-emerald-500/10`, `bg-red-500/10`, `FLAG_STYLE` in `lib/types.ts`, ETAT
badges, `ZoneBadges`) — these are intentional data-driven distinctions that
already read fine in both themes since a translucent color blends with
whatever's behind it. The one neutral exception left un-tokenized is
`focus:border-zinc-500` on inputs/comboboxes — a neutral mid-gray focus ring
that works acceptably in both themes without needing its own token.

## Font

**DM Sans** (body, weight 300) + **Playfair Display** (h1–h4) + **JetBrains
Mono** (`font-mono` utility) — loaded via a Google Fonts `@import` at the
top of `app/globals.css`, with the actual font-family assignment done via
plain CSS rules (`body { font-family: var(--font-body); }` etc.), not
Tailwind's `font-sans` utility.

Do **not** reintroduce `next/font/google`'s Geist Sans/Mono in
`app/layout.tsx` — a previous version of this app loaded Geist there but
never actually applied it anywhere (globals.css's own font rules always
won), so it was a pure dead network fetch. It was removed; if you want to
change the app's font, edit the `--font-display`/`--font-body`/`--font-mono`
tokens and the `@import` URL in `app/globals.css`, not layout.tsx.
