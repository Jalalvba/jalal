// The one place the Anthropic SDK client is constructed.
//
// Mirrors the "single door" rule src/lib/gemini/costTracker.ts established for
// Gemini: no route may construct its own client or call api.anthropic.com
// directly, because a call made outside callClaudeWithTracking() escapes cost
// tracking entirely and there is no way to notice after the fact.
//
// Separate from costTracker.ts (unlike the Gemini module, which fetches the
// REST endpoint inline) only because the SDK client is a real object worth
// building once per process rather than per call.

import Anthropic from "@anthropic-ai/sdk";

/** Thrown when ANTHROPIC_API_KEY is missing — mapped to a 500 by the caller. */
export class AnthropicUnconfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not set");
    this.name = "AnthropicUnconfiguredError";
  }
}

let cached: Anthropic | null = null;

/**
 * Returns the shared client, constructing it on first use.
 *
 * Deliberately lazy rather than a module-level `new Anthropic()`: the SDK
 * throws at construction when the key is absent, which would make merely
 * *importing* this module fail at build time on a deploy without the env var
 * set. src/lib/sheets/googleSheetsClient.ts learned this the hard way — see
 * vitest.config.mts's env block, which exists precisely because module-load
 * throws make otherwise-unrelated tests unimportable.
 */
export function getAnthropicClient(): Anthropic {
  if (cached) return cached;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AnthropicUnconfiguredError();

  cached = new Anthropic({ apiKey });
  return cached;
}
