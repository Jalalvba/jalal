import * as React from "react";
import { cn } from "@/components/ui/utils";

/**
 * Shared inline error banner. Replaces 7 near-identical inline blocks
 * (Parking/Atelier/Depot/Suivi RL/Articles/DS History/Login), 4 of which
 * were hardcoded to dark-mode-only reds with no `dark:` variant — a real
 * light-mode legibility bug, not just markup duplication.
 */
export const Alert = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      role="alert"
      className={cn(
        "rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300",
        className
      )}
      {...props}
    />
  )
);
Alert.displayName = "Alert";
