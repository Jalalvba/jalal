"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

/**
 * The single global theme toggle — used everywhere a control existed before
 * (Home, DS History) and now also in ListPageHeader (Parking/Atelier/Depot/
 * Suivi RL) and Articles/Login, replacing the old per-page useDarkMode()
 * hand-rolled buttons. Two visual variants only because the pages it
 * replaces used two different shapes ("pill" text+icon on Home/DS History,
 * bare icon button matching ListPageHeader's existing refresh/vider/logout
 * icons) — same underlying toggle logic either way.
 *
 * Setting theme-explicit is what tells src/app/layout.tsx's no-flash script
 * this was a deliberate user choice, not the time-of-day default — from
 * this point on, every future visit honors it instead of recomputing from
 * the current hour (see src/lib/utils/themeDefault.ts).
 */
export function ThemeToggle({
  variant = "pill",
  className,
}: {
  variant?: "pill" | "icon";
  className?: string;
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time mount flag to avoid a hydration mismatch (server can't know the resolved theme), same pattern as src/hooks/useEditableState.ts
  useEffect(() => setMounted(true), []);

  function toggle() {
    const next = resolvedTheme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem("theme-explicit", "true");
    } catch {
      // localStorage unavailable (private mode / disabled) — theme still
      // toggles for this session via next-themes' in-memory state.
    }
    setTheme(next);
  }

  // Avoid a hydration mismatch: resolvedTheme is only reliable after mount
  // (server has no notion of the client's chosen/time-based theme).
  const dark = mounted ? resolvedTheme === "dark" : true;

  const sunIcon = (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="5" />
      <path
        d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
        strokeLinecap="round"
      />
    </svg>
  );
  const moonIcon = (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );

  if (variant === "icon") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={toggle}
        disabled={!mounted}
        title={dark ? "Passer en mode clair" : "Passer en mode sombre"}
        aria-label={dark ? "Passer en mode clair" : "Passer en mode sombre"}
        className={className}
      >
        {dark ? sunIcon : moonIcon}
      </Button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!mounted}
      title={dark ? "Passer en mode clair" : "Passer en mode sombre"}
      aria-label={dark ? "Passer en mode clair" : "Passer en mode sombre"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground transition hover:bg-muted disabled:opacity-60",
        className
      )}
    >
      {dark ? sunIcon : moonIcon}
      {dark ? "Clair" : "Sombre"}
    </button>
  );
}
