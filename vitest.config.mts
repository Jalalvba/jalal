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
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
});
