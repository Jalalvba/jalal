/**
 * Data-integrity report: `cp` contracts whose vehicle is missing from `parc`.
 *
 * READ-ONLY. Touches nothing, writes nothing, returns a report.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * `parc` is the vehicles AVIS owns. `cp` is the contracts renting those
 * vehicles to clients. You cannot rent a car you do not own, so every `cp`
 * row should have a matching `parc` row. Live, 3,760 of 10,230 do not.
 *
 * That was found by eye — one AUDI A4 (11734-T-1) whose DS History card said
 * "aucune fiche parc" while its contract runs to 2028. It should not take
 * noticing one car to surface a four-thousand-row gap, which is what this
 * script is for.
 *
 * The gap is NOT vehicles aging out of the fleet: `parc` keeps 1,009 vehicles
 * whose contracts have all ended, and 1,392 with no contract at all. And it is
 * not the import — a ~/import session opened the real Drive file and scanned
 * every cell of the single sheet (22 columns x 7,844 rows) before any header
 * handling, mapping or filtering: the 7 confirmed anomalies appear NOWHERE in
 * it, under plate or WW. Its last run read 7,838 data rows and wrote 7,836,
 * the 2 dropped rows genuinely having neither plate nor WW. So `parc` is
 * exactly what `Fullparcs.xls` contains, and the file is what is incomplete:
 * ~7,836 vehicles against 10,230 cp contracts.
 *
 * NOTE on the series breakdown below: do NOT read a low series percentage as
 * "this series is excluded from the export". It is not. The raw file's own
 * counts match parc's almost exactly (B-7 4850/4850, T-6 667/667, T-1
 * 395/395, E-6 128/127, A-7 2/2), so nothing filters by plate series. The
 * percentages are low where a series has many cp contracts and few parc rows,
 * which measures COVERAGE, not exclusion. An earlier reading of this table as
 * "whole series absent" was wrong.
 *
 * So this reports upstream data health. It is deliberately NOT wired into CI:
 * it measures live data, not code, and a build should not fail because a
 * spreadsheet changed. Run it when the parc import runs, or when a vehicle
 * card looks wrong.
 *
 * Run:
 *
 *   npx tsx scripts/check-parc-coverage.ts
 *
 * Reads MONGODB_URI / MONGODB_DB from .env.local.
 *
 * Exit code: 1 only for a CONFIRMED anomaly — an active contract on a vehicle
 * with a real (non-WW) plate AND recorded DS history, missing from parc. Such
 * a vehicle demonstrably exists, is on the road, and is being serviced, so its
 * absence from the ownership file cannot be explained away.
 *
 * Vehicles still carrying a temporary WW registration with no DS history are
 * reported separately and do NOT fail: those are plausibly just-delivered
 * units not yet in the ownership export, a transient state rather than a
 * defect. Failing on them would make the exit code cry wolf and get ignored,
 * which is how a check like this stops being read.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MongoClient } from "mongodb";

function loadEnv(): { uri: string; db: string } {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  const env: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  if (!env.MONGODB_URI) throw new Error("MONGODB_URI missing from .env.local");
  return { uri: env.MONGODB_URI, db: env.MONGODB_DB || "avis" };
}

/**
 * Mongo returns these as Date objects, so `String(d).slice(0, 10)` yields
 * "Wed Sep 02" — the weekday and NO YEAR. This script printed exactly that,
 * and the missing years were then filled in from memory when the list was
 * relayed, which put wrong contract-end years into an investigation. Format
 * explicitly; never slice a stringified Date.
 */
function isoDate(v: unknown): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
}

/** "11734-T-1" -> "T-1". Moroccan plates encode the region here. */
function plateSeries(imm: string): string {
  const m = imm.match(/-([A-Z])-(\d+)$/);
  return m ? `${m[1]}-${m[2]}` : "other";
}

const pct = (a: number, b: number) => (b === 0 ? "—" : `${((100 * a) / b).toFixed(0)}%`);

async function main() {
  const { uri, db: dbName } = loadEnv();
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  // parc is matched on immatriculation AND numero_ww: some parc rows carry the
  // WW number in the plate field, so keying on one field alone under-reports.
  const parcImms = new Set(
    (await db.collection("parc").distinct("immatriculation")).filter(Boolean) as string[]
  );
  const parcWws = new Set(
    (await db.collection("parc").distinct("numero_ww")).filter(Boolean) as string[]
  );
  const inParc = (imm?: string, ww?: string) =>
    (!!imm && (parcImms.has(imm) || parcWws.has(imm))) ||
    (!!ww && (parcImms.has(ww) || parcWws.has(ww)));

  const contracts = await db
    .collection("cp")
    .find({}, { projection: { imm: 1, ww: 1, marque: 1, modele: 1, date_fin_contrat: 1, gestionnaire: 1, statut: 1, client: 1 } })
    .toArray();

  const now = new Date();
  const missing = contracts.filter((r) => !inParc(r.imm as string, r.ww as string));
  const activeMissing = missing.filter(
    (r) => r.date_fin_contrat && new Date(r.date_fin_contrat as string) > now
  );

  // A real plate means the vehicle completed registration; DS history means it
  // has physically been serviced. Both true and it unarguably exists.
  const isWwOnly = (imm: string) => /WW\s*$/i.test(imm) || !/-[A-Z]-\d+$/.test(imm);
  const confirmed: typeof activeMissing = [];
  const pending: typeof activeMissing = [];
  for (const r of activeMissing) {
    const imm = String(r.imm ?? "");
    const ds = await db.collection("ds").countDocuments({ immatriculation: imm });
    (!isWwOnly(imm) && ds > 0 ? confirmed : pending).push({ ...r, dsLines: ds } as typeof r);
  }

  console.log(`\nparc coverage of cp — ${new Date().toISOString().slice(0, 10)}\n`);
  const parcDocs = await db.collection("parc").countDocuments({});
  console.log(`  parc documents                ${parcDocs}  (${parcImms.size} distinct plates)`);
  console.log(`  cp contracts                  ${contracts.length}`);
  console.log(`  cp WITHOUT a parc row         ${missing.length}  (${pct(missing.length, contracts.length)})`);
  console.log(`  ...of which still ACTIVE      ${activeMissing.length}`);
  console.log(`       confirmed anomalies      ${confirmed.length}   <-- real plate + DS history: on the road, must be in parc`);
  console.log(`       awaiting registration    ${pending.length}   (WW-only, no DS history — likely just delivered)\n`);

  // Coverage per series. This does NOT show which series the export excludes —
  // verified against the raw file, it excludes none. It shows where cp has
  // many contracts and parc few rows, which is where to look first.
  const bySeries = new Map<string, { miss: number; total: number }>();
  for (const r of contracts) {
    const s = plateSeries(String(r.imm ?? ""));
    const e = bySeries.get(s) ?? { miss: 0, total: 0 };
    e.total++;
    if (!inParc(r.imm as string, r.ww as string)) e.miss++;
    bySeries.set(s, e);
  }
  console.log("  by plate series (>20 contracts):");
  for (const [s, e] of [...bySeries.entries()].sort((a, b) => b[1].miss / b[1].total - a[1].miss / a[1].total)) {
    if (e.total <= 20) continue;
    const flag = e.miss / e.total > 0.8 ? "  <-- lowest coverage" : "";
    console.log(`    ${s.padEnd(7)} ${String(e.miss).padStart(5)} / ${String(e.total).padStart(5)} missing  ${pct(e.miss, e.total).padStart(4)}${flag}`);
  }

  if (confirmed.length > 0) {
    console.log(`\n  CONFIRMED anomalies — active contract, real plate, has DS history (${confirmed.length}):`);
    for (const r of confirmed) {
      console.log(
        `    ${String(r.imm).padEnd(12)} ww=${String(r.ww ?? "—").padEnd(10)} ` +
          `${String(r.marque ?? "").padEnd(11)}${String(r.modele ?? "").padEnd(11)} ` +
          `fin=${isoDate(r.date_fin_contrat)}  ds=${(r as { dsLines?: number }).dsLines}  ` +
          `statut=${String(r.statut ?? "—").padEnd(18)} ${String(r.client ?? "—").slice(0, 34)}`
      );
    }
  }
  if (pending.length > 0) {
    console.log(`\n  Awaiting registration — WW-only, no DS history (${pending.length}), informational:`);
    console.log(`    ${pending.map((r) => String(r.imm)).slice(0, 12).join(", ")}${pending.length > 12 ? ", …" : ""}`);
  }

  console.log(
    `\n  parc is a full replace of Fullparcs.xls (see ~/import/parc.py), and that` +
      `\n  file was scanned cell-by-cell: the confirmed anomalies are not in it.` +
      `\n  The gap is in the source export — not this app, not the import.` +
      `\n  The file's own scoping columns are Societe (LOCAFINANCE/AVIS/PLF/PSD/` +
      `\n  Divers) and Etat vehicule; ask which of those the export filters on.\n`
  );

  await client.close();
  process.exit(confirmed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("check-parc-coverage failed:", e);
  process.exit(2);
});
