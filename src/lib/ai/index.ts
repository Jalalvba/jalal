// The single entry point for AI calls. Application code imports callAI from
// here and nothing else from this module — that indirection is the whole seam.
// If a second provider is ever added, it slots in behind this file rather than
// at every call site.
//
// Today callAI IS the Gemini call. There is deliberately no provider field,
// registry, or selection layer: none of that can be designed honestly against
// a single provider, and building it now would be guessing at requirements
// that do not exist yet. What makes a second provider cheap later is not
// machinery here — it is that AiCallParams/AiResult/AiCallError in types.ts
// carry no Gemini vocabulary, so callers never need to change.

import { callGemini } from "@/lib/ai/gemini";
import type { AiCallParams, AiResult } from "@/lib/ai/types";

/** Call the model. Throws AiCallError on any upstream or validation failure. */
export function callAI(params: AiCallParams): Promise<AiResult> {
  return callGemini(params);
}

export { AiCallError } from "@/lib/ai/types";
export type { AiCallParams, AiResult, AiErrorKind, CostInfo } from "@/lib/ai/types";
export {
  PRICING,
  FREE_TIER_LIMITS,
  USD_TO_MAD,
  computeCallCost,
  detectAliasDrift,
  quotaDayKey,
  resolvePricingKey,
} from "@/lib/ai/pricing";
