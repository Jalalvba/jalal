// Central Anthropic API call wrapper + cost tracking.
//
// EVERY Claude call in this app goes through callClaudeWithTracking() — no
// route may talk to the SDK directly. Same rule, same reason as
// src/lib/gemini/costTracker.ts: cost tracking can't be skipped if there's
// only one door.
//
// ── Why this is a separate module, not a shared one with Gemini ─────────────
// Deliberate (signed off 2026-08-19). The two providers share only ~40 lines
// (append an audit row, $inc a totals doc); everything that matters differs:
// Gemini has a free tier this app claims slots against, rolling "-latest"
// aliases needing drift detection, and its own usageMetadata field names.
// Anthropic has no free tier, no aliases, and reports cache tokens Gemini has
// no equivalent for. Abstracting across the two would produce a wrapper with
// provider-shaped holes. Revisit if a third provider arrives, or if one
// combined spend figure across providers is ever wanted — that's a migration
// of the existing gemini_usage documents, not a drive-by refactor.
//
// State lives in MongoDB for the same reason as the Gemini tracker: this app
// runs on Vercel, the filesystem is read-only apart from /tmp, and every
// invocation may land on a different instance.

import type Anthropic from "@anthropic-ai/sdk";
import { getCollection } from "@/lib/mongo/client";
import { getAnthropicClient, AnthropicUnconfiguredError } from "@/lib/anthropic/client";
import { USD_TO_MAD } from "@/lib/gemini/costTracker";

// ── Pricing ────────────────────────────────────────────────────────────────
// USD per 1M tokens. Verified 2026-08-19 against the Claude API model table.
// Cache reads bill at ~0.1x input, cache writes at ~1.25x input — modelled as
// multipliers rather than separate columns so adding a model stays one line.
// Extend by adding an entry; nothing else needs to change.
export const PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "claude-opus-5": { inputPer1M: 5.0, outputPer1M: 25.0 },
  "claude-sonnet-5": { inputPer1M: 3.0, outputPer1M: 15.0 },
  "claude-haiku-4-5": { inputPer1M: 1.0, outputPer1M: 5.0 },
};

const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

/** Token counts for one call, split so cached input can be priced correctly. */
export type ClaudeTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

/**
 * Paid cost of a single call. Returns 0 for an unknown model rather than
 * throwing — an untracked cost must never break a working feature — but logs
 * loudly, because a 0 here silently understates the real bill. Same contract
 * as the Gemini tracker's computeCallCost().
 */
export function computeCallCost(
  model: string,
  usage: ClaudeTokenUsage
): { usd: number; mad: number } {
  const price = PRICING[model];
  if (!price) {
    console.error(
      `[anthropic-cost] No PRICING entry for "${model}" — costing this call at 0. Add it to PRICING.`
    );
    return { usd: 0, mad: 0 };
  }
  const usd =
    (usage.inputTokens / 1_000_000) * price.inputPer1M +
    (usage.cacheReadTokens / 1_000_000) * price.inputPer1M * CACHE_READ_MULTIPLIER +
    (usage.cacheCreationTokens / 1_000_000) * price.inputPer1M * CACHE_WRITE_MULTIPLIER +
    (usage.outputTokens / 1_000_000) * price.outputPer1M;
  return { usd, mad: usd * USD_TO_MAD };
}

/** Per-model running totals. Keyed by the model string, same shape as the Gemini tracker's. */
type TotalsDoc = {
  _id: string; // model name
  total_calls: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
  total_cache_creation_tokens: number;
  total_cost_usd: number;
  total_cost_mad: number;
};

/** Cost breakdown returned alongside the model's output, for display in the UI. */
export type ClaudeCostInfo = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  costMad: number;
};

/**
 * Appends the audit record and folds the call into the per-model running
 * totals.
 *
 * Never throws: a bookkeeping failure must not fail the user's action, which
 * has already succeeded and cost money by this point. Failures are logged.
 */
async function recordUsage(action: string, costInfo: ClaudeCostInfo): Promise<void> {
  const entry = {
    provider: "anthropic" as const,
    timestamp: new Date().toISOString(),
    action,
    model: costInfo.model,
    input_tokens: costInfo.inputTokens,
    output_tokens: costInfo.outputTokens,
    cache_read_tokens: costInfo.cacheReadTokens,
    cache_creation_tokens: costInfo.cacheCreationTokens,
    cost_usd: costInfo.costUsd,
    cost_mad: costInfo.costMad,
  };

  // JSON-lines audit trail. On Vercel this is stdout only — Vercel's log drain
  // is the durable copy. The anthropic_usage collection below is the queryable
  // record. Same two-track approach as [gemini-usage].
  console.log(`[anthropic-usage] ${JSON.stringify(entry)}`);

  try {
    const log = await getCollection("anthropic_usage");
    await log.insertOne({ ...entry, timestamp: new Date() });
  } catch (e) {
    console.error("[anthropic-cost] Failed to append usage log entry", e);
  }

  try {
    const totals = await getCollection<TotalsDoc>("anthropic_usage_totals");
    await totals.updateOne(
      { _id: costInfo.model },
      {
        $inc: {
          total_calls: 1,
          total_input_tokens: costInfo.inputTokens,
          total_output_tokens: costInfo.outputTokens,
          total_cache_read_tokens: costInfo.cacheReadTokens,
          total_cache_creation_tokens: costInfo.cacheCreationTokens,
          total_cost_usd: costInfo.costUsd,
          total_cost_mad: costInfo.costMad,
        },
      },
      { upsert: true }
    );
  } catch (e) {
    console.error(`[anthropic-cost] Failed to update running totals for ${costInfo.model}`, e);
  }
}

// ── The wrapper ────────────────────────────────────────────────────────────

/** Thrown for any upstream failure. `status` is the HTTP status a route should return. */
export class ClaudeCallError extends Error {
  constructor(
    readonly status: number,
    readonly kind: "unconfigured" | "rate-limited" | "upstream" | "timeout" | "bad-response"
  ) {
    super(`Claude call failed: ${kind}`);
    this.name = "ClaudeCallError";
  }
}

export type ClaudeCallParams = {
  /** Short action name for the audit log, e.g. "complaint-playbook". */
  action: string;
  model: string;
  /** Cached as a stable prefix — put the frozen instructions here, not the data. */
  system: string;
  /** The volatile per-request content (the uploaded threads). */
  userContent: string;
  maxTokens: number;
  /** JSON Schema for a strict structured response. Omit for free-form text. */
  jsonSchema?: Record<string, unknown>;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 min — a long analysis run, not a chat turn

/**
 * The ONE entry point for calling Claude. Returns the model's text alongside
 * the cost breakdown for that same call, so a route can pass costInfo straight
 * into its own JSON response and the UI can show it in the same round trip —
 * exactly the contract callGeminiWithTracking() established.
 *
 * Streams rather than using a plain create(): this is a long-input, long-output
 * call with a large max_tokens, which the SDK requires streaming for to avoid
 * HTTP timeouts. .finalMessage() collapses the stream back to one message —
 * nothing is streamed on to the browser in this phase.
 */
export async function callClaudeWithTracking(
  params: ClaudeCallParams
): Promise<{ result: string; costInfo: ClaudeCostInfo }> {
  const {
    action,
    model,
    system,
    userContent,
    maxTokens,
    jsonSchema,
    effort = "high",
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = params;

  let client;
  try {
    client = getAnthropicClient();
  } catch (e) {
    if (e instanceof AnthropicUnconfiguredError) {
      console.error(`[${action}] ANTHROPIC_API_KEY is not set`);
      throw new ClaudeCallError(500, "unconfigured");
    }
    throw e;
  }

  try {
    const stream = client.messages.stream(
      {
        model,
        max_tokens: maxTokens,
        // Adaptive thinking: this is a judgement-heavy analysis, exactly the
        // workload it exists for. No budget_tokens — removed on this model.
        thinking: { type: "adaptive" },
        output_config: {
          effort,
          ...(jsonSchema ? { format: { type: "json_schema" as const, schema: jsonSchema } } : {}),
        },
        // The instructions are the stable prefix and the uploaded text is the
        // volatile part, so caching the system block makes a re-run over the
        // same file cheap. Order matters: system renders before messages.
        system: [{ type: "text" as const, text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user" as const, content: userContent }],
      },
      { timeout: timeoutMs }
    );

    const message = await stream.finalMessage();

    // A safety decline arrives as HTTP 200 with stop_reason "refusal", not as
    // a thrown error — checked before reading content, which would otherwise
    // be empty and look like a malformed response.
    if (message.stop_reason === "refusal") {
      console.error(
        `[${action}] Claude refused the request:`,
        JSON.stringify(message.stop_details ?? null)
      );
      throw new ClaudeCallError(422, "bad-response");
    }

    const text = message.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map(b => b.text)
      .join("");

    if (!text.trim()) {
      console.error(`[${action}] Empty Claude response (stop_reason: ${message.stop_reason})`);
      throw new ClaudeCallError(500, "bad-response");
    }

    // Hitting the cap truncates mid-structure, which for a JSON response means
    // unparseable output — worth its own error rather than a confusing parse
    // failure downstream.
    if (message.stop_reason === "max_tokens") {
      console.error(`[${action}] Response hit max_tokens (${maxTokens}) and was truncated`);
      throw new ClaudeCallError(500, "bad-response");
    }

    const costInfo: ClaudeCostInfo = {
      model,
      inputTokens: message.usage.input_tokens ?? 0,
      outputTokens: message.usage.output_tokens ?? 0,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: message.usage.cache_creation_input_tokens ?? 0,
      costUsd: 0,
      costMad: 0,
    };
    const { usd, mad } = computeCallCost(model, costInfo);
    costInfo.costUsd = usd;
    costInfo.costMad = mad;

    await recordUsage(action, costInfo);

    return { result: text.trim(), costInfo };
  } catch (e) {
    if (e instanceof ClaudeCallError) throw e;

    // Typed SDK errors, most specific first — never string-matched.
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    if (e instanceof Anthropic.AuthenticationError) {
      console.error(`[${action}] Anthropic rejected the API key`);
      throw new ClaudeCallError(500, "unconfigured");
    }
    if (e instanceof Anthropic.RateLimitError) {
      console.error(`[${action}] Anthropic rate-limited the request`);
      throw new ClaudeCallError(429, "rate-limited");
    }
    if (e instanceof Anthropic.APIConnectionTimeoutError) {
      console.error(`[${action}] Anthropic request timed out after ${timeoutMs}ms`);
      throw new ClaudeCallError(504, "timeout");
    }
    if (e instanceof Anthropic.APIError) {
      // Logged server-side only: upstream error bodies may carry detail we
      // don't want to promise as a stable client contract.
      console.error(`[${action}] Anthropic API error ${e.status}: ${e.message}`);
      throw new ClaudeCallError(e.status && e.status >= 500 ? 502 : 500, "upstream");
    }
    console.error(`[${action}] Claude request failed:`, e);
    throw new ClaudeCallError(500, "upstream");
  }
}
