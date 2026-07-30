import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      // lib/googleSheetsClient.ts throws at module load if this is unset —
      // never decoded/used by the functions under test here (they're given
      // a fully mocked `sheets` client), just needs to be non-empty so the
      // module can be imported at all.
      GOOGLE_SERVICE_ACCOUNT_KEY_B64: "test-dummy-key",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
});
