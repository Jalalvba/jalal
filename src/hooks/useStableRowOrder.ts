"use client";

import { useMemo, useRef } from "react";

/**
 * The ordering decision, as a pure function — no refs, no React.
 *
 * Given the order the list rendered in last time and the rows the server just
 * returned, produces the order to render now: previously-known rows keep their
 * position (dropping any that disappeared), and rows the previous order did not
 * contain are appended in the server's own order.
 *
 * Split out from the hook below so the behaviour three pages depend on can be
 * tested without a React renderer — see src/lib/__tests__/stableRowOrder.test.ts.
 */
export function computeStableOrder<T, K extends string | number>(
  previousOrder: readonly K[],
  rows: readonly T[],
  keyOf: (row: T) => K
): { order: K[]; rows: T[] } {
  const byKey = new Map(rows.map((r) => [keyOf(r), r]));
  const known = previousOrder.filter((k) => byKey.has(k));
  const knownSet = new Set(known);
  // Rows not in the previous order (freshly added, or the very first pass when
  // the previous order is empty) are appended in the server's own order.
  const fresh = rows.filter((r) => !knownSet.has(keyOf(r)));

  const order = [...known, ...fresh.map(keyOf)];
  return { order, rows: order.map((k) => byKey.get(k)!) };
}

/**
 * Stabilizes the rendered order of a server-sorted row list across
 * background refetches. Atelier/Parking/Depot's row list is sorted
 * server-side by TIMESTAMP (see src/lib/sheets/googleSheets{Atelier,Parking,Depot}.ts's
 * `rows.sort((a, b) => a.rawDate - b.rawDate)`) — a field edit bumps that
 * same row's TIMESTAMP, so the refetch it triggers relocates the row the
 * user is actively working on to the opposite end of the list.
 *
 * Row *data* is always exactly what the latest query returned (including
 * the new timestamp) — only the *position* each row renders at is pinned to
 * the last-known order, carried across refetches in a ref, until
 * `resetToken` changes. Passing a token that only changes on an explicit
 * hard refresh means the canonical server order is silently re-adopted at
 * that point (and on first mount, since the ref starts empty — every row is
 * "new" on the very first pass, which seeds the initial baseline as the
 * server's own order for free).
 *
 * ON THE react-hooks/refs SUPPRESSION BELOW
 *
 * The refs are read and written during render, inside useMemo, which
 * react-hooks/refs (added as an error in eslint-plugin-react-hooks 7.1.1)
 * correctly flags: under concurrent rendering a memo computation can be
 * discarded, and a ref written by a discarded render keeps its new value.
 *
 * This is not a false positive, and it is not silenced lightly. The rule
 * asks for state, but the order must be known DURING the render that uses
 * it — routing it through state would render the server order first and
 * correct it a frame later, which is the row-jumping this hook exists to
 * prevent, on the three pages that jump most visibly. The realistic failure
 * here is narrow: a discarded render seeds the baseline from the same rows
 * the next render sees, so the recomputed order matches.
 *
 * Restructuring this properly is tracked in issue #2. The ordering logic is
 * now pure and tested above, so that work can change the plumbing without
 * having to rediscover the behaviour first.
 */
export function useStableRowOrder<T, K extends string | number>(
  rows: T[],
  keyOf: (row: T) => K,
  resetToken: unknown
): T[] {
  /* eslint-disable react-hooks/refs -- deliberate cross-render cache; see the docblock above and issue #2 */
  const orderRef = useRef<K[]>([]);
  const lastResetTokenRef = useRef(resetToken);

  return useMemo(() => {
    if (lastResetTokenRef.current !== resetToken) {
      lastResetTokenRef.current = resetToken;
      orderRef.current = [];
    }

    const { order, rows: ordered } = computeStableOrder(orderRef.current, rows, keyOf);
    orderRef.current = order;

    return ordered;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyOf is expected to be a stable inline lambda per call site, not a dep; re-deriving on identity would defeat the ref-based memo
  }, [rows, resetToken]);
  /* eslint-enable react-hooks/refs */
}
