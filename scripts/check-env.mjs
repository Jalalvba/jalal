// Pre-build environment check.
//
// src/instrumentation.ts's register() validates the environment at *server*
// boot, which covers `next dev` and `next start`. It does NOT run during
// `next build`'s "Collecting page data" phase — there, the first module-level
// throw wins instead (e.g. src/lib/sheets/googleSheetsRdvMonthly.ts's
// "Missing GOOGLE_RDV_SHEETS_ID"), which names one variable at a time and
// sends you round a fix-one-rerun-repeat loop.
//
// This script closes that gap by running the same schema before next build is
// invoked, so a misconfigured build fails immediately with the full list.
// It is chained into the "build" script explicitly rather than relying on the
// implicit "prebuild" hook: pnpm's enable-pre-post-scripts has flipped default
// across releases, and a check that silently stops running is worse than none.
//
// Run manually with: pnpm check-env

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Minimal .env parser — enough for the KEY=VALUE / quoted / commented lines
 * this repo's .env files actually use. Deliberately dependency-free: dotenv
 * is not a direct dependency here, and adding one just for a build guard
 * isn't worth it.
 */
function parseEnvFile(file) {
  const out = {};
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    // Strip one layer of matching quotes; leave inner content untouched.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

// Next.js precedence, highest first. An already-set process.env value always
// wins over every file — that is what makes this correct on Vercel, where the
// platform injects the environment and no .env file exists at all.
const nodeEnv = process.env.NODE_ENV || "production";
const candidates = [
  `.env.${nodeEnv}.local`,
  ".env.local",
  `.env.${nodeEnv}`,
  ".env",
];

const loadedFrom = [];
for (const name of candidates) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) continue;
  loadedFrom.push(name);
  for (const [key, value] of Object.entries(parseEnvFile(file))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const { validateEnv } = await import("../src/config/env.ts");

try {
  validateEnv();
} catch (error) {
  console.error("\n✗ Pre-build environment check failed.\n");
  console.error(error instanceof Error ? error.message : String(error));
  console.error(
    loadedFrom.length
      ? `\nRead from: ${loadedFrom.join(", ")} (plus the ambient environment).`
      : "\nNo .env file found — values came from the ambient environment only.",
  );
  console.error("");
  process.exit(1);
}

console.log(
  `✓ check-env: environment valid${
    loadedFrom.length ? ` (${loadedFrom.join(", ")})` : ""
  }`,
);
