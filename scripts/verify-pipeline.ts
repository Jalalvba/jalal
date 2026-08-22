/**
 * End-to-end pipeline check for the DS-History / analysis path.
 *
 * READ-ONLY. Answers one question: does every stage hand the next one the data
 * it actually has, or is something being dropped SILENTLY — a field that is
 * null in the payload while Mongo holds a value, a km that failed to parse, a
 * part designation lost to the dirty-key fallback.
 *
 * Silent is the operative word. A stage that throws gets noticed; a stage that
 * quietly passes `undefined` produces a confident analysis of less data than
 * we have, and nothing anywhere says so.
 *
 *   npx tsx scripts/verify-pipeline.ts [--plates=N]
 */
import "./_loadEnv";
import { getCollection } from "@/lib/mongo/client";
import { getSheetRows } from "@/lib/sheets/googleSheetsBdd";
import { GET as dsHistoryGET } from "@/app/api/ds/history/route";
import { GET as storedGET } from "@/app/api/ds-history/analysis/route";
import { buildDsAnalysisPayload } from "@/lib/ai/dsAnalysis/payload";
import { computeIntervalChecks, checkBeltPump } from "@/lib/ai/prompts/maintenanceIntervals";
import { parseSheetDate } from "@/lib/vehicle/contractEnd";
import { checkOilGrade } from "@/lib/ai/prompts/oilGrade";
import type { DsHistoryItem } from "@/types";

const N = Number(process.argv.find((a) => a.startsWith("--plates="))?.split("=")[1] ?? 25);

type Gap = { stage: string; imm: string; detail: string };
const gaps: Gap[] = [];
const note = (stage: string, imm: string, detail: string) => gaps.push({ stage, imm, detail });

function ms(t: number) { return `${Math.round(performance.now() - t)}ms`; }

async function main() {
  console.log(`=== 1. Google Sheets (BDD tab) ===`);
  let t = performance.now();
  const rows = await getSheetRows(undefined, true);
  console.log(`   ${rows.length} rows in ${ms(t)} (uncached read)`);
  // The cached path is unstable_cache-backed and only exists inside a Next
  // request context, so it cannot be timed from a plain script — measured in
  // the browser instead (see the perf notes in docs/ai.md).

  const plates = rows.map((r) => String(r.IMM ?? "").trim()).filter(Boolean).slice(0, N);

  // Header drift: a column the app reads by name that the live sheet no longer
  // has comes back undefined on every row, silently, forever.
  for (const col of ["IMM", "ETAT", "flag", "gemini", "modele", "Emplacement"]) {
    const present = rows.filter((r) => (r as Record<string, unknown>)[col] !== undefined).length;
    if (present === 0) note("sheets", "-", `column "${col}" is absent from every row — header renamed?`);
    else if (present < rows.length) note("sheets", "-", `column "${col}" missing on ${rows.length - present}/${rows.length} rows`);
  }

  console.log(`\n=== 2. Mongo ds -> /api/ds/history -> payload (${plates.length} plates) ===`);
  const ds = await getCollection("ds");
  let totalItems = 0, totalLines = 0;
  const timings: number[] = [];

  for (const imm of plates) {
    const t0 = performance.now();
    const res = await dsHistoryGET(new Request(`http://x/api/ds/history?imm=${encodeURIComponent(imm)}`));
    timings.push(performance.now() - t0);
    const json = (await res.json()) as { ok: boolean; items?: DsHistoryItem[] };
    if (!json.ok) { note("history", imm, "route returned ok:false"); continue; }
    const items = json.items ?? [];
    totalItems += items.length;

    // Does the route return every DS the collection holds for this plate?
    const raw = await ds.countDocuments({ immatriculation: imm });
    const rawGroups = await ds.distinct("n_ds", { immatriculation: imm });
    if (items.length !== rawGroups.length) {
      note("history", imm, `route returned ${items.length} DS, collection has ${rawGroups.length} distinct n_ds (${raw} lines)`);
    }

    for (const it of items) {
      if (!it.date_ds) note("history", imm, `DS ${it.n_ds} has no date_ds`);
      // km is $convert'd with onError:null — a malformed odometer becomes null
      // and every interval check downstream silently loses that data point.
      if (it.km == null) note("history", imm, `DS ${it.n_ds} has km=null (unparseable odometer)`);
      totalLines += it.lines?.length ?? 0;
      for (const l of it.lines ?? []) {
        // A line with NO designation is only a defect if it is a real line.
        // Measured collection-wide: 6,631 ds documents carry neither the clean
        // nor the dirty designation key, and 6,612 of those have no code_art
        // and qte 0 — empty filler rows in the source export, correctly
        // dropped from the payload. Only the 19 with a real code_art are a
        // genuine gap, so only those are reported; counting the filler made
        // this check noise that would be learned and ignored.
        if (!l.designation_consommation && l.code_art) {
          note("history", imm, `DS ${it.n_ds} line ${l.code_art} has a code_art but no designation_consommation`);
        }
      }
    }

    // Payload stage: what the model is actually told.
    const payload = buildDsAnalysisPayload({ imm, items });
    if (payload.entries.length !== items.length) {
      note("payload", imm, `${items.length} items -> ${payload.entries.length} entries`);
    }
    // Same rule as above: compare against the lines that actually name a part.
    const realLines = items.reduce(
      (n, it) => n + (it.lines ?? []).filter((l) => String(l.designation_consommation ?? "").trim()).length,
      0
    );
    const lostParts = realLines - payload.entries.reduce((n, e) => n + e.parts.length, 0);
    if (lostParts > 0) note("payload", imm, `${lostParts} named part designation(s) dropped between history and payload`);
    const withKm = payload.entries.filter((e) => e.km != null).length;
    if (withKm === 0 && items.length > 0) note("payload", imm, "no entry carries a km — every interval check will be INDÉTERMINÉ");

    // Computed checks: they must run, not throw, and say something.
    try {
      const checks = computeIntervalChecks(payload.entries);
      if (checks.length === 0) note("checks", imm, "computeIntervalChecks produced nothing");
      checkBeltPump(payload.entries);
      checkOilGrade(payload.entries);
    } catch (e) {
      note("checks", imm, `threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  timings.sort((a, b) => a - b);
  console.log(`   ${totalItems} DS, ${totalLines} lines`);
  console.log(`   /api/ds/history per plate: median ${Math.round(timings[Math.floor(timings.length / 2)])}ms, p90 ${Math.round(timings[Math.floor(timings.length * 0.9)])}ms, max ${Math.round(timings[timings.length - 1])}ms`);

  console.log(`\n=== 2b. Contract end coverage ===`);
  // "Date de fin de contrat indisponible" is only honest when no source has
  // one. Both sources are checked here because each alone leaves vehicles
  // uncovered, and because a query written against the wrong field name
  // reports "no contract" for every vehicle rather than failing (cp keys on
  // `imm`, ds and parc on `immatriculation`).
  const cpCol = await getCollection("cp");
  let fromCp = 0, fromSheet = 0, resolvable = 0, unknown = 0, disagree = 0;
  for (const r of rows) {
    const imm = String(r.IMM ?? "").trim();
    if (!imm) continue;
    const sheetIso = parseSheetDate((r as Record<string, unknown>).date_fin_contrat);
    const doc = await cpCol.findOne({ imm, date_fin_contrat: { $ne: null } }, { projection: { date_fin_contrat: 1 } });
    const cpIso = doc?.date_fin_contrat ? new Date(doc.date_fin_contrat as Date).toISOString() : null;
    if (cpIso) fromCp++;
    if (sheetIso) fromSheet++;
    if (cpIso || sheetIso) resolvable++; else unknown++;
    if (cpIso && sheetIso && cpIso.slice(0, 10) !== sheetIso.slice(0, 10)) {
      disagree++;
      note("contract", imm, `cp says ${cpIso.slice(0, 10)}, BDD sheet says ${sheetIso.slice(0, 10)}`);
    }
  }
  console.log(`   cp has a date: ${fromCp}   BDD sheet has one: ${fromSheet}   resolvable: ${resolvable}/${rows.length}   genuinely unknown: ${unknown}`);
  console.log(`   sources disagreeing: ${disagree}`);

  console.log(`\n=== 2c. Odometer coherence ===`);
  // A reading lower than the one before it is a data-entry error in the
  // source. The interval checks refuse to compute across one (INDÉTERMINÉ)
  // rather than reporting a distance they cannot trust, so this is reported,
  // never worked around.
  let platesWithRecul = 0, reculReadings = 0;
  const worst: { imm: string; km: number; date: string }[] = [];
  for (const imm of plates) {
    const res2 = await dsHistoryGET(new Request(`http://x/api/ds/history?imm=${encodeURIComponent(imm)}`));
    const items2 = ((await res2.json()) as { items?: DsHistoryItem[] }).items ?? [];
    if (!items2.length) continue;
    const chron = buildDsAnalysisPayload({ imm, items: items2 }).entries.slice().reverse();
    let prev: number | null = null, w = 0, when = "";
    for (const e of chron) {
      if (e.km == null) continue;
      if (prev != null && e.km < prev) {
        reculReadings++;
        if (prev - e.km > w) { w = prev - e.km; when = e.date?.slice(0, 10) ?? "?"; }
      }
      prev = e.km;
    }
    if (w > 0) { platesWithRecul++; worst.push({ imm, km: w, date: when }); }
  }
  console.log(`   plates with a backwards odometer reading: ${platesWithRecul}/${plates.length}`);
  console.log(`   backwards readings in total            : ${reculReadings}`);
  for (const w of worst.sort((a, b) => b.km - a.km).slice(0, 8)) {
    console.log(`     ${w.imm.padEnd(12)} -${String(Math.round(w.km)).padStart(7)} km at ${w.date}`);
  }

  console.log(`\n=== 3. Stored analyses (ds_analyses) ===`);
  t = performance.now();
  const listRes = await storedGET(new Request("http://x/api/ds-history/analysis"));
  const list = (await listRes.json()) as { ok: boolean; summaries?: unknown[] };
  console.log(`   list of ${list.summaries?.length ?? 0} summaries in ${ms(t)}`);
  const stored = await getCollection("ds_analyses");
  const docs = await stored.find({}, { projection: { imm: 1, entriesCount: 1, "analysis.summary": 1, tier: 1 } }).toArray();
  for (const d of docs) {
    if (!d.analysis?.summary) note("ds_analyses", String(d.imm), "stored document has no summary");
    if (d.entriesCount == null) note("ds_analyses", String(d.imm), "stored document has no entriesCount — staleness cannot be computed");
  }

  console.log(`\n=== 4. Identity (parc + cp) ===`);
  const parc = await getCollection("parc");
  const cp = await getCollection("cp");
  let noIdentity = 0;
  for (const imm of plates) {
    const [p, c] = await Promise.all([
      parc.countDocuments({ immatriculation: imm }),
      cp.countDocuments({ immatriculation: imm }),
    ]);
    if (p === 0 && c === 0) noIdentity++;
  }
  console.log(`   ${plates.length - noIdentity}/${plates.length} plates resolve to a parc and/or cp record`);

  console.log(`\n=== Result ===`);
  if (gaps.length === 0) {
    console.log("No silent gaps found.");
    return;
  }
  const byStage = new Map<string, Gap[]>();
  for (const g of gaps) (byStage.get(g.stage) ?? byStage.set(g.stage, []).get(g.stage)!).push(g);
  for (const [stage, list2] of byStage) {
    console.log(`\n${stage}: ${list2.length} finding(s)`);
    const byDetail = new Map<string, number>();
    for (const g of list2) {
      const k = g.detail.replace(/DS \S+/, "DS …").replace(/line \S+/, "line …").replace(/\d+/g, "N");
      byDetail.set(k, (byDetail.get(k) ?? 0) + 1);
    }
    for (const [k, n] of [...byDetail.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.log(`   ${String(n).padStart(5)}x  ${k}`);
    }
    for (const g of list2.slice(0, 3)) console.log(`          e.g. ${g.imm}: ${g.detail}`);
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
