// The Mongo-backed side of cost tracking: free-tier quota claiming, the usage
// audit trail, and the running totals the remaining-credit figure derives from.
//
// State lives in MongoDB, NOT in JSON/log files on disk. This app runs on
// Vercel: the filesystem is read-only apart from /tmp, and every invocation may
// land on a different instance, so a JSON counter or an appended log file would
// be lost and could not do a safe read-modify-write under concurrency. Mongo is
// the one store every invocation reaches identically, and src/lib/http/rateLimit.ts
// already establishes the atomic-$inc pattern used below.

import { getCollection } from "@/lib/mongo/client";
import { log, serializeError } from "@/lib/http/logger";
import { resolvePricingKey, FREE_TIER_LIMITS, quotaDayKey } from "@/lib/ai/pricing";
import type { CostInfo } from "@/lib/ai/types";

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
export async function claimFreeTierSlot(model: string): Promise<boolean> {
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
    log("error", "gemini-cost", "Mongo unreachable for quota check, assuming paid tier", {
      key,
      day,
      ...serializeError(e),
    });
    return false;
  }
}

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
export async function recordUsage(params: {
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
  //
  // NOT routed through src/lib/http/logger.ts: this shape is a de-facto
  // contract for anything parsing the drain, so it must stay byte-identical.
  console.log(`[gemini-usage] ${JSON.stringify(entry)}`);

  try {
    // Named usageCol, not `log`: the original shadowed the imported logger
    // here. Harmless (this scope uses console.error) but a footgun.
    const usageCol = await getCollection("gemini_usage");
    await usageCol.insertOne({ ...entry, timestamp: new Date(), total_tokens: totalTokens });
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
