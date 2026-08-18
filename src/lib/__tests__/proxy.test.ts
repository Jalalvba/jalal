import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { sealData } from "iron-session";
import { proxy } from "@/proxy";
import { sessionOptions } from "@/lib/auth/session";

// The highest-value gap Opus's audit found in the pre-existing test suite:
// the entire auth model (this file — every request funnels through it) had
// zero regression protection. Mutation-tested by the audit itself:
// replacing `if (!session.isLoggedIn)` with `if (false)` (making the whole
// app public) left all 76 pre-existing tests green. These tests close that.
//
// Deliberately does NOT mock iron-session or getIronSession — it mints a
// real sealed cookie via sealData() (same helper e2e/helpers/auth.ts uses
// for the Playwright suite) and lets proxy.ts's real unsealing code run, so
// this exercises the actual auth boundary, not a stand-in for it.

async function authenticatedCookieValue(): Promise<string> {
  return sealData({ isLoggedIn: true }, { password: sessionOptions.password });
}

function reqTo(pathname: string, cookie?: string): NextRequest {
  const headers = new Headers();
  if (cookie) headers.set("cookie", `auth_session=${cookie}`);
  return new NextRequest(new Request(`http://localhost:3000${pathname}`, { headers }));
}

describe("proxy — auth boundary (test-suite gap #1)", () => {
  it("an unauthenticated request to a protected API route gets a 401 JSON, not served", async () => {
    const res = await proxy(reqTo("/api/bdd"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("an unauthenticated request to a protected page route gets redirected to /login, not served", async () => {
    const res = await proxy(reqTo("/suivi-rl"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("an authenticated request (real sealed session cookie) to a protected API route passes through", async () => {
    const cookie = await authenticatedCookieValue();
    const res = await proxy(reqTo("/api/bdd", cookie));
    // NextResponse.next() carries this internal marker header rather than
    // a real status/body — this route never actually gets invoked here,
    // proxy.ts just decides whether to let the request continue.
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("a garbage/forged cookie value is treated as NOT logged in, not as a crash or a bypass", async () => {
    const res = await proxy(reqTo("/api/bdd", "not-a-real-sealed-value"));
    expect(res.status).toBe(401);
  });

  it("/login itself stays reachable without a session (otherwise nobody could ever log in)", async () => {
    const res = await proxy(reqTo("/login"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("the OAuth start/callback routes stay reachable without a session", async () => {
    const res1 = await proxy(reqTo("/api/auth/google"));
    expect(res1.headers.get("x-middleware-next")).toBe("1");

    const res2 = await proxy(reqTo("/api/auth/google/callback"));
    expect(res2.headers.get("x-middleware-next")).toBe("1");
  });

  it("every response — including the 401 and the redirect — carries the CSP header", async () => {
    const unauth = await proxy(reqTo("/api/bdd"));
    expect(unauth.headers.get("Content-Security-Policy")).toContain("default-src 'self'");

    const redirect = await proxy(reqTo("/suivi-rl"));
    expect(redirect.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
  });
});
