import { describe, expect, it, vi } from "vitest";

const mockRateLimitOrNull = vi.fn();
vi.mock("@/lib/rateLimit", () => ({ rateLimitOrNull: (...args: unknown[]) => mockRateLimitOrNull(...args) }));

// next/headers' cookies() needs a real Next.js request-scoped context that
// calling a route handler directly (outside an actual request) doesn't
// provide — same reasoning every other route test in this suite mocks its
// own boundary dependencies rather than fighting the framework's context
// requirements. Minimal fake: just enough surface for this route's own
// cookieStore.get()/delete() calls.
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: () => undefined,
    delete: () => {},
  }),
}));

import { GET } from "@/app/api/auth/google/callback/route";

function req(qs = ""): Request {
  return new Request(`http://localhost/api/auth/google/callback${qs}`);
}

describe("GET /api/auth/google/callback — rate limiting (M8)", () => {
  it("calls rateLimitOrNull before doing anything else", async () => {
    mockRateLimitOrNull.mockResolvedValue(null);

    // No code/state at all -> falls through to the "?error=state" redirect
    // branch, which is fine — the point here is only that rateLimitOrNull
    // was consulted first.
    const res = await GET(req());

    expect(mockRateLimitOrNull).toHaveBeenCalledWith(expect.anything(), "oauth-callback", 30, 60_000);
    expect(res.status).toBe(307);
  });

  it("returns the 429 from rateLimitOrNull directly when over budget, without touching cookies/Google at all", async () => {
    const limitedResponse = new Response(JSON.stringify({ ok: false }), { status: 429 });
    mockRateLimitOrNull.mockResolvedValue(limitedResponse);

    const res = await GET(req("?code=abc&state=xyz"));

    expect(res.status).toBe(429);
  });
});
