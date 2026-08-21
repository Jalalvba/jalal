"use client";

// One-shot "the next read of this list must bypass the server cache" flag.
//
// The problem it solves: every mutation route calls invalidateCache(), but
// Next's revalidateTag is stale-while-revalidate by definition — the refetch
// React Query fires the instant a mutation resolves is served the PRE-mutation
// rows, and the change only appears on a later read. That is why a deleted
// Atelier card stayed on screen until the page was refreshed. The API that
// expires immediately, updateTag, is Server-Actions-only and these are all
// Route Handlers, so the fix has to be on the read side.
//
// A flag rather than a query-key variant or a `fresh` argument threaded
// through every hook: the refetch is fired by React Query's invalidation
// machinery, not by the mutation's own code, so there is no call site to pass
// an argument to. It is consumed on read, so exactly ONE refetch per mutation
// bypasses the cache and the ordinary polling reads stay cached — which is the
// whole reason the cache exists (a 60 req/min service-account quota shared by
// four tabs).

const pending = new Set<string>();

/** Call right before invalidating a list's query after a write to it. */
export function markFresh(scope: string): void {
  pending.add(scope);
}

/**
 * Like markFresh(), but covers every read of `scope` for the next `windowMs`
 * — including reads on OTHER pages, after a navigation, which the one-shot
 * in-memory flag cannot survive.
 *
 * Needed where the write and the read that must see it happen on different
 * pages: saving a Technicien on /admin/config and then opening /atelier, whose
 * dropdown reads the same list. Pass the server-side TTL for that data, since
 * that is exactly how long a stale entry could otherwise be served.
 *
 * Deliberately NOT the default: for the row lists it would mean every
 * background read in the window skips the cache, and that cache is what keeps
 * four tabs inside a 60 req/min service-account quota. It suits the options
 * list because that is read roughly once per page load and written by hand,
 * a few times a year.
 */
export function markFreshFor(scope: string, windowMs: number): void {
  pending.add(scope);
  try {
    sessionStorage.setItem(storageKey(scope), String(Date.now() + windowMs));
  } catch {
    // Private mode / storage disabled — the in-memory flag above still covers
    // the same-page case, which is the common one.
  }
}

function storageKey(scope: string): string {
  return `fresh:${scope}`;
}

function inWindow(scope: string): boolean {
  try {
    const until = sessionStorage.getItem(storageKey(scope));
    if (!until) return false;
    if (Date.now() < Number(until)) return true;
    sessionStorage.removeItem(storageKey(scope));
    return false;
  } catch {
    return false;
  }
}

/** Returns the URL with `?fresh=1` if a write to `scope` is awaiting a read. */
export function freshUrl(scope: string, url: string): string {
  const oneShot = pending.delete(scope);
  if (!oneShot && !inWindow(scope)) return url;
  return url + (url.includes("?") ? "&" : "?") + "fresh=1";
}
