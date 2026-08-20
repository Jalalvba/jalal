// Shared types for the AI module. Deliberately IMPORT-FREE: src/types/index.ts
// re-exports CostInfo from here so client components can type a costInfo field
// without pulling the Mongo driver into their import graph (which is what
// happened while these lived alongside the Mongo-backed usage code).

/**
 * Why the caller never sees a provider-specific failure: every upstream
 * problem is flattened into one of five kinds plus the HTTP status a route
 * should return. A route maps kinds to its own user-facing messages and never
 * inspects a raw API error.
 */
export type AiErrorKind =
  | "unconfigured"
  | "rate-limited"
  | "upstream"
  | "timeout"
  | "bad-response";

export class AiCallError extends Error {
  constructor(
    readonly status: number,
    readonly kind: AiErrorKind
  ) {
    super(`AI call failed: ${kind}`);
    this.name = "AiCallError";
  }
}

export type AiCallParams = {
  /** Short action name for the audit log, e.g. "bdd-reformulate". */
  action: string;
  model: string;
  prompt: string;
  /** Provider-neutral name for what Gemini calls systemInstruction. */
  systemPrompt?: string;
  /** Provider-neutral name for what Gemini calls maxOutputTokens. */
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /**
   * Optional post-call check on the model's output.
   *
   * There is deliberately no "strict mode" or grammar guarantee in this
   * interface, because no provider this module talks to offers one. Gemini's
   * responseSchema STEERS generation; it does not constrain the decoder, so a
   * response can still come back the wrong shape. Promising strictness here
   * would be a lie the caller then trusts.
   *
   * So: validation is something the caller opts into and this module runs
   * AFTER the response arrives. Returning false raises AiCallError with kind
   * "bad-response" — the same kind an unparseable response produces, because
   * from the caller's side they are the same failure: the model did not return
   * something usable.
   */
  validate?: (text: string) => boolean;
};

/** What every AI call returns, whatever produced it. */
export type AiResult = {
  text: string;
  costInfo: CostInfo;
};

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
