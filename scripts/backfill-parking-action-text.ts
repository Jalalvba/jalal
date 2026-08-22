/**
 * One-off: records, for each PARKING row, that this app wrote the text now in
 * its ACTION cell — for rows where that record is missing.
 *
 * WHY THIS EXISTS. The batch refuses to overwrite an ACTION cell it cannot
 * prove it wrote itself (mayOverwrite), which is right: the column is shared
 * with the team. But an early version of the no-history path wrote cells
 * WITHOUT recording them, so those rows became permanently frozen — reported
 * "manual" on every run, unable to be refreshed even though the text is ours.
 *
 * The signal used here is the numbering: this app writes "1. …\\n2. …", and a
 * person types "DISPONIBLE" or a sentence. A cell whose FIRST line matches
 * `N. ` is machine-written; anything else is left alone. Deliberately narrow —
 * it recovers what we broke and touches nothing else.
 *
 * Run:  npx tsx scripts/backfill-parking-action-text.ts [--apply]
 * Without --apply it only reports.
 */
import "./_loadEnv";
import { getParkingRows } from "@/lib/sheets/googleSheetsParking";
import { getAnalysis, recordActionText, saveAnalysis } from "@/lib/mongo/dsAnalyses";

const APPLY = process.argv.includes("--apply");
const MACHINE_WRITTEN = /^\s*1\.\s+\S/;

(async () => {
  const rows = await getParkingRows(true);
  let already = 0, human = 0, empty = 0;
  const toFix: { imm: string; text: string; hasDoc: boolean }[] = [];

  for (const row of rows) {
    const text = String(row.action ?? "").trim();
    if (!text) { empty++; continue; }
    const stored = await getAnalysis(row.imm);
    if (stored?.actionText?.trim() === text) { already++; continue; }
    if (!MACHINE_WRITTEN.test(text)) { human++; continue; }
    toFix.push({ imm: row.imm, text, hasDoc: stored != null });
  }

  console.log(`${rows.length} rows — ${already} already recorded, ${human} hand-written (untouched), ${empty} empty`);
  console.log(`${toFix.length} machine-written but unrecorded:`);
  for (const f of toFix) console.log(`   ${f.imm.padEnd(12)} ${f.hasDoc ? "" : "(no analysis document) "}${f.text.split("\n")[0]}`);

  if (!APPLY) return console.log("\nDry run. Re-run with --apply to record them.");

  for (const f of toFix) {
    if (!f.hasDoc) {
      // recordActionText updates and does not upsert, so a plate with no
      // analysis needs a document first.
      await saveAnalysis({
        imm: f.imm,
        analysis: {
          contractFlag: { level: "unknown", label: "" },
          actions: f.text.split("\n").map((l) => l.replace(/^\s*\d+\.\s*/, "")),
          findings: [],
          summary: "Document créé par le backfill : le contenu de la cellule ACTION avait été écrit sans être enregistré.",
          insufficientData: true,
        },
        tier: "standard",
        model: "aucun (backfill)",
        costUsd: 0,
        entriesCount: 0,
        lastEntryDate: null,
        promptHash: "backfill",
      });
    }
    await recordActionText(f.imm, f.text);
  }
  console.log(`\nRecorded ${toFix.length} cells. They can be refreshed normally from now on.`);
})().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
