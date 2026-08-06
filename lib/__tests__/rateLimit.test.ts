import { describe, expect, it, vi, beforeEach } from "vitest";

// Mocked before importing the module under test (vitest hoists vi.mock()
// above imports).
vi.mock("@/lib/mongo", () => ({
  getCollection: vi.fn(),
}));

import { getCollection } from "@/lib/mongo";
import { checkRateLimit, rateLimitOrNull, clientIp } from "@/lib/rateLimit";

const mockedGetCollection = vi.mocked(getCollection);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkRateLimit — fails open on Mongo failure", () => {
  // This is the exact regression this test locks in: a MongoNetworkError/
  // MongoServerSelectionError from the rate_limits collection used to
  // propagate uncaught through here, through rateLimitOrNull's un-try/
  // caught call site, into a raw unhandled 500 on every rate-limited route
  // — confirmed as the real root cause of the BDD export 500 via Vercel's
  // production runtime-error logs (14+ routes hit by the same failure
  // class). If this test ever fails, that outage mode is back.
  it("Mongo throwing entirely results in the request being allowed, not an uncaught exception", async () => {
    mockedGetCollection.mockRejectedValue(new Error("MongoServerSelectionError: Server selection timed out"));

    const result = await checkRateLimit("bdd-export", "1.2.3.4", 20, 60_000);

    expect(result).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("the Mongo operation itself (not just the connection) throwing also fails open", async () => {
    mockedGetCollection.mockResolvedValue({
      findOneAndUpdate: () => Promise.reject(new Error("MongoNetworkError: connection 1 closed")),
    } as never);

    const result = await checkRateLimit("bdd-export", "1.2.3.4", 20, 60_000);

    expect(result).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });
});

describe("checkRateLimit — normal operation", () => {
  it("allows the request when the window count is at or below the limit", async () => {
    mockedGetCollection.mockResolvedValue({
      findOneAndUpdate: () => Promise.resolve({ count: 5 }),
    } as never);

    const result = await checkRateLimit("bdd-update", "1.2.3.4", 5, 60_000);

    expect(result.allowed).toBe(true);
  });

  it("blocks the request once the window count exceeds the limit, with a positive retry-after", async () => {
    mockedGetCollection.mockResolvedValue({
      findOneAndUpdate: () => Promise.resolve({ count: 6 }),
    } as never);

    const result = await checkRateLimit("bdd-update", "1.2.3.4", 5, 60_000);

    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("a missing findOneAndUpdate result (defensive null) is treated as count 1, not a crash", async () => {
    mockedGetCollection.mockResolvedValue({
      findOneAndUpdate: () => Promise.resolve(null),
    } as never);

    const result = await checkRateLimit("bdd-update", "1.2.3.4", 5, 60_000);

    expect(result.allowed).toBe(true);
  });
});

describe("rateLimitOrNull", () => {
  function req(headers: Record<string, string> = {}) {
    return new Request("http://localhost/api/test", { headers });
  }

  it("returns null (proceed) when allowed", async () => {
    mockedGetCollection.mockResolvedValue({
      findOneAndUpdate: () => Promise.resolve({ count: 1 }),
    } as never);

    const result = await rateLimitOrNull(req(), "test-route", 5, 60_000);

    expect(result).toBeNull();
  });

  it("returns a 429 JSON response with a Retry-After header when over budget", async () => {
    mockedGetCollection.mockResolvedValue({
      findOneAndUpdate: () => Promise.resolve({ count: 999 }),
    } as never);

    const result = await rateLimitOrNull(req(), "test-route", 5, 60_000);

    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
    expect(result!.headers.get("Retry-After")).toBeTruthy();
    const body = await result!.json();
    expect(body.ok).toBe(false);
  });

  it("returns null (never crashes the caller) when Mongo is unreachable — the BDD export regression, at the wrapper level", async () => {
    mockedGetCollection.mockRejectedValue(new Error("MongoNetworkTimeoutError: Socket 'secureConnect' timed out"));

    const result = await rateLimitOrNull(req(), "bdd-export", 20, 5 * 60_000);

    expect(result).toBeNull();
  });
});

describe("clientIp", () => {
  it("prefers the first x-forwarded-for entry over x-real-ip", () => {
    const req = new Request("http://localhost/api/test", {
      headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1", "x-real-ip": "8.8.8.8" },
    });
    expect(clientIp(req)).toBe("9.9.9.9");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const req = new Request("http://localhost/api/test", { headers: { "x-real-ip": "8.8.8.8" } });
    expect(clientIp(req)).toBe("8.8.8.8");
  });

  it("falls back to 'unknown' when neither header is present", () => {
    const req = new Request("http://localhost/api/test");
    expect(clientIp(req)).toBe("unknown");
  });
});
