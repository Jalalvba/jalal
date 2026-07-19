import * as React from "react";
import { cn } from "@/components/ui/utils";

// h-11 (44px) floor, matching this app's already-correct primary-input sizing.
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";
