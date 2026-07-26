import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getOAuthClient, getRedirectUri } from "@/lib/googleOAuth";

// Starts the OAuth flow: generates a CSRF state token, stores it in a
// short-lived cookie, and redirects to Google's consent screen.
// "select_account" forces the account picker every time rather than
// silently reusing a cached Google session — useful given this app only
// ever authorizes one specific account, so being explicit about which
// account you're signing in with matters.
export async function GET(req: Request) {
  const state = randomBytes(32).toString("hex");
  const redirectUri = getRedirectUri(req);
  const oauth2Client = getOAuthClient(redirectUri);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "online", // login-only — no ongoing API access on the user's behalf, so no refresh token needed
    scope: ["openid", "email"],
    state,
    prompt: "select_account",
  });

  const res = NextResponse.redirect(authUrl);
  res.cookies.set("oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes — just long enough to complete Google's consent screen
    path: "/",
  });
  return res;
}
