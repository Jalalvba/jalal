import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // Playwright's own test fixture API (test.extend({ context: async (...,
    // use) => ... })) happens to name its callback parameter "use" — the
    // react-hooks plugin's naming-convention heuristic treats any function
    // starting with "use" as a React hook and misfires here. e2e/ is plain
    // Node test code, not React, so the whole react-hooks rule set doesn't
    // apply to it.
    files: ["e2e/**/*.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
]);

export default eslintConfig;
