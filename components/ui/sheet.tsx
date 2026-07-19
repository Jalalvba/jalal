"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/components/ui/utils";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export function SheetContent({
  className,
  children,
  side = "right",
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { side?: "right" | "left" }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out" />
      <DialogPrimitive.Content
        className={cn(
          "fixed inset-y-0 z-50 flex w-full max-w-sm flex-col border-zinc-700 bg-zinc-950 shadow-2xl focus:outline-none",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          side === "right"
            ? "right-0 border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right"
            : "left-0 border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left",
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300">
          <X className="h-4 w-4" />
          <span className="sr-only">Fermer</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "sticky top-0 flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-4 py-3 pr-12",
        className
      )}
      {...props}
    />
  );
}

export const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-sm font-semibold text-zinc-100", className)} {...props} />
));
SheetTitle.displayName = "SheetTitle";

export function SheetBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex-1 overflow-y-auto p-4", className)} {...props} />;
}
