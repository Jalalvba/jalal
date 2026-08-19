// Rough thread counter for uploaded complaint text.
//
// Shared by the upload page (to show a preview before submitting) and the
// route (to record it in the stored metadata), so it must stay free of Mongo
// and SDK imports — a client component importing either would pull the driver
// into the browser bundle.
//
// This is deliberately an ESTIMATE and is labelled as such in the UI. The real
// thread count comes back from the model in sourceSummary.threadsObserved,
// which reads the text rather than pattern-matching it. This exists only so
// the user can sanity-check they uploaded what they meant to.

/**
 * Counts likely email-header starts. Matches the common Gmail copy-paste
 * shapes in both French and English mailboxes — "De :"/"From:" at the start of
 * a line — plus the "---------- Message transféré ----------" separator.
 * Returns at least 1 for any non-empty input.
 */
export function estimateThreadCount(text: string): number {
  if (!text.trim()) return 0;

  const patterns = [
    /^\s*(?:de|from)\s*:/gim,
    /^\s*-{2,}\s*(?:message (?:transf[ée]r[ée]|d'origine)|forwarded message|original message)\s*-{2,}/gim,
  ];

  const matches = patterns.reduce((n, re) => n + (text.match(re)?.length ?? 0), 0);
  return Math.max(1, matches);
}
