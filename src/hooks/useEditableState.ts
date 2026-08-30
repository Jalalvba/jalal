"use client";

import { useEffect, useState } from "react";

/**
 * Local editable copy of a value that comes from props/server state,
 * resyncing whenever the given deps change (e.g. the row's own identity or
 * timestamp) — the exact pattern previously duplicated 3 times (ParkingCard,
 * AtelierCard's 4 fields, src/app/page.tsx's dark-mode init) each with their own
 * `eslint-disable-next-line react-hooks/set-state-in-effect`. Consolidated
 * into one hook, one suppression.
 */
export function useEditableState<T>(value: T, deps: React.DependencyList): [T, (v: T) => void] {
  const [local, setLocal] = useState(value);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- this IS the hook's entire purpose: resync a local editable copy when server state changes underneath it. The docblock above records that the three call sites this replaced each carried this same suppression; consolidating them was meant to leave exactly one, and it went missing rather than being deliberately dropped.
    setLocal(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps is caller-supplied on purpose (resync triggers, not the value itself)
  }, deps);

  return [local, setLocal];
}
