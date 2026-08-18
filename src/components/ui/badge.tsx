import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

// Covers the common cases (add-result outcome tags, generic pill labels).
// Pages with per-value hardcoded colors (DS History's ETAT badges, Suivi
// RL's per-flag colors) pass their own className instead of a variant —
// those specific hex values are real data-driven distinctions, not
// something to force into a 4-way enum.
const badgeVariants = cva("inline-flex items-center gap-1 rounded-lg border px-1.5 py-0.5 text-xs font-medium", {
  variants: {
    variant: {
      success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
      warning: "border-amber-500/30 bg-amber-500/10 text-amber-400",
      error: "border-red-500/30 bg-red-500/10 text-red-400",
      neutral: "border-border bg-muted text-foreground",
    },
  },
  defaultVariants: { variant: "neutral" },
});

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
