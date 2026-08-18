import * as React from "react";
import { cn } from "@/lib/utils/cn";

// h-11 (44px) floor, matching this app's already-correct primary-input sizing.
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-xl border border-border bg-input px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-zinc-500",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";
