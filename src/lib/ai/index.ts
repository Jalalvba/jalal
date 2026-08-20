// The single entry point for AI calls. Application code imports from here and
// nothing else in this module — that indirection is the whole seam: if a second
// provider is ever added, it slots in behind this file rather than at every
// call site.
//
// Today it forwards straight to the Gemini implementation. There is
// deliberately no provider field, registry, or selection layer: none of that
// can be designed honestly against a single provider, and building it now would
// be guessing at requirements that do not exist yet.

export { callGeminiWithTracking } from "@/lib/ai/gemini";
export { GeminiCallError } from "@/lib/ai/types";
export type { CostInfo, GeminiCallParams } from "@/lib/ai/types";
export {
  PRICING,
  FREE_TIER_LIMITS,
  USD_TO_MAD,
  computeCallCost,
  detectAliasDrift,
  quotaDayKey,
  resolvePricingKey,
} from "@/lib/ai/pricing";
