"use client";

import { useEffect, useState } from "react";

/** Dedupes the dark-mode toggle previously hand-copied into app/page.tsx and app/ds-history/page.tsx. */
export function useDarkMode() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved) setDark(saved === "dark"); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  return { dark, toggle: () => setDark((d) => !d) };
}
