"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/components/ui/utils";

// Sizes default to >=44px (h-11) for touch targets — the audit found the
// app's secondary icon buttons (refresh/delete/logout) undersized at
// px-2 py-1 (~24-28px), a real mis-tap risk on a workshop phone. "icon" here
// is a 40x40px minimum, "default" is the full 44px the primary inputs
// already correctly use.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-xl font-medium transition disabled:cursor-not-allowed disabled:opacity-40 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black",
  {
    variants: {
      variant: {
        default: "bg-zinc-100 text-zinc-900 hover:bg-white",
        secondary: "border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800",
        destructive: "border border-red-500/30 text-red-400 hover:bg-red-500/10",
        ghost: "text-zinc-400 hover:text-zinc-200",
      },
      size: {
        default: "h-11 px-4 text-sm",
        sm: "h-10 px-3 text-xs",
        icon: "h-10 w-10 shrink-0 text-sm",
      },
    },
    defaultVariants: { variant: "secondary", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
);
Button.displayName = "Button";
