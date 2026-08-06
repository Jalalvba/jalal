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

  const sealed = await sealData({ isLoggedIn: true }, { password });
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
