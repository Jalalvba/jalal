/**
 * Time-of-day default theme, used only when no explicit user preference has
 * ever been stored (see the inline no-flash script in app/layout.tsx, which
 * is the actual runtime consumer of this — this file exists so the cutoff
 * hours have one source of truth instead of being duplicated as magic
 * numbers inside a template-literal script string).
 */
export const LIGHT_START_HOUR = 7; // 7am
export const LIGHT_END_HOUR = 19; // 7pm

export function getTimeBasedTheme(date: Date = new Date()): "light" | "dark" {
  const hour = date.getHours();
  return hour >= LIGHT_START_HOUR && hour < LIGHT_END_HOUR ? "light" : "dark";
}
