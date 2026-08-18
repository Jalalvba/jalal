import { describe, expect, it, vi } from "vitest";

const mockRateLimitOrNull = vi.fn();
vi.mock("@/lib/http/rateLimit", () => ({ rateLimitOrNull: (...args: unknown[]) => mockRateLimitOrNull(...args) }));

import { GET } from "@/app/api/auth/google/route";

function req(): Request {
  return new Request("http://localhost/api/auth/google");
}

describe("GET /api/auth/google — rate limiting (M8)", () => {
  it("calls rateLimitOrNull before redirecting to Google", async () => {
    mockRateLimitOrNull.mockResolvedValue(null);

    const res = await GET(req());

    expect(mockRateLimitOrNull).toHaveBeenCalledWith(expect.anything(), "oauth-start", 30, 60_000);
    expect(res.status).toBe(307); // redirect to Google's consent screen
    expect(res.headers.get("location")).toContain("accounts.google.com");
  });

  it("returns the 429 from rateLimitOrNull directly when over budget, without hitting Google at all", async () => {
    const limitedResponse = new Response(JSON.stringify({ ok: false }), { status: 429 });
    mockRateLimitOrNull.mockResolvedValue(limitedResponse);

    const res = await GET(req());

    expect(res.status).toBe(429);
    expect(res.headers.get("location")).toBeNull(); // no redirect issued
  });
});
