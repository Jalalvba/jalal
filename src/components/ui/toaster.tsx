"use client";

import { useTheme } from "next-themes";
import { Toaster as SonnerToaster } from "sonner";

// Thin wrapper so the toast theme follows next-themes' resolved class
// instead of sonner's own (unrelated) system-preference detection.
export function Toaster() {
  const { resolvedTheme } = useTheme();
  return (
    <SonnerToaster
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="bottom-right"
      richColors
      closeButton
    />
  );
}
