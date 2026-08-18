import type { QueryClient } from "@tanstack/react-query";

/** localStorage key src/hooks/queryClient.tsx's persister writes the BDD query cache under — must match that file's `key` exactly. */
const QUERY_CACHE_STORAGE_KEY = "jalal-query-cache";

/**
 * Clears every trace of fetched app data from this browser at logout — the
 * persisted TanStack Query cache (plates, client names, technician
 * assignments, free-text comments, all in plaintext in localStorage) and
 * the in-memory query cache. src/app/login/actions.ts's logout() server action
 * only destroys the session cookie; it has no way to reach into this
 * browser's localStorage, so this must run client-side, before the server
 * action is invoked (see the three call sites: src/app/page.tsx,
 * src/components/fleet/ListPageHeader.tsx, src/app/ds-history/page.tsx).
 */
export function clearPersistedAppState(queryClient: QueryClient): void {
  queryClient.clear();
  try {
    window.localStorage.removeItem(QUERY_CACHE_STORAGE_KEY);
  } catch {
    // localStorage unavailable (private browsing, etc.) — nothing to clear.
  }
}
