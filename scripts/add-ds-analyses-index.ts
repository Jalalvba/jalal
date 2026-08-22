/**
 * The one index ds_analyses needs: a UNIQUE index on `imm`.
 *
 * saveAnalysis() upserts by plate, so this collection holds one document per
 * vehicle by construction. The unique index is what makes that construction
 * true rather than merely intended — two concurrent analyses of the same plate
 * (two tabs, or a list page and DS History) would otherwise both miss the
 * find, both insert, and leave the collection with two "current" analyses of
 * one vehicle and no way to say which is current.
 *
 * ds_analyses is owned entirely by this repo — unlike ds/bc/cp/parc, whose
 * index ownership belongs to ~/import's ensure_indexes().
 *
 * Run manually from the repo root:
 *
 *   npx tsx scripts/add-ds-analyses-index.ts
 *
 * Reads MONGODB_URI / MONGODB_DB from .env.local, so it acts on whichever
 * database that file points at — check which before running. createIndex() is
 * idempotent, so re-running is safe and cheap.
 */

import "./_loadEnv";
import { MongoClient } from "mongodb";

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB ?? "avis";
  if (!uri) throw new Error("MONGODB_URI missing from .env.local");

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  // Echoed with credentials stripped: this is run by hand, and the whole risk
  // is acting on the wrong database without noticing.
  console.log(`Target: ${uri.replace(/\/\/[^@]*@/, "//***@").split("?")[0]} db="${dbName}"\n`);

  const name = await db.collection("ds_analyses").createIndex({ imm: 1 }, { unique: true, name: "imm_unique" });
  console.log(`  ds_analyses.createIndex({ imm: 1 }, { unique: true }) -> "${name}"`);

  const idx = await db.collection("ds_analyses").indexes();
  console.log("\n=== Verifying via .indexes() ===");
  for (const i of idx) console.log(`  ${i.name}: ${JSON.stringify(i.key)}${i.unique ? " (unique)" : ""}`);

  const count = await db.collection("ds_analyses").countDocuments();
  console.log(`\nds_analyses holds ${count} stored analysis document(s).`);

  await client.close();
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
