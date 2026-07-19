"use client";

import { useEffect, useRef, useState } from "react";

const SAVED_FLASH_MS = 1500;
const ERROR_FLASH_MS = 3000;

/**
 * One commit-state machine (pending/justSaved/error), shared by every
 * inline-editable field type on the Suivi RL card (select-sheet, free-text,
 * combobox) so the "brief inline confirmation" behavior only has one
 * implementation instead of being copy-pasted per field component.
 */
export function useInlineFieldCommit(onCommit: (value: string) => Promise<void>) {
  const [pending, setPending] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState("");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  async function commit(value: string) {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setError("");
    setPending(true);
    try {
      await onCommit(value);
      setJustSaved(true);
      timeoutRef.current = setTimeout(() => setJustSaved(false), SAVED_FLASH_MS);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
      timeoutRef.current = setTimeout(() => setError(""), ERROR_FLASH_MS);
    } finally {
      setPending(false);
    }
  }

  return { pending, justSaved, error, commit };
}
