/**
 * One-time index creation for lib/gemini-cost-tracker.ts's three collections.
 *
 * Deliberately a SEPARATE script from scripts/add-indexes.ts, which is
 * DEPRECATED and carries stale ds/bc/cp/parc field-name literals from before
 * the 2026-08 dirty->clean Mongo key migration — running that one now would
 * build indexes on field names that no longer exist. This script touches ONLY
 * gemini_quota / gemini_usage / gemini_usage_totals, all of which are new and
 * owned entirely by this repo (unlike ds/bc/cp/parc, whose index ownership
 * belongs to ~/import's ensure_indexes()).
 *
 * NOT part of the app build, not imported by anything under app/ or lib/.
 * Run manually from the repo root:
 *
 *   npx tsx scripts/add-gemini-cost-indexes.ts
 *
 * Reads MONGODB_URI / MONGODB_DB from .env.local — so it acts on whichever
 * database that file points at. Check which one that is before running.
 * createIndex() is idempotent, so re-running is safe and cheap. These are
 * empty/small collections, so the builds are effectively instant; there is no
 * before/after timing here because there is nothing yet to time.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { MongoClient } from "mongodb";

function loadEnvLocal(): Record<string, string> {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) {
    console.error(`.env.local not found at ${path}. Run this script from the repo root.`);
    process.exit(1);
  }
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

async function main() {
  const env = loadEnvLocal();
  const uri = env.MONGODB_URI;
  const dbName = env.MONGODB_DB;
  if (!uri || !dbName) {
    console.error("Missing MONGODB_URI or MONGODB_DB in .env.local");
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  // Echo the target, with credentials stripped — this script is run by hand and
  // the whole risk is running it against the wrong database without noticing.
  console.log(`Target: ${uri.replace(/\/\/[^@]*@/, "//***@").split("?")[0]} db="${dbName}"\n`);

  const specs: { col: string; key: Record<string, 1 | -1>; name: string; expireAfterSeconds?: number }[] = [
    // TTL: expireAfterSeconds 0 means each doc expires at its own `expiresAt`,
    // so spent free-tier day-buckets clean themselves up. Same pattern as
    // rate_limits.
    { col: "gemini_quota", key: { expiresAt: 1 }, name: "expires_at_ttl", expireAfterSeconds: 0 },
    // Audit log: no TTL, this history is the point. Indexed for the two
    // queries it exists to answer — recent spend, and spend per action.
    { col: "gemini_usage", key: { timestamp: -1 }, name: "timestamp_desc" },
    { col: "gemini_usage", key: { action: 1, timestamp: -1 }, name: "action_timestamp" },
  ];
  // gemini_usage_totals needs no index: it is keyed by _id (the model name),
  // holds one doc per model, and is only ever read in full by
  // getRemainingCredit(). Listed in the verification loop below regardless.

  console.log("=== Creating indexes ===");
  for (const spec of specs) {
    const start = Date.now();
    const options: { name: string; expireAfterSeconds?: number } = { name: spec.name };
    if (spec.expireAfterSeconds != null) options.expireAfterSeconds = spec.expireAfterSeconds;
    const name = await db.collection(spec.col).createIndex(spec.key, options);
    console.log(`  ${spec.col}.createIndex(${JSON.stringify(spec.key)}) -> "${name}" (${Date.now() - start}ms)`);
  }

  console.log("\n=== Verifying via .indexes() ===");
  for (const col of ["gemini_quota", "gemini_usage", "gemini_usage_totals"]) {
    const exists = await db.listCollections({ name: col }).hasNext();
    if (!exists) {
      // Expected for gemini_usage_totals until the first call is recorded —
      // Mongo creates a collection lazily on first write.
      console.log(`  ${col}: not created yet (no documents written)`);
      continue;
    }
    const idx = await db.collection(col).indexes();
    console.log(`  ${col}:`);
    idx.forEach((i) =>
      console.log(
        `    ${JSON.stringify(i.key)} (${i.name})${i.expireAfterSeconds != null ? ` TTL=${i.expireAfterSeconds}s` : ""}`
      )
    );
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
