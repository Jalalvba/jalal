/**
 * One-time migration for Stage 1 of the config-driven sheet-structure
 * proposal (config-proposal artifact, 2026-08-06): captures today's real,
 * live hardcoded dropdown values — the *_FALLBACK constants in
 * lib/types.ts, which are exactly what EMPLACEMENT_OPTIONS/ETAT_OPTIONS/
 * FLAG_OPTIONS+FLAG_STYLE/CATEGORIE_OPTIONS/TECHNICIEN_OPTIONS/
 * PRESTATAIRE_OPTIONS+its 2 color Sets/RDV_CONVOYEURS held immediately
 * before this migration renamed them — and inserts them into the
 * "sheetFieldOptions" Mongo collection as the initial documents. No values
 * are invented or changed; this only moves what was already live into
 * Mongo so the migration starts from parity, not a silent reset.
 *
 * NOT part of the app build, not imported by anything under app/ or lib/.
 * Run manually:
 *
 *   npx tsx scripts/seed-sheet-field-options.ts
 *
 * Reads MONGODB_URI / MONGODB_DB from .env.local (same manual parsing as
 * scripts/add-indexes.ts — lib/mongo.ts throws at import time if those
 * env vars aren't already in process.env, which they aren't yet when tsx
 * starts, so this can't just `import { getCollection } from "@/lib/mongo/client"`).
 *
 * Idempotent via upsert: safe to re-run, but re-running after an admin has
 * already edited a value via /admin/config would overwrite their edit back
 * to the original hardcoded value — this is a one-time bootstrap, not a
 * sync job.
 *
 * CACHE STALENESS: this script writes directly to Mongo and does NOT call
 * lib/googleSheetsClient.ts's invalidateCache() — confirmed by direct
 * testing that it can't: invalidateCache() wraps Next's revalidateTag(),
 * which throws ("Invariant: static generation store missing") the instant
 * it's called outside a real Next.js request/build context, which a
 * standalone `npx tsx` process never has. A running deployment's
 * lib/sheetFieldOptions.ts getAllSheetFieldOptionsWithStatus() cache has a
 * 5-minute TTL (CACHE_TTL_MS), so a value changed by re-running this script
 * can take up to 5 minutes to actually show up in the live app — that's
 * expected, not a bug, and there's no in-process way to force it sooner
 * from outside the running Next server. If this ever needs to be
 * synchronous, it would have to go through an authenticated app route
 * (e.g. a one-off admin action) instead of a standalone script.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { MongoClient } from "mongodb";
import {
  OPTION_KEYS,
  COLORED_OPTION_KEYS,
  OPTION_LABELS,
  EMPLACEMENT_OPTIONS_FALLBACK,
  ETAT_OPTIONS_FALLBACK,
  FLAG_OPTIONS_FALLBACK,
  CATEGORIE_OPTIONS_FALLBACK,
  TECHNICIEN_OPTIONS_FALLBACK,
  PRESTATAIRE_OPTIONS_FALLBACK,
  RDV_CONVOYEURS_FALLBACK,
  ZONING_OPTIONS_FALLBACK,
  type OptionKey,
} from "../src/types";

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
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^"(.*)"$/, "$1");
    env[key] = value;
  }
  return env;
}

const SEED_VALUES: Record<OptionKey, unknown> = {
  EMPLACEMENT_OPTIONS: EMPLACEMENT_OPTIONS_FALLBACK,
  ETAT_OPTIONS: ETAT_OPTIONS_FALLBACK,
  FLAG_OPTIONS: FLAG_OPTIONS_FALLBACK,
  CATEGORIE_OPTIONS: CATEGORIE_OPTIONS_FALLBACK,
  TECHNICIEN_OPTIONS: TECHNICIEN_OPTIONS_FALLBACK,
  PRESTATAIRE_OPTIONS: PRESTATAIRE_OPTIONS_FALLBACK,
  RDV_CONVOYEURS: [...RDV_CONVOYEURS_FALLBACK],
  // Was missing from this map even though ZONING_OPTIONS is in OPTION_KEYS —
  // so the seeder silently never wrote it, and the key only existed in Mongo
  // because something else put it there. Added 2026-08-29 alongside the
  // 9-value dropdown replacement.
  ZONING_OPTIONS: [...ZONING_OPTIONS_FALLBACK],
};

async function main() {
  const env = loadEnvLocal();
  const uri = env.MONGODB_URI;
  const dbName = env.MONGODB_DB;
  if (!uri || !dbName) {
    console.error("Missing MONGODB_URI or MONGODB_DB in .env.local");
    process.exit(1);
  }

  type SeedDoc = {
    _id: OptionKey;
    key: OptionKey;
    label: string;
    type: "plain" | "colored";
    options: unknown;
    updatedAt: Date;
    updatedBy: string;
  };

  const client = new MongoClient(uri);
  await client.connect();
  const col = client.db(dbName).collection<SeedDoc>("sheetFieldOptions");

  console.log("=== Existing documents before seeding ===");
  const before = await col.find({}).toArray();
  if (before.length === 0) {
    console.log("  (collection is empty)");
  } else {
    for (const doc of before) {
      const count = Array.isArray(doc.options) ? doc.options.length : 0;
      console.log(`  ${doc._id}: ${count} option(s), updated ${doc.updatedAt}`);
    }
  }

  console.log("\n=== Seeding (upsert, one document per key) ===");
  const updatedBy = "seed-script";
  for (const key of OPTION_KEYS) {
    const colored = (COLORED_OPTION_KEYS as readonly OptionKey[]).includes(key);
    const options = SEED_VALUES[key];
    const result = await col.updateOne(
      { _id: key },
      {
        $set: {
          _id: key,
          key,
          label: OPTION_LABELS[key],
          type: colored ? "colored" : "plain",
          options,
          updatedAt: new Date(),
          updatedBy,
        },
      },
      { upsert: true }
    );
    const count = Array.isArray(options) ? options.length : 0;
    console.log(
      `  ${key}: ${count} option(s) — ${result.upsertedCount ? "inserted" : "updated"}`
    );
  }

  console.log("\n=== Verifying after seeding ===");
  const after = await col.find({}).sort({ _id: 1 }).toArray();
  for (const doc of after) {
    console.log(`  ${doc._id} (${doc.type}): ${JSON.stringify(doc.options)}`);
  }

  await client.close();
  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
