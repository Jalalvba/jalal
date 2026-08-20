// Shared types for the AI module. Deliberately IMPORT-FREE: src/types/index.ts
// re-exports CostInfo from here so client components can type a costInfo field
// without pulling the Mongo driver into their import graph (which is what
// happened while these lived alongside the Mongo-backed usage code).

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
