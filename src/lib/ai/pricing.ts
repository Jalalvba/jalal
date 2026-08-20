// Pure pricing/quota math for Gemini calls. No I/O, no Mongo, no network —
// everything here is a deterministic function of its arguments plus two env
// vars, which is what keeps it cheap to unit-test (and why the usage-recording
// side lives in usage.ts instead).
//
// ── IMPORTANT: cost/tier numbers here are an ESTIMATE, not billing ──────────
// The Gemini API response does NOT tell us whether a call was served free or
// billed. That depends on our running count against Google's free-tier quota,
// which Google tracks server-side and does not expose. So the "free"/"paid"
// tier is inferred from a LOCAL counter of our own calls (see usage.ts). It
// drifts from reality whenever: calls are made outside this app on the same
// key, a request fails after being counted, or Google changes limits.
// Cross-check periodically against the real usage dashboard:
// https://aistudio.google.com/usage
// (free-tier limits themselves: https://aistudio.google.com/rate-limit)

// ── Pricing ────────────────────────────────────────────────────────────────
// USD per 1M tokens, paid tier, text in/out. Verified 2026-08-16 against
// https://ai.google.dev/gemini-api/docs/pricing — re-check when adding a model,
// and note that page flags a pricing transition on 2027-01-01 for Gemini 3.x.
// Extend by adding an entry; nothing else needs to change.
export const PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "gemini-3-5-flash-lite": { inputPer1M: 0.3, outputPer1M: 2.5 },
  "gemini-3-1-flash-lite": { inputPer1M: 0.25, outputPer1M: 1.5 },
  "gemini-3-5-flash": { inputPer1M: 1.5, outputPer1M: 9.0 },
  // Promotional rate, verified 2026-08-19 against the pricing page: $0.75/$3.75
  // "through December 31, 2026", doubling to $1.50/$7.50 on 2027-01-01. This
  // table has no time dimension, so THIS ENTRY MUST BE UPDATED on that date or
  // every gemini-3.7-flash call will be costed at half its real price.
  "gemini-3-7-flash": { inputPer1M: 0.75, outputPer1M: 3.75 },
  "gemini-2-5-flash": { inputPer1M: 0.3, outputPer1M: 2.5 },
  "gemini-2-5-flash-lite": { inputPer1M: 0.1, outputPer1M: 0.4 },
};

// Rolling "-latest" aliases have no pricing entry of their own and Google can
// swap what they point at without notice (see
// src/app/api/bdd/reformulate-comment/route.ts's header comment on why this app
// deliberately uses an alias). We resolve an alias to a concrete priced model
// for costing purposes only — the alias string is still what gets sent to the
// API, and is what's logged.
const MODEL_ALIASES: Record<string, string> = {
  // Verified live in production on 2026-08-16: a real call sent
  // "gemini-flash-lite-latest" and came back with modelVersion
  // "gemini-3.5-flash-lite" (alias_drift: false). Not an assumption — but it
  // can still change under us at any time, which is what detectAliasDrift()
  // below is for.
  "gemini-flash-lite-latest": "gemini-3-5-flash-lite",
  // Repointed 2026-08-19: detectAliasDrift() caught this live — a real call
  // sending "gemini-flash-latest" came back with modelVersion
  // "gemini-3.7-flash" while this table still said 3.5-flash, so those calls
  // were costed at 1.5/9.0 instead of 0.75/3.75. Exactly the drift the
  // mechanism exists to surface; the fix is to update the table, not to make
  // pricing follow servedModel automatically.
  "gemini-flash-latest": "gemini-3-7-flash",
};

/** Resolves aliases, then normalises "gemini-3.5-flash-lite" → "gemini-3-5-flash-lite". */
export function resolvePricingKey(model: string): string {
  const alias = MODEL_ALIASES[model];
  if (alias) return alias;
  return model.replace(/\./g, "-");
}

/**
 * Detects alias drift: whether the model that actually served the call matches
 * the one we assumed when pricing it.
 *
 * The response's top-level `modelVersion` field ("Output only. The model
 * version used to generate the response.", verified 2026-08-16 against
 * https://ai.google.dev/api/generate-content) is what makes this possible —
 * it's the only place Google tells us what a rolling "-latest" alias actually
 * resolved to on this request. Without it, MODEL_ALIASES is an unfalsifiable
 * guess that would keep costing calls at a stale price indefinitely after
 * Google reassigns the alias.
 *
 * A served version may carry a suffix the pricing key doesn't
 * ("gemini-3-5-flash-lite-preview-09-2025"), so this is a prefix match, not
 * equality. An absent modelVersion is not drift — just no evidence either way.
 */
export function detectAliasDrift(
  requestedModel: string,
  servedModelVersion: string | undefined
): { drifted: boolean; assumedKey: string; servedKey: string | null } {
  const assumedKey = resolvePricingKey(requestedModel);
  if (!servedModelVersion) return { drifted: false, assumedKey, servedKey: null };
  const servedKey = servedModelVersion.replace(/\./g, "-");
  return { drifted: !servedKey.startsWith(assumedKey), assumedKey, servedKey };
}

// Env-overridable so the rate can be corrected without a deploy. Falls back to
// 9.4 if unset or garbage.
function usdToMad(): number {
  const raw = Number(process.env.USD_TO_MAD_RATE);
  return Number.isFinite(raw) && raw > 0 ? raw : 9.4;
}

export const USD_TO_MAD = usdToMad();

/**
 * Paid-tier cost of a single call. Returns 0 for an unknown model rather than
 * throwing — an untracked cost must never break a working feature — but logs
 * loudly, because a 0 here silently understates the real bill.
 */
export function computeCallCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): { usd: number; mad: number } {
  const key = resolvePricingKey(model);
  const price = PRICING[key];
  if (!price) {
    console.error(
      `[gemini-cost] No PRICING entry for "${model}" (resolved "${key}") — costing this call at 0. Add it to PRICING.`
    );
    return { usd: 0, mad: 0 };
  }
  const usd =
    (inputTokens / 1_000_000) * price.inputPer1M + (outputTokens / 1_000_000) * price.outputPer1M;
  return { usd, mad: usd * usdToMad() };
}

// ── Free-tier quota ────────────────────────────────────────────────────────
// Google no longer publishes per-model free-tier limits in the docs — the
// rate-limits page now says limits "can be viewed in Google AI Studio" and
// links a per-account dashboard. These numbers were therefore read by the
// account owner from https://aistudio.google.com/rate-limit for the
// "avis-jalal" project on 2026-08-16. They are account-specific: re-check them
// there rather than trusting a docs page or this comment.
//
// Only RPD is enforced here. RPM is enforced upstream by Google (a burst gets a
// 429, which the caller already handles) and this app's own src/lib/http/rateLimit.ts
// caps each route well under it. TPM is recorded for visibility but not used to
// gate the tier, since token count isn't known until after the call returns.
export const FREE_TIER_LIMITS: Record<
  string,
  { rpm: number; tpm: number; rpd: number }
> = {
  "gemini-3-5-flash-lite": { rpm: 15, tpm: 250_000, rpd: 500 },
};

/**
 * Day key for quota bucketing. Google's docs are explicit that "Requests per
 * day (RPD) quotas reset at midnight Pacific time" — NOT midnight UTC, which is
 * the intuitive-but-wrong assumption. Intl handles PST/PDT so this stays
 * correct across DST changes.
 */
export function quotaDayKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
