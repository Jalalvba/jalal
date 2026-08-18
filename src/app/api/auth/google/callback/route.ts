import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, SessionData } from "@/lib/auth/session";
import { getOAuthClient, getRedirectUri, AUTHORIZED_EMAIL } from "@/lib/auth/googleOAuth";
import { rateLimitOrNull } from "@/lib/http/rateLimit";

// Validates the CSRF state, exchanges the code, verifies the ID token
// (cryptographically, via Google's own public keys — not just trusting an
// unauthenticated userinfo response), and checks the verified email
// against the single hardcoded authorized account. No User model, no
// session data beyond the existing { isLoggedIn: boolean } shape — this
// only replaces how a session gets created, not what it contains.
//
// Rate-limited (M8 in the audit this responds to): unauthenticated, and
// each hit triggers an outbound call to Google (getToken() + ID-token
// verification) — worth capping independently of oauth-start's limit, since
// a caller could in principle hit this route directly with old/garbage
// code+state pairs without ever visiting /api/auth/google first.
export async function GET(req: Request) {
  const limited = await rateLimitOrNull(req, "oauth-callback", 30, 60_000);
  if (limited) return limited;

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const cookieStore = await cookies();
  const expectedState = cookieStore.get("oauth_state")?.value;
  cookieStore.delete("oauth_state"); // one-time use regardless of outcome

  if (oauthError) {
    return NextResponse.redirect(new URL("/login?error=google", req.url));
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/login?error=state", req.url));
  }

  try {
    const redirectUri = getRedirectUri(req);
    const oauth2Client = getOAuthClient(redirectUri);
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.id_token) {
      return NextResponse.redirect(new URL("/login?error=google", req.url));
    }

    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    });
    const payload = ticket.getPayload();

    if (!payload?.email || !payload.email_verified || payload.email !== AUTHORIZED_EMAIL) {
      return NextResponse.redirect(new URL("/login?error=unauthorized", req.url));
    }

    const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
    session.isLoggedIn = true;
    await session.save();

    return NextResponse.redirect(new URL("/", req.url));
  } catch (e) {
    console.error("[google oauth callback]", e instanceof Error ? e.message : e);
    return NextResponse.redirect(new URL("/login?error=google", req.url));
  }
}
