import { describe, expect, it, vi, beforeEach } from "vitest";

// Test-suite gap #4 (per the audit): confirms a non-AUTHORIZED_EMAIL Google
// account is rejected, not logged in. Mutation-tested by the audit itself
// (replacing the AUTHORIZED_EMAIL check with `if (false)` left all 76
// pre-existing tests green) — this closes that gap.

vi.mock("@/lib/http/rateLimit", () => ({ rateLimitOrNull: vi.fn().mockResolvedValue(null) }));

// vi.mock() factories are hoisted above imports/top-level code — anything
// they reference must itself be declared via vi.hoisted() so it exists by
// the time the factories run.
const { mockCookieStore, fakeSession, mockSessionSave, mockGetToken, mockVerifyIdToken } = vi.hoisted(() => {
  const mockSessionSave = vi.fn();
  return {
    mockCookieStore: { get: vi.fn(), delete: vi.fn() },
    fakeSession: { isLoggedIn: false, save: mockSessionSave } as { isLoggedIn: boolean; save: () => Promise<void> },
    mockSessionSave,
    mockGetToken: vi.fn(),
    mockVerifyIdToken: vi.fn(),
  };
});

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue(mockCookieStore),
}));

vi.mock("iron-session", () => ({
  getIronSession: vi.fn().mockImplementation(async () => fakeSession),
}));

vi.mock("@/lib/auth/googleOAuth", () => ({
  getOAuthClient: vi.fn().mockReturnValue({
    getToken: (...args: unknown[]) => mockGetToken(...args),
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  }),
  getRedirectUri: vi.fn().mockReturnValue("http://localhost:3000/api/auth/google/callback"),
  AUTHORIZED_EMAIL: "chafiq.jalal@gmail.com",
}));

import { GET } from "@/app/api/auth/google/callback/route";

function req(): Request {
  return new Request(
    "http://localhost:3000/api/auth/google/callback?code=real-code&state=matching-state"
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeSession.isLoggedIn = false;
  mockCookieStore.get.mockReturnValue({ value: "matching-state" });
  mockGetToken.mockResolvedValue({ tokens: { id_token: "fake-id-token" } });
});

describe("GET /api/auth/google/callback — AUTHORIZED_EMAIL enforcement", () => {
  it("a verified email that is NOT the authorized account is rejected — no session created", async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: "someone-else@gmail.com", email_verified: true }),
    });

    const res = await GET(req());

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login?error=unauthorized");
    expect(fakeSession.isLoggedIn).toBe(false);
    expect(mockSessionSave).not.toHaveBeenCalled();
  });

  it("the exact authorized email, verified, IS logged in", async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: "chafiq.jalal@gmail.com", email_verified: true }),
    });

    const res = await GET(req());

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
    expect(fakeSession.isLoggedIn).toBe(true);
    expect(mockSessionSave).toHaveBeenCalledTimes(1);
  });

  it("the authorized email but with email_verified:false is rejected — Google's own unverified-email case", async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: "chafiq.jalal@gmail.com", email_verified: false }),
    });

    const res = await GET(req());

    expect(res.headers.get("location")).toContain("/login?error=unauthorized");
    expect(fakeSession.isLoggedIn).toBe(false);
  });

  it("a case-mismatched near-match ('Chafiq.Jalal@gmail.com') is rejected — exact string comparison, not case-insensitive", async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: "Chafiq.Jalal@gmail.com", email_verified: true }),
    });

    const res = await GET(req());

    expect(res.headers.get("location")).toContain("/login?error=unauthorized");
    expect(fakeSession.isLoggedIn).toBe(false);
  });
});
