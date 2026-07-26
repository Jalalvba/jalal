import * as React from "react";
import { cn } from "@/components/ui/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Red-highlighted state (RL/remplacement/attention-needed rows across the app). */
  highlighted?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, highlighted, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-xl border p-3.5",
        highlighted
          ? "border-red-500/40 bg-red-500/10"
          : "border-border bg-card",
        className
      )}
      {...props}
    />
  )
);
Card.displayName = "Card";
