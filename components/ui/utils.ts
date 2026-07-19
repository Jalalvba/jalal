import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Standard shadcn-style class merge — clsx for conditionals, tailwind-merge to resolve conflicting utility classes. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
