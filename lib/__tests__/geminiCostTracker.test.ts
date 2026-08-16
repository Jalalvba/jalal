import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mocked before importing the module under test (vitest hoists vi.mock()
// above imports) — same pattern as rateLimit.test.ts.
vi.mock("@/lib/mongo", () => ({
  getCollection: vi.fn(),
}));

import {
  computeCallCost,
  resolvePricingKey,
  quotaDayKey,
  PRICING,
  FREE_TIER_LIMITS,
} from "@/lib/gemini-cost-tracker";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("resolvePricingKey", () => {
  it("maps the rolling alias the routes actually send to a concrete priced model", () => {
    expect(resolvePricingKey("gemini-flash-lite-latest")).toBe("gemini-3-5-flash-lite");
    expect(PRICING[resolvePricingKey("gemini-flash-lite-latest")]).toBeDefined();
  });

  it("normalises dotted model names to the hyphenated PRICING keys", () => {
    expect(resolvePricingKey("gemini-3.5-flash-lite")).toBe("gemini-3-5-flash-lite");
  });

  it("passes an already-canonical name through unchanged", () => {
    expect(resolvePricingKey("gemini-3-1-flash-lite")).toBe("gemini-3-1-flash-lite");
  });
});

describe("computeCallCost", () => {
  it("prices a call at the published per-1M rates", () => {
    // 1M in + 1M out on 3-5-flash-lite = $0.30 + $2.50.
    const { usd } = computeCallCost("gemini-3-5-flash-lite", 1_000_000, 1_000_000);
    expect(usd).toBeCloseTo(2.8, 10);
  });

  it("converts to MAD at the env-configured rate", () => {
    process.env.USD_TO_MAD_RATE = "10";
    // USD_TO_MAD_RATE is read per-call by computeCallCost, so this takes
    // effect without re-importing the module.
    const { usd, mad } = computeCallCost("gemini-3-1-flash-lite", 1_000_000, 0);
    expect(usd).toBeCloseTo(0.25, 10);
    expect(mad).toBeCloseTo(2.5, 10);
  });

  it("falls back to 9.4 MAD/USD when the rate is unset or unparseable", () => {
    delete process.env.USD_TO_MAD_RATE;
    expect(computeCallCost("gemini-3-1-flash-lite", 1_000_000, 0).mad).toBeCloseTo(2.35, 10);
    process.env.USD_TO_MAD_RATE = "not-a-number";
    expect(computeCallCost("gemini-3-1-flash-lite", 1_000_000, 0).mad).toBeCloseTo(2.35, 10);
  });

  it("returns 0 rather than throwing for a model with no PRICING entry", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(computeCallCost("gemini-does-not-exist", 1000, 1000)).toEqual({ usd: 0, mad: 0 });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("scales linearly for a realistic small call", () => {
    const { usd } = computeCallCost("gemini-3-5-flash-lite", 340, 512);
    expect(usd).toBeCloseTo((340 * 0.3 + 512 * 2.5) / 1_000_000, 12);
  });
});

describe("quotaDayKey", () => {
  // Google resets RPD at midnight PACIFIC, not UTC — these two cases are
  // exactly the window where a naive UTC implementation would be wrong.
  it("still counts 23:00 PST as the previous day, though it is already tomorrow in UTC", () => {
    // 2026-01-16T06:00Z = 2026-01-15 22:00 PST.
    expect(quotaDayKey(new Date("2026-01-16T06:00:00Z"))).toBe("2026-01-15");
  });

  it("rolls over at midnight Pacific during DST (PDT, UTC-7)", () => {
    // 2026-08-16T06:59Z = 2026-08-15 23:59 PDT; one minute later is the 16th.
    expect(quotaDayKey(new Date("2026-08-16T06:59:00Z"))).toBe("2026-08-15");
    expect(quotaDayKey(new Date("2026-08-16T07:00:00Z"))).toBe("2026-08-16");
  });
});

describe("FREE_TIER_LIMITS", () => {
  // Read from the AI Studio dashboard for the avis-jalal project on
  // 2026-08-16 — account-specific, so this test guards against silent edits
  // rather than asserting anything Google publishes.
  it("carries the dashboard-sourced limits for the model the app uses", () => {
    expect(FREE_TIER_LIMITS["gemini-3-5-flash-lite"]).toEqual({
      rpm: 15,
      tpm: 250_000,
      rpd: 500,
    });
  });

  it("has an entry for whatever the routes' rolling alias resolves to", () => {
    expect(FREE_TIER_LIMITS[resolvePricingKey("gemini-flash-lite-latest")]).toBeDefined();
  });
});
