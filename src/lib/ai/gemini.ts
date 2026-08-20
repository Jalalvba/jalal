// The Gemini provider implementation: one hand-rolled fetch against the REST
// API, plus the normalization that turns its response into this module's
// CostInfo. No SDK — package.json carries no @google/generative-ai, which is
// deliberate (see docs/ai.md §1).
//
// EVERY Gemini call in this app goes through here — no route may fetch
// generativelanguage.googleapis.com directly. That's the whole point: cost
// tracking can't be skipped if there's only one door.

import { log, serializeError } from "@/lib/http/logger";
import { computeCallCost, detectAliasDrift } from "@/lib/ai/pricing";
import { claimFreeTierSlot, recordUsage, getRemainingCredit } from "@/lib/ai/usage";
import { AiCallError, type AiCallParams, type AiResult, type CostInfo } from "@/lib/ai/types";

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Returns the model's text alongside the cost breakdown for that same call, so
 * a route can pass costInfo straight into its own JSON response and the UI can
 * show it in the same round trip — no polling, no separate log fetch.
 *
 * Translating AiCallParams' neutral names into Gemini's wire names happens
 * here and nowhere else: systemPrompt -> systemInstruction, maxTokens ->
 * generationConfig.maxOutputTokens. That mapping is the reason callers do not
 * carry Gemini vocabulary.
 */
export async function callGemini(params: AiCallParams): Promise<AiResult> {
  const {
    action,
    model,
    prompt,
    systemPrompt,
    maxTokens,
    temperature,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    validate,
  } = params;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error(`[${action}] GEMINI_API_KEY is not set`);
    throw new AiCallError(500, "unconfigured");
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
          ...(systemPrompt
            ? { systemInstruction: { parts: [{ text: systemPrompt }] } }
            : {}),
          generationConfig: {
            ...(maxTokens !== undefined ? { maxOutputTokens: maxTokens } : {}),
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
      if (response.status === 429) throw new AiCallError(429, "rate-limited");
      if (response.status >= 500) throw new AiCallError(502, "upstream");
      throw new AiCallError(500, "upstream");
    }

    const data = await response.json();

    // Truncation is otherwise INVISIBLE: a response cut off at maxTokens comes
    // back HTTP 200 with valid-looking-but-incomplete text, which then fails
    // JSON.parse in a caller's validate() and surfaces as an opaque
    // "bad-response". Found live — three consecutive calls returned exactly
    // 896 output tokens against a 900 cap. Logged loudly so the next
    // occurrence names its own cause.
    const finishReason = data?.candidates?.[0]?.finishReason;
    if (finishReason === "MAX_TOKENS") {
      log("error", "gemini", "Response truncated at maxTokens — raise the caller's limit", {
        action,
        model,
        maxTokens,
      });
      throw new AiCallError(500, "bad-response");
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string" || !text.trim()) {
      console.error(`[${action}] Unexpected Gemini response shape:`, JSON.stringify(data));
      throw new AiCallError(500, "bad-response");
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
          `"${servedKey}" is new) are updated in src/lib/ai/pricing.ts.`
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

    const finalText = text.trim();

    // Caller-supplied validation runs AFTER the response arrives, because
    // Gemini's responseSchema steers generation rather than constraining the
    // decoder — see AiCallParams.validate. Deliberately placed after
    // recordUsage: the call was made and billed whether or not the output is
    // usable, so refusing to record it would understate real spend.
    if (validate && !validate(finalText)) {
      log("error", "gemini", "Response failed caller validation", { action, model });
      throw new AiCallError(500, "bad-response");
    }

    return { text: finalText, costInfo: { ...partial, remainingCreditUsd } };
  } catch (e) {
    if (e instanceof AiCallError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      log("error", "gemini", "Gemini request timed out", { action, timeoutMs });
      throw new AiCallError(504, "timeout");
    }
    log("error", "gemini", "Gemini request failed", { action, ...serializeError(e) });
    throw new AiCallError(500, "upstream");
  } finally {
    clearTimeout(timeout);
  }
}
