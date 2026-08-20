# Cross-cutting patterns

> **Summary-level doc.** Theming detail lives in [`CLAUDE.md`](../CLAUDE.md) §3
> and [`DESIGN_SYSTEM.md`](../DESIGN_SYSTEM.md); auth/security in
> [`SECURITY_VERIFICATION.md`](../SECURITY_VERIFICATION.md). This page covers
> the app-wide behaviours that don't belong to any one feature.

---

## 1. Data fetching — TanStack Query

[`src/hooks/queryClient.tsx`](../src/hooks/queryClient.tsx) configures one
`QueryClient` for the whole app:

```ts
defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } }
```

Every page's data goes through a `src/hooks/use*Rows.ts` module exposing the same
shape: a `useQuery` for rows, plus `useAdd*` / `useUpdate*` / `useDelete*` /
`useRefresh*` mutations built on a shared `fetchJson<T>()` that throws on
`{ ok: false }` so the thrown `Error.message` is already the real server-side
text.

### 1.1 Persisted cache

`PersistQueryClientProvider` + `createAsyncStoragePersister` write the cache to
`localStorage` under `jalal-query-cache`, **scoped by `shouldDehydrateQuery`** to
two key families:

- **`["bdd", …]`** — Suivi RL originally persisted rows itself
  (`loadCachedRows`/`saveCachedRows`) so a repeat visit painted instantly.
  Plain in-memory query cache wouldn't survive a hard reload; this restores that
  behaviour generically.
- **`["vehicle-suggestions"]`** — the single shared full-plate universe backing
  Parking/Atelier/Depot/DS History's plate inputs. Persisting it means only the
  **first page visited in a browser session** ever fetches it.

Cleared on logout by [`src/lib/utils/clearClientState.ts`](../src/lib/utils/clearClientState.ts)
(`0d82965`, audit I3) — a persisted BDD dataset must not survive a sign-out.

---

## 2. Toasts — one hook-up, not per-call-site

`MutationCache`'s `onSuccess`/`onError` in `queryClient.tsx` gives **every**
mutation in the app a toast without touching a single call site (`c00184b`):

```ts
useMutation({ …, meta: { successMessage: "Champ mis à jour" } })
```

Without `meta.successMessage`, a generic `"Enregistré"` fires. Errors always
surface the thrown message. Rendering is `sonner` via
[`src/components/ui/toaster.tsx`](../src/components/ui/toaster.tsx).

> **The one deliberate opt-out:** `useReformulateComment()` has no
> `successMessage` — nothing was saved, so there is nothing to announce. See
> [`ai.md` §6](./ai.md#6-review-before-save-ux).
>
> **The one inconsistency:** the BDD export helpers use a native `alert()`
> instead. Flagged in [`bdd-exports.md` §7](./bdd-exports.md#7-client-side--srcappsuivi-rlpagetsx).

The same commit added `aria-label`s to every icon-only button.

---

## 3. Stable row order

[`src/hooks/useStableRowOrder.ts`](../src/hooks/useStableRowOrder.ts) (`ed0c3a7`).

**The problem:** Atelier/Parking/Depot rows are sorted server-side by
`TIMESTAMP`. Editing a field **bumps that row's `TIMESTAMP`**, so the refetch it
triggers relocates the row the user is actively working on to the opposite end
of the list.

**The fix:** row *data* is always exactly what the latest query returned
(including the new timestamp) — only the *position* is pinned to the last-known
order, carried across refetches in a ref, until `resetToken` changes.

Passing a token that only changes on an **explicit hard refresh** means the
canonical server order is silently re-adopted at that point. The ref starts
empty, so on first mount every row is "new" — which seeds the initial baseline
as the server's own order for free.

---

## 4. Genuine hard refresh

Every list page's **Actualiser** button (`93da3c0`) POSTs that tab's
`/api/*/refresh` route to bust the **server-side** cache, *then*
`refetchQueries` client-side.

> A client-only refetch would have re-read the same stale server cache —
> the button looked like it worked and didn't.

`/api/bdd/refresh` additionally busts `RL_reunion`'s cache, since DS History
reads both. `useRefreshBddRows()` only refetches BDD's own key; DS History
manages its own.

---

## 5. Loading and empty states

[`src/components/fleet/LoadingSkeleton.tsx`](../src/components/fleet/LoadingSkeleton.tsx)
(`9140e07`) is the single skeleton shared by every list page, gated on
`query.isPending`. Before it, each page had its own spinner or nothing.

---

## 6. Plate input

One pattern everywhere: a `Combobox` fed by `usePlateAutocomplete(search, list)`
with `inputMode="numeric"` so mobile opens the numeric keypad (`f1670a8`).

`src/components/fleet/PlateSearchInput.tsx` / `PlateFilterInput.tsx` wrap it.
Suggestions stay focused after selection (`a352032`) and the dropdown opens on
any input (`1997ec7`).

`src/lib/utils/plateVariants.ts`'s `buildPlateVariants()` generates the format variants
one vehicle appears under across `parc` / `cp` / the Sheet tabs.

---

## 7. Auth, session, rate limiting

Single-user Google OAuth; authorization is one literal constant,
`src/lib/auth/googleOAuth.ts`'s `AUTHORIZED_EMAIL`, checked **after** cryptographic
ID-token verification. **No User model, no allowlist, no registration** —
deliberate, per [`AGENTS.md`](../AGENTS.md) rule 5.

`src/proxy.ts` gates every request via an iron-session cookie; only `/login`,
`/api/auth/google*`, and static assets are excluded (anchored matching).

[`src/lib/http/rateLimit.ts`](../src/lib/http/rateLimit.ts) — Mongo atomic `$inc`, per IP, per
named bucket. **It fails open** if Mongo is unavailable (`6a82a3e`) rather than
crashing the request: an outage removes the ceiling instead of the app.

Full detail, file/line-cited: [`SECURITY_VERIFICATION.md`](../SECURITY_VERIFICATION.md).

---

## 8. Errors

- [`src/lib/http/apiError.ts`](../src/lib/http/apiError.ts)'s `ApiError` + `toErrorResponse()` —
  one mapping for every route. `RowIdentityError extends ApiError(409)`, so no
  route needs its own `instanceof` check.
- [`src/components/ui/alert.tsx`](../src/components/ui/alert.tsx) — the one error banner
  (`e321bad`), after an audit found four visually-different banners, two of them
  unreadable in light mode.

**The recurring surfacing rule:** a *fetch* error only shows a banner when there
is nothing cached to display; an *action* error always shows. A background
refresh failing behind visible stale data stays silent.

---

## 9. Theming

`next-themes` toggles `.dark` on `<html>`. Default is **light 07:00–19:00, dark
otherwise** (`src/lib/utils/themeDefault.ts`) until an explicit choice sets
`localStorage['theme-explicit']`, which then sticks.

`src/components/fleet/ThemeToggle.tsx` is the **only** toggle (`variant="pill"` or
`"icon"`). Use the semantic tokens — never a literal `zinc-*` / `bg-black` /
`bg-white`. Documented exceptions (zone accents, translucent washes, modal
scrims) are listed in [`CLAUDE.md`](../CLAUDE.md) §3.

Fonts: Inter + JetBrains Mono, via `@import` in `src/app/globals.css`. **Playfair
Display and Geist were both dropped deliberately** — don't reintroduce either.

---

## 10. Testing

See [`TESTING.md`](../TESTING.md). 26 test files: Vitest for unit/integration
(no network), Playwright for E2E (needs a real `.env.local` + dev server), CI
enforcing type-check + lint + unit tests + `verify-field-names` (`bde8cd9`).

E2E specs cross-check against the **real API** rather than hardcoded counts —
`e2e/suivi-rl.spec.ts` recomputes its own expectation from `/api/bdd`, because
this is live production data that changes.

> **`TESTING.md` doesn't list `adminConfigKeys.test.ts` or
> `etatBadgeClass.test.ts`.** Minor gap, flagged for Phase 2.
