/**
 * DEPRECATED — retired, not maintained. Do not run this against production
 * anymore: its field-name literals predate the ds/bc/cp/parc dirty->clean
 * Mongo key migration (2026-08) and are now stale (e.g. "IMM"/"Immatriculation"/
 * "CMD Num" instead of imm/immatriculation/cmd_num). Index ownership has
 * moved to the ~/import project's ensure_indexes() (lib/mongo.py) — each
 * collection's own INDEX_SPECS constant (ds.py, bc.py, cp.py, parc.py) is
 * the real source of truth for what indexes ds/bc/cp/parc should have, and
 * ensure_indexes() applies it on every pipeline run. A one-off script here
 * duplicating and inevitably drifting from those lists isn't worth keeping
 * current. Kept only for historical reference (the
 * before/after timing methodology below may still be a useful pattern to
 * copy elsewhere), not as something to fix and re-run.
 *
 * One-time index creation for the collections queried by this app's API
 * routes — see AUDIT_REPORT.md §8.1 for the analysis behind these choices.
 *
 * NOT part of the app build, not imported by anything under app/ or lib/.
 * Run manually:
 *
 *   npx tsx scripts/add-indexes.ts
 *
 * Reads MONGODB_URI / MONGODB_DB from .env.local. createIndex() is
 * idempotent (a no-op if the same index already exists under a different
 * call), so this is safe to re-run.
 *
 * Server confirmed at MongoDB 8.0.27 before running this — well past 4.2,
 * so index builds use the modern optimized build process (brief exclusive
 * locks only at the start/end, no blocking of concurrent reads/writes for
 * the bulk of the build). The old `background: true` option is a no-op on
 * this version; every build is effectively a background build now.
 *
 * Does a rough (not scientific) before/after timing of each affected
 * route's actual query pattern, using a real sampled document from each
 * collection rather than a made-up value.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { MongoClient, type Document } from "mongodb";

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

async function timeQuery(label: string, fn: () => Promise<Document[]>): Promise<void> {
  const start = Date.now();
  const result = await fn();
  const ms = Date.now() - start;
  console.log(`  ${label}: ${ms}ms (${result.length} result(s))`);
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

  // Sample a real document from each collection so the timing comparison
  // uses realistic query params, not made-up values.
  const sampleDs = await db.collection("ds").findOne({}, { projection: { Immatriculation: 1 } });
  const sampleBc = await db.collection("bc").findOne({}, { projection: { "CMD Num": 1, "Code article": 1 } });
  const sampleParc = await db.collection("parc").findOne({}, { projection: { Immatriculation: 1 } });
  const sampleCp = await db.collection("cp").findOne({}, { projection: { IMM: 1 } });

  const runTimings = async () => {
    await timeQuery("ds: match Immatriculation + sort \"Date DS\" desc (mirrors /api/ds/history)", () =>
      db.collection("ds").find({ Immatriculation: sampleDs?.["Immatriculation"] }).sort({ "Date DS": -1 }).toArray()
    );
    await timeQuery("bc: match \"CMD Num\" + \"Code article\" (mirrors the $lookup inside /api/ds/history)", () =>
      db.collection("bc")
        .find({ "CMD Num": sampleBc?.["CMD Num"], "Code article": sampleBc?.["Code article"] })
        .toArray()
    );
    await timeQuery("parc: match Immatriculation exact (mirrors /api/parc)", () =>
      db.collection("parc").find({ Immatriculation: sampleParc?.["Immatriculation"] }).toArray()
    );
    await timeQuery("cp: match IMM (mirrors /api/cp)", () =>
      db.collection("cp").find({ IMM: sampleCp?.["IMM"] }).toArray()
    );
  };

  console.log("=== BEFORE indexes ===");
  await runTimings();

  console.log("\n=== Creating indexes ===");
  const specs: { col: string; key: Record<string, 1 | -1>; name: string; expireAfterSeconds?: number }[] = [
    { col: "ds", key: { Immatriculation: 1, "Date DS": -1 }, name: "immatriculation_date_ds" },
    { col: "bc", key: { "CMD Num": 1, "Code article": 1 }, name: "cmd_num_code_article" },
    { col: "parc", key: { Immatriculation: 1 }, name: "immatriculation" },
    { col: "parc", key: { "Numéro WW": 1 }, name: "numero_ww" },
    { col: "parc", key: { "N° de chassis": 1 }, name: "n_de_chassis" },
    { col: "cp", key: { IMM: 1 }, name: "imm" },
    { col: "cp", key: { WW: 1 }, name: "ww" },
    // TTL index for lib/rateLimit.ts's fixed-window counters — expireAfterSeconds: 0
    // means each document expires exactly at its own `expiresAt` value, so old
    // rate-limit windows clean themselves up with no manual maintenance.
    { col: "rate_limits", key: { expiresAt: 1 }, name: "expires_at_ttl", expireAfterSeconds: 0 },
    // Same self-expiring pattern for lib/gemini-cost-tracker.ts's per-model,
    // per-Pacific-day free-tier counters.
    { col: "gemini_quota", key: { expiresAt: 1 }, name: "expires_at_ttl", expireAfterSeconds: 0 },
    // Audit log — no TTL, this is the history we want to keep. Indexed for the
    // usual "what did we spend recently / on this action" queries.
    { col: "gemini_usage", key: { timestamp: -1 }, name: "timestamp_desc" },
    { col: "gemini_usage", key: { action: 1, timestamp: -1 }, name: "action_timestamp" },
  ];

  for (const spec of specs) {
    const start = Date.now();
    const options: { name: string; expireAfterSeconds?: number } = { name: spec.name };
    if (spec.expireAfterSeconds != null) options.expireAfterSeconds = spec.expireAfterSeconds;
    const name = await db.collection(spec.col).createIndex(spec.key, options);
    console.log(`  ${spec.col}.createIndex(${JSON.stringify(spec.key)}) -> "${name}" (${Date.now() - start}ms)`);
  }

  console.log("\n=== Verifying via .indexes() ===");
  for (const col of ["ds", "bc", "parc", "cp", "rate_limits", "gemini_quota", "gemini_usage"]) {
    const idx = await db.collection(col).indexes();
    console.log(`  ${col}:`);
    idx.forEach((i) => console.log(`    ${JSON.stringify(i.key)} (${i.name})${i.expireAfterSeconds != null ? ` TTL=${i.expireAfterSeconds}s` : ""}`));
  }

  console.log("\n=== AFTER indexes ===");
  await runTimings();

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
