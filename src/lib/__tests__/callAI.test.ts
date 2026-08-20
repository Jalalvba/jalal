import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mocked before importing the module under test (vitest hoists vi.mock() above
// imports) — same pattern as aiPricing.test.ts and rateLimit.test.ts.
//
// There is no Gemini SDK to mock: src/lib/ai/gemini.ts is a hand-rolled fetch
// against the REST API (deliberate — see docs/ai.md §1), so the seam is global
// fetch. The Mongo-backed usage side is stubbed out so these tests stay pure
// and never touch a database.
vi.mock("@/lib/ai/usage", () => ({
  claimFreeTierSlot: vi.fn().mockResolvedValue(true),
  recordUsage: vi.fn().mockResolvedValue(undefined),
  getRemainingCredit: vi.fn().mockResolvedValue(12.5),
}));

import { callAI, AiCallError } from "@/lib/ai";
import { claimFreeTierSlot, recordUsage } from "@/lib/ai/usage";

/** A minimal well-formed Gemini response body. */
function geminiOk(text: string, over: Record<string, unknown> = {}) {
  return {
    candidates: [{ content: { parts: [{ text }] } }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 },
    modelVersion: "gemini-3.5-flash-lite",
    ...over,
  };
}

function mockFetch(impl: () => unknown) {
  const fn = vi.fn().mockImplementation(async () => impl());
  vi.stubGlobal("fetch", fn);
  return fn;
}

const BASE = { action: "test", model: "gemini-flash-lite-latest", prompt: "hi" };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GEMINI_API_KEY = "test-key";
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("callAI — response normalization", () => {
  it("returns text plus a fully-populated costInfo, not the raw provider shape", async () => {
    mockFetch(() => ({ ok: true, json: async () => geminiOk("  bonjour  ") }));

    const res = await callAI(BASE);

    expect(res.text).toBe("bonjour"); // trimmed
    expect(res.costInfo).toMatchObject({
      model: "gemini-flash-lite-latest",
      servedModel: "gemini-3.5-flash-lite",
      pricedAs: "gemini-3-5-flash-lite",
      aliasDrift: false,
      tier: "free",
      inputTokens: 100,
      outputTokens: 20,
      remainingCreditUsd: 12.5,
    });
    // Nothing Gemini-shaped leaks to the caller.
    expect(res).not.toHaveProperty("candidates");
    expect(res).not.toHaveProperty("usageMetadata");
  });

  it("translates the neutral param names into Gemini's wire names", async () => {
    const fetchFn = mockFetch(() => ({ ok: true, json: async () => geminiOk("x") }));

    await callAI({ ...BASE, systemPrompt: "be terse", maxTokens: 42, temperature: 0.3 });

    const body = JSON.parse((fetchFn.mock.calls[0][1] as { body: string }).body);
    expect(body.systemInstruction).toEqual({ parts: [{ text: "be terse" }] });
    expect(body.generationConfig.maxOutputTokens).toBe(42);
    expect(body.generationConfig.temperature).toBe(0.3);
  });

  it("folds thinking tokens into output tokens — they bill at the output rate", async () => {
    mockFetch(() => ({
      ok: true,
      json: async () =>
        geminiOk("x", {
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 7 },
        }),
    }));

    const res = await callAI(BASE);
    expect(res.costInfo.outputTokens).toBe(12);
  });

  it("prices a paid call from the assumed alias, never from servedModel", async () => {
    vi.mocked(claimFreeTierSlot).mockResolvedValueOnce(false);
    // Served by a DIFFERENT, more expensive model than the alias table assumes.
    mockFetch(() => ({
      ok: true,
      json: async () => geminiOk("x", { modelVersion: "gemini-3.5-flash" }),
    }));

    const res = await callAI(BASE);

    expect(res.costInfo.aliasDrift).toBe(true);
    expect(res.costInfo.pricedAs).toBe("gemini-3-5-flash-lite"); // assumed, not served
    // 100/1M * 0.3 + 20/1M * 2.5 — the flash-lite rate, not flash's 1.5/9.0.
    expect(res.costInfo.costUsd).toBeCloseTo(0.00008, 10);
  });
});

describe("callAI — error handling", () => {
  it("throws unconfigured (500) when the API key is missing, without calling out", async () => {
    delete process.env.GEMINI_API_KEY;
    const fetchFn = mockFetch(() => ({ ok: true, json: async () => geminiOk("x") }));

    await expect(callAI(BASE)).rejects.toMatchObject({ kind: "unconfigured", status: 500 });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("maps upstream 429 to rate-limited (429)", async () => {
    mockFetch(() => ({ ok: false, status: 429, text: async () => "quota" }));
    await expect(callAI(BASE)).rejects.toMatchObject({ kind: "rate-limited", status: 429 });
  });

  it("maps upstream 5xx to 502 — their failure, not ours", async () => {
    mockFetch(() => ({ ok: false, status: 503, text: async () => "unavailable" }));
    await expect(callAI(BASE)).rejects.toMatchObject({ kind: "upstream", status: 502 });
  });

  it("maps other upstream 4xx to upstream (500)", async () => {
    mockFetch(() => ({ ok: false, status: 400, text: async () => "bad request" }));
    await expect(callAI(BASE)).rejects.toMatchObject({ kind: "upstream", status: 500 });
  });

  it("maps an aborted request to timeout (504)", async () => {
    mockFetch(() => {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    });
    await expect(callAI(BASE)).rejects.toMatchObject({ kind: "timeout", status: 504 });
  });

  it("detects a response truncated at maxTokens instead of failing opaquely", async () => {
    // Found live: three consecutive calls returned exactly 896 output tokens
    // against a 900 cap. Gemini answers HTTP 200 with valid-looking but
    // incomplete text, which then fails a caller's JSON.parse and surfaces as
    // an unexplained "bad-response". finishReason is the only signal.
    mockFetch(() => ({
      ok: true,
      json: async () => ({
        candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: '{"partial":' }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 900 },
      }),
    }));
    await expect(callAI(BASE)).rejects.toMatchObject({ kind: "bad-response", status: 500 });
  });

  it("does not treat a normal STOP finishReason as truncation", async () => {
    mockFetch(() => ({
      ok: true,
      json: async () => geminiOk("fine", { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "fine" }] } }] }),
    }));
    await expect(callAI(BASE)).resolves.toMatchObject({ text: "fine" });
  });

  it("rejects an empty or missing text part as bad-response", async () => {
    mockFetch(() => ({ ok: true, json: async () => geminiOk("   ") }));
    await expect(callAI(BASE)).rejects.toMatchObject({ kind: "bad-response", status: 500 });
  });

  it("throws AiCallError, so a route never sees a provider-specific error type", async () => {
    mockFetch(() => ({ ok: false, status: 429, text: async () => "" }));
    await expect(callAI(BASE)).rejects.toBeInstanceOf(AiCallError);
  });
});

describe("callAI — validate", () => {
  it("passes the text through when the validator accepts it", async () => {
    mockFetch(() => ({ ok: true, json: async () => geminiOk('{"ok":true}') }));

    const res = await callAI({
      ...BASE,
      validate: (t) => t.startsWith("{"),
    });

    expect(res.text).toBe('{"ok":true}');
  });

  it("raises bad-response when the validator rejects — schema steers, it does not guarantee", async () => {
    mockFetch(() => ({ ok: true, json: async () => geminiOk("not json at all") }));

    await expect(
      callAI({ ...BASE, validate: (t) => t.startsWith("{") })
    ).rejects.toMatchObject({ kind: "bad-response", status: 500 });
  });

  it("receives the TRIMMED text, the same value a successful call would return", async () => {
    mockFetch(() => ({ ok: true, json: async () => geminiOk("  padded  ") }));
    const validate = vi.fn().mockReturnValue(true);

    await callAI({ ...BASE, validate });

    expect(validate).toHaveBeenCalledWith("padded");
  });

  it("still records usage when validation fails — the call was billed either way", async () => {
    mockFetch(() => ({ ok: true, json: async () => geminiOk("nope") }));

    await expect(callAI({ ...BASE, validate: () => false })).rejects.toThrow();

    expect(recordUsage).toHaveBeenCalledOnce();
  });
});
