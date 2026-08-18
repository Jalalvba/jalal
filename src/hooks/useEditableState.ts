"use client";

import { useEffect, useState } from "react";

/**
 * Local editable copy of a value that comes from props/server state,
 * resyncing whenever the given deps change (e.g. the row's own identity or
 * timestamp) — the exact pattern previously duplicated 3 times (ParkingCard,
 * AtelierCard's 4 fields, app/page.tsx's dark-mode init) each with their own
 * `eslint-disable-next-line react-hooks/set-state-in-effect`. Consolidated
 * into one hook, one suppression.
 */
export function useEditableState<T>(value: T, deps: React.DependencyList): [T, (v: T) => void] {
  const [local, setLocal] = useState(value);

  useEffect(() => {
    setLocal(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps is caller-supplied on purpose (resync triggers, not the value itself)
  }, deps);

  return [local, setLocal];
}
