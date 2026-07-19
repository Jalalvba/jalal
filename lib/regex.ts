// Escapes MongoDB/JS regex metacharacters in user-supplied search input before
// it's interpolated into a $regex filter. Skipping this lets a crafted input
// (e.g. nested quantifiers) trigger catastrophic backtracking (ReDoS) or match
// unintended data via regex injection.
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
