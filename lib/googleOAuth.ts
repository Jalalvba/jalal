import { google } from "googleapis";

// Single hardcoded authorized account — this app has exactly one user, not
// a multi-tenant system. No User model, no MongoDB collection: the whole
// authorization check is "does the Google-verified email exactly equal
// this constant."
export const AUTHORIZED_EMAIL = "chafiq.jalal@gmail.com";

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
if (!clientId) throw new Error("Missing GOOGLE_OAUTH_CLIENT_ID in .env.local");

const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
if (!clientSecret) throw new Error("Missing GOOGLE_OAUTH_CLIENT_SECRET in .env.local");

/** New OAuth2 client per request — cheap, stateless, no reason to cache like the Sheets JWT client does. */
export function getOAuthClient(redirectUri: string) {
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Derived from the incoming request at runtime — no separate env var to
 * keep in sync across local/Vercel. Requires the exact resulting URL to be
 * registered as an Authorized redirect URI in Google Cloud Console for
 * every environment this runs in (confirmed already done for both
 * localhost:3000 and the production Vercel domain).
 */
export function getRedirectUri(req: Request): string {
  return new URL("/api/auth/google/callback", new URL(req.url).origin).toString();
}
