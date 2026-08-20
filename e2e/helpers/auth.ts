import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { sealData } from "iron-session";

// Loaded once per Playwright worker process — playwright.config.ts's own
// webServer.command ("pnpm dev") loads .env.local for the Next.js server
// itself, but this test process is separate and needs the same secret in
// its own process.env to seal a cookie the server will actually accept.
const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const COOKIE_NAME = "auth_session";
// Mirrors sessionOptions.ttl in src/lib/auth/session.ts. Not imported from
// there because that module reads IRON_SESSION_SECRET at import time from the
// Next.js process's env, not this one. A 14-day seal still unseals fine
// against a 7-day ttl (the expiry is baked in at seal time, and unseal
// validates the embedded value), so this is about the helper minting what the
// app itself would mint rather than about fixing a break.
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

/**
 * Mints a real, valid iron-session cookie the exact same way
 * lib/session.ts's sessionOptions expects to unseal one — the formalized
 * version of the sealData()-a-cookie script every manual Playwright pass
 * this session wrote from scratch and threw away. Any spec file needing an
 * authenticated session should go through this instead of reinventing it.
 */
export async function authenticatedCookie(baseURL: string) {
  const password = process.env.IRON_SESSION_SECRET;
  if (!password) {
    throw new Error(
      "IRON_SESSION_SECRET is not set — E2E tests need real .env.local secrets (see TESTING.md). " +
        "If this only exists in Vercel's Production scope, pull it first: vercel env pull .env.local --environment=production"
    );
  }

  const sealed = await sealData({ isLoggedIn: true }, { password, ttl: SESSION_TTL_SECONDS });
  const url = new URL(baseURL);

  return {
    name: COOKIE_NAME,
    value: sealed,
    domain: url.hostname,
    path: "/",
    httpOnly: true,
    sameSite: "Lax" as const,
  };
}
