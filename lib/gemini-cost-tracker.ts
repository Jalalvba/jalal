// Central Gemini API call wrapper + cost tracking.
//
// EVERY Gemini call in this app goes through callGeminiWithTracking() — no
// route may fetch generativelanguage.googleapis.com directly. That's the whole
// point: cost tracking can't be skipped if there's only one door.
//
// ── IMPORTANT: cost/tier numbers here are an ESTIMATE, not billing ──────────
// The Gemini API response does NOT tell us whether a call was served free or
// billed. That depends on our running count against Google's free-tier quota,
// which Google tracks server-side and does not expose. So the "free"/"paid"
// tier below is inferred from a LOCAL counter of our own calls. It drifts from
// reality whenever: calls are made outside this app on the same key, a request
// fails after being counted, or Google changes limits. Cross-check periodically
// against the real usage dashboard: https://aistudio.google.com/usage
// (free-tier limits themselves: https://aistudio.google.com/rate-limit)
//
// State lives in MongoDB, NOT in JSON/log files on disk. This app runs on
// Vercel: the filesystem is read-only apart from /tmp, and every invocation may
// land on a different instance, so a JSON counter or an appended log file would
// be lost and could not do a safe read-modify-write under concurrency. Mongo is
// the one store every invocation reaches identically, and lib/rateLimit.ts
// already establishes the atomic-$inc pattern used below.

import { getCollection } from "@/lib/mongo";

// ── Pricing ────────────────────────────────────────────────────────────────
// USD per 1M tokens, paid tier, text in/out. Verified 2026-08-16 against
// https://ai.google.dev/gemini-api/docs/pricing — re-check when adding a model,
// and note that page flags a pricing transition on 2027-01-01 for Gemini 3.x.
// Extend by adding an entry; nothing else needs to change.
export const PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "gemini-3-5-flash-lite": { inputPer1M: 0.3, outputPer1M: 2.5 },
  "gemini-3-1-flash-lite": { inputPer1M: 0.25, outputPer1M: 1.5 },
  "gemini-3-5-flash": { inputPer1M: 1.5, outputPer1M: 9.0 },
  "gemini-2-5-flash": { inputPer1M: 0.3, outputPer1M: 2.5 },
  "gemini-2-5-flash-lite": { inputPer1M: 0.1, outputPer1M: 0.4 },
};

// Rolling "-latest" aliases have no pricing entry of their own and Google can
// swap what they point at without notice (see app/api/generate-email/route.ts's
// header comment on why this app deliberately uses an alias). We resolve an
// alias to a concrete priced model for costing purposes only — the alias string
// is still what gets sent to the API, and is what's logged.
const MODEL_ALIASES: Record<string, string> = {
  "gemini-flash-lite-latest": "gemini-3-5-flash-lite",
  "gemini-flash-latest": "gemini-3-5-flash",
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
// 429, which the caller already handles) and this app's own lib/rateLimit.ts
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

type QuotaDoc = { _id: string; count: number; tokens: number; expiresAt: Date };
type TotalsDoc = {
  _id: string; // pricing-key model name
  total_calls: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  total_cost_mad: number;
};

/**
 * Atomically claims one slot in today's free-tier budget and reports whether
 * this call is still inside it. Counted BEFORE the API call, so a call that
 * later fails still consumes a slot — deliberately pessimistic: over-counting
 * makes us guess "paid" too early (harmless over-estimate), under-counting
 * would silently report costs as free.
 *
 * Fails PESSIMISTIC on a Mongo outage: returns "paid", so an unreachable
 * counter never causes a cost to be reported as free. Unlike rateLimit.ts this
 * never blocks the call itself.
 */
async function claimFreeTierSlot(model: string): Promise<boolean> {
  const key = resolvePricingKey(model);
  const limit = FREE_TIER_LIMITS[key]?.rpd;
  if (limit === undefined) {
    console.warn(`[gemini-cost] No FREE_TIER_LIMITS entry for "${key}" — assuming paid tier.`);
    return false;
  }

  const day = quotaDayKey();
  try {
    const col = await getCollection<QuotaDoc>("gemini_quota");
    const doc = await col.findOneAndUpdate(
      { _id: `${key}:${day}` },
      {
        $inc: { count: 1 },
        // Two-day cushion so the doc outlives the Pacific day it counts,
        // whatever the server's own timezone. Expired by a TTL index on
        // expiresAt (see scripts/add-indexes.ts).
        $setOnInsert: { expiresAt: new Date(Date.now() + 2 * 86_400_000), tokens: 0 },
      },
      { upsert: true, returnDocument: "after" }
    );
    return (doc?.count ?? Number.MAX_SAFE_INTEGER) <= limit;
  } catch (e) {
    console.error(`[gemini-cost] Mongo unreachable for quota ${key}:${day}, assuming paid`, e);
    return false;
  }
}

// ── Persistence ────────────────────────────────────────────────────────────

export type CostInfo = {
  /** The model string we SENT — may be a rolling alias like "gemini-flash-lite-latest". */
  model: string;
  /**
   * The concrete model that actually SERVED the call, from the response's
   * `modelVersion`. Undefined if the API omitted it. When `model` is an alias,
   * this is the only way to see what it resolved to.
   */
  servedModel?: string;
  /** The PRICING key the cost below was actually computed from. */
  pricedAs: string;
  /** True when servedModel doesn't match pricedAs — the quoted cost is suspect. */
  aliasDrift: boolean;
  tier: "free" | "paid";
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costMad: number;
  /** Prepaid balance after this call. Unchanged from the current balance on a free-tier call. */
  remainingCreditUsd: number;
};

/** Starting prepaid balance, in USD. The running balance is this minus recorded paid spend. */
function startingCreditUsd(): number {
  const raw = Number(process.env.GEMINI_PREPAID_USD_BALANCE);
  return Number.isFinite(raw) ? raw : 0;
}

/**
 * Remaining prepaid credit = configured starting balance minus every paid-tier
 * dollar recorded in gemini_usage_totals. Derived, never stored as its own
 * mutable number — that keeps one source of truth (per requirement 4) and means
 * correcting the starting balance env var re-bases the figure correctly instead
 * of compounding drift. Same value the wrapper returns as
 * costInfo.remainingCreditUsd.
 */
export async function getRemainingCredit(): Promise<number> {
  try {
    const col = await getCollection<TotalsDoc>("gemini_usage_totals");
    const docs = await col.find({}).toArray();
    const spent = docs.reduce((sum, d) => sum + (d.total_cost_usd ?? 0), 0);
    return startingCreditUsd() - spent;
  } catch (e) {
    console.error("[gemini-cost] Could not read totals for remaining credit", e);
    return startingCreditUsd();
  }
}

/**
 * Appends the audit record and folds the call into the per-model running
 * totals. Free-tier calls are recorded too (with zero cost) so call/token
 * counts stay complete — only the money columns stay at 0.
 *
 * Never throws: a bookkeeping failure must not fail the user's action, which
 * has already succeeded and cost money by this point. Failures are logged.
 */
async function recordUsage(params: {
  action: string;
  model: string;
  costInfo: Omit<CostInfo, "remainingCreditUsd">;
  totalTokens: number;
}): Promise<void> {
  const { action, model, costInfo, totalTokens } = params;
  const key = resolvePricingKey(model);
  const entry = {
    timestamp: new Date().toISOString(),
    action,
    model,
    // Recorded on every line, not just drifting ones, so the log answers
    // "when did this alias change?" retrospectively — a drift warning only
    // fires once you notice it, but the history is always there.
    served_model: costInfo.servedModel ?? null,
    priced_as: costInfo.pricedAs,
    alias_drift: costInfo.aliasDrift,
    input_tokens: costInfo.inputTokens,
    output_tokens: costInfo.outputTokens,
    tier: costInfo.tier,
    cost_usd: costInfo.costUsd,
    cost_mad: costInfo.costMad,
  };

  // JSON-lines audit trail. On Vercel this is stdout only — Vercel's log drain
  // is the durable copy, since there's no writable persistent disk. The
  // gemini_usage collection below is the queryable record.
  console.log(`[gemini-usage] ${JSON.stringify(entry)}`);

  try {
    const log = await getCollection("gemini_usage");
    await log.insertOne({ ...entry, timestamp: new Date(), total_tokens: totalTokens });
  } catch (e) {
    console.error("[gemini-cost] Failed to append usage log entry", e);
  }

  try {
    const totals = await getCollection<TotalsDoc>("gemini_usage_totals");
    await totals.updateOne(
      { _id: key },
      {
        $inc: {
          total_calls: 1,
          total_input_tokens: costInfo.inputTokens,
          total_output_tokens: costInfo.outputTokens,
          total_cost_usd: costInfo.costUsd,
          total_cost_mad: costInfo.costMad,
        },
      },
      { upsert: true }
    );
  } catch (e) {
    console.error(`[gemini-cost] Failed to update running totals for ${key}`, e);
  }
}

// ── The wrapper ────────────────────────────────────────────────────────────

/** Thrown for any upstream failure. `status` is the HTTP status a route should return. */
export class GeminiCallError extends Error {
  constructor(
    readonly status: number,
    readonly kind: "unconfigured" | "rate-limited" | "upstream" | "timeout" | "bad-response"
  ) {
    super(`Gemini call failed: ${kind}`);
    this.name = "GeminiCallError";
  }
}

export type GeminiCallParams = {
  /** Short action name for the audit log, e.g. "bdd-reformulate". */
  action: string;
  model: string;
  prompt: string;
  systemInstruction?: string;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * The ONE entry point for calling Gemini. Returns the model's text alongside
 * the cost breakdown for that same call, so a route can pass costInfo straight
 * into its own JSON response and the UI can show it in the same round trip —
 * no polling, no separate log fetch.
 */
export async function callGeminiWithTracking(
  params: GeminiCallParams
): Promise<{ result: string; costInfo: CostInfo }> {
  const {
    action,
    model,
    prompt,
    systemInstruction,
    maxOutputTokens,
    temperature,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = params;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error(`[${action}] GEMINI_API_KEY is not set`);
    throw new GeminiCallError(500, "unconfigured");
  }

  // Claimed before the request so concurrent calls can't both think they're the
  // last free one. See claimFreeTierSlot's note on the deliberate pessimism.
  const isFree = await claimFreeTierSlot(model);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          ...(systemInstruction
            ? { systemInstruction: { parts: [{ text: systemInstruction }] } }
            : {}),
          generationConfig: {
            ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
            ...(temperature !== undefined ? { temperature } : {}),
          },
        }),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      // Logged server-side only, never returned to the client as-is — Gemini
      // error bodies don't carry our key (it's a request header) but may carry
      // detail we don't want to promise as a stable client contract.
      const rawText = await response.text().catch(() => "");
      console.error(`[${action}] Gemini API returned ${response.status}: ${rawText}`);
      if (response.status === 429) throw new GeminiCallError(429, "rate-limited");
      if (response.status >= 500) throw new GeminiCallError(502, "upstream");
      throw new GeminiCallError(500, "upstream");
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string" || !text.trim()) {
      console.error(`[${action}] Unexpected Gemini response shape:`, JSON.stringify(data));
      throw new GeminiCallError(500, "bad-response");
    }

    // Token usage field names verified 2026-08-16 against
    // https://ai.google.dev/api/generate-content (GenerateContentResponse ->
    // usageMetadata). promptTokenCount is the total effective prompt size
    // (cached content included). thoughtsTokenCount is separate from
    // candidatesTokenCount for thinking models but IS billed at the output
    // rate, so it's added in rather than dropped — omitting it under-reports
    // cost on any thinking-capable model. Defaults to 0 if a field is absent
    // rather than producing NaN downstream.
    const usage = data?.usageMetadata ?? {};
    const inputTokens = Number(usage.promptTokenCount) || 0;
    const outputTokens =
      (Number(usage.candidatesTokenCount) || 0) + (Number(usage.thoughtsTokenCount) || 0);
    const totalTokens = Number(usage.totalTokenCount) || inputTokens + outputTokens;

    // What actually served the call. For a rolling "-latest" alias this is the
    // only signal that Google has repointed it at a differently-priced model.
    const servedModel = typeof data?.modelVersion === "string" ? data.modelVersion : undefined;
    const { drifted, assumedKey, servedKey } = detectAliasDrift(model, servedModel);
    if (drifted) {
      // Loud, because every cost figure for this model is wrong until
      // MODEL_ALIASES/PRICING is updated — and nothing else would surface it.
      console.error(
        `[gemini-cost] ALIAS DRIFT: "${model}" was priced as "${assumedKey}" but was served by ` +
          `"${servedKey}". Costs for this model are wrong until MODEL_ALIASES (and PRICING, if ` +
          `"${servedKey}" is new) are updated in lib/gemini-cost-tracker.ts.`
      );
    }

    // Pricing deliberately still follows the assumed key, not servedKey: a
    // silent switch to the served model's price would hide the drift that this
    // figure's mismatch is meant to expose. Fix the table, don't auto-adapt.
    const { usd, mad } = isFree
      ? { usd: 0, mad: 0 }
      : computeCallCost(model, inputTokens, outputTokens);

    const partial: Omit<CostInfo, "remainingCreditUsd"> = {
      model,
      servedModel,
      pricedAs: assumedKey,
      aliasDrift: drifted,
      tier: isFree ? "free" : "paid",
      inputTokens,
      outputTokens,
      costUsd: usd,
      costMad: mad,
    };

    await recordUsage({ action, model, costInfo: partial, totalTokens });

    // Read after recording so the figure already reflects this call.
    const remainingCreditUsd = await getRemainingCredit();

    return { result: text.trim(), costInfo: { ...partial, remainingCreditUsd } };
  } catch (e) {
    if (e instanceof GeminiCallError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      console.error(`[${action}] Gemini request timed out after ${timeoutMs}ms`);
      throw new GeminiCallError(504, "timeout");
    }
    console.error(`[${action}] Gemini request failed:`, e);
    throw new GeminiCallError(500, "upstream");
  } finally {
    clearTimeout(timeout);
  }
}
