import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, SessionData } from "@/lib/session";

/**
 * Per-request nonce-based CSP. Built once per request and stamped on every
 * response this function returns (public passthrough, the 401 JSON, the
 * login redirect, and the authenticated passthrough) — cheap and avoids
 * having to reason about which branches strictly need it. The nonce itself
 * is only functionally required on the two NextResponse.next() branches
 * (the ones that actually reach app/layout.tsx's rendered <script>): the
 * 401/redirect responses never render a page, so the request-header
 * forwarding there is a no-op, not a bug.
 *
 * img-src has no googleusercontent.com and form-action has no
 * accounts.google.com — checked first: app/login/page.tsx's Google button
 * is a plain `<a href="/api/auth/google">` GET link, not a <form>, and this
 * app requests only the `openid email` OAuth scopes (no `profile`), so it
 * never fetches or renders a Google avatar anywhere. Adding either would be
 * an unused allowance, not a real dependency.
 */
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${
      process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""
    }`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' blob: data:",
    "connect-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);

  // Allow login page, the Google OAuth start/callback routes, and static
  // assets through. The OAuth routes must be reachable while unauthenticated
  // — that's the whole point of a login route — same reasoning /login was
  // already excluded for.
  //
  // Anchored rather than loose startsWith() prefixes: a bare prefix match
  // (e.g. pathname.startsWith("/login")) would also let through any future
  // route accidentally named "/login-something" or "/api/auth/google-x" —
  // not exploitable today since no such routes exist, but a silent
  // auth-bypass footgun the moment one is added. "/api/auth/google" needs
  // both the exact path (the start-flow route) and the "/callback" subpath,
  // so it's anchored with a trailing slash rather than a bare exact match.
  if (
    pathname === "/login" ||
    pathname === "/api/auth/google" ||
    pathname.startsWith("/api/auth/google/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  ) {
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    res.headers.set("Content-Security-Policy", csp);
    return res;
  }

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  const session = await getIronSession<SessionData>(req, res, sessionOptions);

  if (!session.isLoggedIn) {
    // API routes → return 401 JSON instead of redirecting
    if (pathname.startsWith("/api/")) {
      const unauth = NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      unauth.headers.set("Content-Security-Policy", csp);
      return unauth;
    }
    const loginUrl = new URL("/login", req.url);
    const redirect = NextResponse.redirect(loginUrl);
    redirect.headers.set("Content-Security-Policy", csp);
    return redirect;
  }

  res.headers.set("Content-Security-Policy", csp);
  return res;
}

// Deliberately kept as the simple, already-proven matcher rather than one
// that also excludes prefetch requests (e.g. via a `missing:
// next-router-prefetch` condition) — this same function is the app's auth
// boundary, not just a CSP layer, and excluding prefetch requests from it
// would let an unauthenticated browser prefetch a protected page's content
// without ever hitting the session check.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
