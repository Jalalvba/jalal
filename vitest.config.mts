import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    // e2e/ is Playwright's suite (its own test()/expect(), a different
    // runner) — Vitest's default *.spec.ts glob would otherwise also pick
    // those files up and fail trying to run them under the wrong runner.
    exclude: ["**/node_modules/**", "**/e2e/**"],
    env: {
      // lib/googleSheetsClient.ts throws at module load if this is unset —
      // never decoded/used by the functions under test here (they're given
      // a fully mocked `sheets` client), just needs to be non-empty so the
      // module can be imported at all.
      GOOGLE_SERVICE_ACCOUNT_KEY_B64: "test-dummy-key",
      // Same reasoning — lib/mongo.ts throws at module load if these are
      // unset. Any route/module that transitively imports lib/rateLimit.ts
      // (which imports lib/mongo.ts) needs this just to be importable, even
      // when the test itself mocks @/lib/mongo entirely (the dummy value
      // here is what lets the *unmocked* import path load without a real
      // MongoClient ever connecting — connection only happens inside
      // getCollection(), never at module import time).
      MONGODB_URI: "mongodb://test-dummy-host/test",
      MONGODB_DB: "test-dummy-db",
      // lib/googleSheetsBdd.ts (and the other lib/googleSheets*.ts modules)
      // throw at module load if this is unset — same reasoning as the two
      // dummies above, needed just to make the module importable when a
      // test gives it a fully mocked `sheets` client.
      GOOGLE_SHEETS_ID: "test-dummy-sheet-id",
      // lib/googleOAuth.ts throws at module load if these are unset —
      // pulled in transitively by app/api/config/options/route.ts (via
      // AUTHORIZED_EMAIL), same reasoning as the dummies above.
      GOOGLE_OAUTH_CLIENT_ID: "test-dummy-oauth-client-id",
      GOOGLE_OAUTH_CLIENT_SECRET: "test-dummy-oauth-client-secret",
      // iron-session (lib/session.ts) requires a real >=32-char secret at
      // seal/unseal time — used by lib/__tests__/proxy.test.ts to mint a
      // real sealed session cookie the same way e2e/helpers/auth.ts does
      // for the Playwright suite, so proxy.ts's actual iron-session
      // unsealing code runs for real in that test, not a mock.
      IRON_SESSION_SECRET: "test-dummy-iron-session-secret-at-least-32-chars-long",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
