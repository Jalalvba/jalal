// Persistence for DS-History AI analyses.
//
// Until this existed, every analysis was thrown away the moment the page
// unmounted. Only the one-paragraph `summary` survived, written into the
// sheet's `gemini` column — the findings, the interval checks, the cost and
// the tier were gone. So re-opening a vehicle meant paying for the same
// answer again, and on Suivi RL that is now a real ~0.08 MAD per click.
//
// One document per plate, upserted: this stores the CURRENT analysis of a
// vehicle, not a log of every analysis ever run. A re-analysis is a correction
// of the previous one (usually after new interventions landed), and keeping
// every generation would make "what does the app think about this vehicle"
// a question with N answers.
//
// The sheet write is NOT replaced by this. The `gemini` column is the user's
// own artefact — they read it in Sheets, export it, and edit around it — so
// both keep happening: Mongo holds the full analysis for the app, the column
// holds the summary for the human.

import { getCollection } from "@/lib/mongo/client";
// Types and the staleness rule live in a driver-free module so client
// components can import them too — see its header.
import type { StoredDsAnalysis, DsAnalysisSummary } from "@/lib/ai/dsAnalysis/stored";

export type { StoredDsAnalysis, DsAnalysisSummary } from "@/lib/ai/dsAnalysis/stored";
export { isStale } from "@/lib/ai/dsAnalysis/stored";

const COLLECTION = "ds_analyses";

function normalizeImm(imm: string): string {
  return imm.trim().toUpperCase();
}

/**
 * Upsert. Deliberately NEVER throws to its caller — see the call site in
 * /api/ds-history/analyze: the analysis has already been paid for and is
 * already on its way to the user, so a storage failure must degrade to "you
 * pay for it again next time", not to "you don't get the answer you paid for".
 */
export async function saveAnalysis(
  doc: Omit<StoredDsAnalysis, "createdAt" | "updatedAt">
): Promise<boolean> {
  const col = await getCollection<StoredDsAnalysis>(COLLECTION);
  const now = new Date();
  await col.updateOne(
    { imm: normalizeImm(doc.imm) },
    {
      $set: { ...doc, imm: normalizeImm(doc.imm), updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );
  return true;
}

export async function getAnalysis(imm: string): Promise<StoredDsAnalysis | null> {
  const col = await getCollection<StoredDsAnalysis>(COLLECTION);
  return col.findOne({ imm: normalizeImm(imm) }, { projection: { _id: 0 } });
}

/**
 * Every stored analysis, findings stripped.
 *
 * Suivi RL renders ~101 cards at once, so this is ONE request for all of them
 * rather than one per card — the same reasoning as useBddRows(). The findings
 * are excluded because no list card renders them and they are by far the
 * largest part of the document.
 */
export async function getAllSummaries(): Promise<DsAnalysisSummary[]> {
  const col = await getCollection<StoredDsAnalysis>(COLLECTION);
  const docs = await col
    .find({}, {
      projection: {
        _id: 0,
        imm: 1,
        tier: 1,
        entriesCount: 1,
        lastEntryDate: 1,
        updatedAt: 1,
        "analysis.summary": 1,
      },
    })
    .toArray();
  return docs.map((d) => ({
    imm: d.imm,
    tier: d.tier,
    entriesCount: d.entriesCount,
    lastEntryDate: d.lastEntryDate,
    updatedAt: d.updatedAt,
    summary: d.analysis?.summary ?? "",
  }));
}
