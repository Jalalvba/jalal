"use client";

import { useMemo, useRef } from "react";

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
 */
export function useStableRowOrder<T, K extends string | number>(
  rows: T[],
  keyOf: (row: T) => K,
  resetToken: unknown
): T[] {
  const orderRef = useRef<K[]>([]);
  const lastResetTokenRef = useRef(resetToken);

  return useMemo(() => {
    if (lastResetTokenRef.current !== resetToken) {
      lastResetTokenRef.current = resetToken;
      orderRef.current = [];
    }

    const byKey = new Map(rows.map((r) => [keyOf(r), r]));
    const known = orderRef.current.filter((k) => byKey.has(k));
    const knownSet = new Set(known);
    // Rows not in the previous order (freshly added, or the very first
    // pass when orderRef is empty) are appended in the server's own order.
    const fresh = rows.filter((r) => !knownSet.has(keyOf(r)));

    const nextOrder = [...known, ...fresh.map(keyOf)];
    orderRef.current = nextOrder;

    return nextOrder.map((k) => byKey.get(k)!);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyOf is expected to be a stable inline lambda per call site, not a dep; re-deriving on identity would defeat the ref-based memo
  }, [rows, resetToken]);
}
