/**
 * READ-ONLY audit harness for the DS-History "Analyse IA" prompt.
 *
 * Runs the real analysis pipeline (same payload builder, same computed checks,
 * same system prompt, same guards as /api/ds-history/analyze) over every plate
 * on the BDD / Suivi RL tab, then GRADES each answer against the source data
 * in code — no model judging a model.
 *
 * Writes nothing to Sheets or Mongo except the ordinary gemini_usage cost row
 * that callAI() records for any real call.
 *
 *   npx tsx scripts/audit-ds-analysis.ts [--model=<id>] [--limit=N] [--out=file]
 */
import "./_loadEnv";
import { writeFileSync } from "node:fs";

import { getSheetRows } from "@/lib/sheets/googleSheetsBdd";
import { GET as dsHistoryGET } from "@/app/api/ds/history/route";
import { buildDsAnalysisPayload } from "@/lib/ai/dsAnalysis/payload";
import {
  buildDsAnalysisPrompt,
  computeContractStatus,
  dsAnalysisShapeError,
  ungroundedDates,
  ungroundedSuppliers,
  canonicalizeSuppliers,
  DS_ANALYSIS_SYSTEM_PROMPT,
  type DsAnalysis,
  type DsAnalysisInput,
} from "@/lib/ai/prompts/dsAnalysis";
import {
  computeIntervalChecks,
  formatIntervalChecks,
  checkBeltPump,
  formatBeltPumpCheck,
} from "@/lib/ai/prompts/maintenanceIntervals";
import { checkOilGrade, formatOilGradeCheck } from "@/lib/ai/prompts/oilGrade";
import { callAI } from "@/lib/ai";
import type { DsHistoryItem } from "@/types";

const arg = (k: string, d?: string) =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=") ?? d;

const MODEL = arg("model", "gemini-flash-lite-latest")!;
const LIMIT = Number(arg("limit", "999"));
const OUT = arg("out", `/tmp/ds-audit-${MODEL}.json`)!;
const MAX_OUTPUT_TOKENS = Number(arg("maxTokens", "1800"));
const TEMPERATURE = 0.2;

// ── grading helpers ────────────────────────────────────────────────────────

const deaccent = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Words too generic to identify an organ. */
const STOP = new Set([
  "avant","arriere","droit","gauche","complet","complete","jeu","kit","piece","pieces",
  "vehicule","reparation","changement","controle","montage","demontage","main","oeuvre",
  "prestation","forfait","divers","autre","autres","unite","gros","petit","neuf","occasion",
  "pour","avec","sans","dans","plus","moins","type","modele","serie","paire","lot","ref",
  "reference","code","article","designation","consommation","travaux","fourniture","pose",
  "remplacement","revision","entretien","general","standard","special","grand","petite",
  // Not organs: labour lines, consumables and the operations the interval
  // checks already cover. Left in, they made every vehicle look like it had a
  // dozen "missed recurrences" — grader noise, not model error.
  "diagnostic","diagnostique","huile","vidange","mecanique","essence","gasoil","gazole",
  "lubrifiant","graisse","liquide","produit","nettoyage","lavage","controle","verification",
  "oeuv","doeuv","dœuv","atelier","garage","facture","devis","transport","deplacement",
]);

function organTokens(part: string): string[] {
  return deaccent(part)
    .replace(/[^a-z ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 5 && !STOP.has(w))
    .map((w) => w.replace(/(eurs|eur|es|s)$/, "")); // crude singularisation
}

/** Organs appearing in >= 2 DISTINCT interventions — the axis-2 ground truth. */
function realPartRecurrences(input: DsAnalysisInput) {
  const byToken = new Map<string, Set<string>>();
  const sample = new Map<string, string>();
  input.entries.forEach((e, i) => {
    const seen = new Set<string>();
    for (const p of e.parts) {
      for (const t of organTokens(p)) {
        if (seen.has(t)) continue;
        seen.add(t);
        (byToken.get(t) ?? byToken.set(t, new Set()).get(t)!).add(`${i}`);
        if (!sample.has(t)) sample.set(t, p);
      }
    }
  });
  return [...byToken.entries()]
    .filter(([, s]) => s.size >= 2)
    .map(([t, s]) => ({ token: t, count: s.size, sample: sample.get(t)! }))
    .sort((a, b) => b.count - a.count);
}

/** Suppliers with >= 3 interventions — the axis-3 ground truth (rule 9). */
function realSupplierRecurrences(input: DsAnalysisInput) {
  const c = new Map<string, number>();
  for (const e of input.entries) if (e.supplier) c.set(e.supplier, (c.get(e.supplier) ?? 0) + 1);
  return [...c.entries()].filter(([, n]) => n >= 3).map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function analysisText(a: DsAnalysis): string {
  return deaccent([a.summary, ...a.findings.flatMap((f) => [f.title, f.detail])].join(" \n "));
}

/** A claimed count next to a supplier name: "X ... 5 interventions" etc. */
function claimedSupplierCount(a: DsAnalysis, name: string): number | null {
  const n = deaccent(name);
  for (const f of a.findings) {
    const t = deaccent(`${f.title} ${f.detail}`);
    if (!t.includes(n)) continue;
    const m = t.match(/(\d+)\s*(?:fois|interventions?|reprises|occurrences?)/);
    if (m) return Number(m[1]);
  }
  return null;
}

// ── one plate ──────────────────────────────────────────────────────────────

async function analyseOne(imm: string) {
  const res = await dsHistoryGET(new Request(`http://x/api/ds/history?imm=${encodeURIComponent(imm)}`));
  const j = (await res.json()) as { ok: boolean; items?: DsHistoryItem[] };
  const items = j.items ?? [];
  if (items.length === 0) return { imm, skipped: "no-history" as const };

  const raw = buildDsAnalysisPayload({ imm, items });
  const input: DsAnalysisInput = { ...raw, entries: canonicalizeSuppliers(raw.entries) };

  const contractStatus = computeContractStatus(input.contractEnd);
  const intervalChecks = computeIntervalChecks(input.entries);
  const beltPumpCheck = checkBeltPump(input.entries);
  const oilGradeCheck = checkOilGrade(input.entries);
  const checkLines = [
    ...formatIntervalChecks(intervalChecks),
    ...formatBeltPumpCheck(beltPumpCheck),
    ...formatOilGradeCheck(oilGradeCheck),
  ];
  const prompt = buildDsAnalysisPrompt(input, contractStatus, checkLines);

  const { text, costInfo } = await callAI({
    action: "ds-history-analysis-audit",
    model: MODEL,
    prompt,
    systemPrompt: DS_ANALYSIS_SYSTEM_PROMPT,
    maxTokens: MAX_OUTPUT_TOKENS,
    temperature: TEMPERATURE,
    timeoutMs: 60_000,
  });

  const stripped = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const shapeError = dsAnalysisShapeError(JSON.parse(stripped));
  const analysis = JSON.parse(stripped) as DsAnalysis;
  const body = analysisText(analysis);

  // ── grading ──
  const parts = realPartRecurrences(input);
  const missedParts = parts.filter((p) => !body.includes(p.token)).slice(0, 8);
  const sups = realSupplierRecurrences(input);
  const missedSuppliers = sups.filter((s) => !body.includes(deaccent(s.name)));
  // Rule 3: a recurrence claim must carry as many dates as it claims
  // occurrences. Fewer means the evidence is padded with prose
  // ("et des interventions associées") instead of cited.
  const DATE_LIT = /\b(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})\b/g;
  const unevidenced = analysis.findings
    .map((f) => {
      const t = `${f.title} ${f.detail}`;
      const m = deaccent(t).match(/(\d+)\s*(?:fois|interventions?|reprises|occurrences?)/);
      if (!m) return null;
      const claimed = Number(m[1]);
      const listed = new Set(t.match(DATE_LIT) ?? []).size;
      return listed < claimed ? { title: f.title, claimed, listed } : null;
    })
    .filter(Boolean);

  const wrongCounts = sups
    .map((s) => ({ ...s, claimed: claimedSupplierCount(analysis, s.name) }))
    .filter((s) => s.claimed != null && s.claimed !== s.count);

  // rule 14: every non-conforming computed check must get its own finding
  const CHECK_KEYS: [RegExp, string[]][] = [
    [/vidange/i, ["vidange"]],
    [/filtre a air|filtre à air/i, ["filtre a air", "filtre d'air"]],
    [/filtre a gasoil|filtre à gasoil|gazole|gasoil/i, ["gasoil", "gazole", "carburant"]],
    [/distribution|pompe/i, ["distribution", "pompe a eau"]],
    [/grade/i, ["grade"]],
  ];
  const flaggedLines = checkLines.filter((l) =>
    /DÉPASSÉ|JAMAIS ENREGISTRÉ|NON VÉRIFIÉ|INDÉTERMINÉ/.test(l)
  );
  const missedChecks = flaggedLines.filter((l) => {
    const keys = CHECK_KEYS.find(([re]) => re.test(l))?.[1] ?? [];
    return keys.length > 0 && !keys.some((k) => body.includes(deaccent(k)));
  });

  // Rule 15/16: a check the code did not supply must not appear at all. Six of
  // 98 baseline analyses invented a whole "grade d'huile" finding — complete
  // with a verbatim-looking "Grades utilisés : ..." line — on vehicles where
  // checkOilGrade() produced nothing.
  const inventedOilGrade =
    !checkLines.some((l) => /grade/i.test(l)) && /grade/i.test(body);
  // A date written as a raw Mongo timestamp ("2024-01-07T00:00:00.000Z") in
  // French prose. Grounded, but unreadable.
  const isoTimestamps = /T00:00:00/.test(JSON.stringify(analysis));

  return {
    imm,
    entries: input.entries.length,
    model: MODEL,
    servedModel: costInfo.servedModel,
    costUsd: costInfo.costUsd,
    inputTokens: costInfo.inputTokens,
    outputTokens: costInfo.outputTokens,
    shapeError,
    contractLevelMismatch:
      analysis.contractFlag.level !== contractStatus.level
        ? `${analysis.contractFlag.level} vs ${contractStatus.level}`
        : null,
    ungroundedDates: ungroundedDates(analysis, input),
    ungroundedSuppliers: ungroundedSuppliers(analysis, input),
    findingCount: analysis.findings.length,
    insufficientData: analysis.insufficientData,
    truth: { partRecurrences: parts.slice(0, 12), supplierRecurrences: sups, flaggedChecks: flaggedLines },
    missedParts,
    missedSuppliers,
    wrongCounts,
    unevidenced,
    inventedOilGrade,
    isoTimestamps,
    missedChecks,
    checkLines,
    analysis,
  };
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  const rows = await getSheetRows(undefined, true);
  const plates = [...new Set(rows.map((r) => String(r.IMM ?? "").trim()).filter(Boolean))].slice(0, LIMIT);
  console.log(`[audit] ${plates.length} plates, model=${MODEL}`);

  const results: unknown[] = [];
  for (const [i, imm] of plates.entries()) {
    try {
      const r = await analyseOne(imm);
      results.push(r);
      const tag =
        "skipped" in r
          ? "skip"
          : [
              r.shapeError && "SHAPE",
              r.ungroundedDates.length && `dates:${r.ungroundedDates.length}`,
              r.ungroundedSuppliers.length && `sup:${r.ungroundedSuppliers.length}`,
              r.missedSuppliers.length && `missSup:${r.missedSuppliers.length}`,
              r.missedChecks.length && `missChk:${r.missedChecks.length}`,
              r.wrongCounts.length && `badCount:${r.wrongCounts.length}`,
              r.unevidenced.length && `noEvid:${r.unevidenced.length}`,
              r.inventedOilGrade && "INVENTED-GRADE",
              r.isoTimestamps && "isoDates",
              r.missedParts.length && `missPart:${r.missedParts.length}`,
            ].filter(Boolean).join(" ") || "clean";
      console.log(`[${i + 1}/${plates.length}] ${imm} — ${tag}`);
    } catch (e) {
      console.log(`[${i + 1}/${plates.length}] ${imm} — ERROR ${e instanceof Error ? e.message : String(e)}`);
      results.push({ imm, error: String(e) });
    }
    await new Promise((r) => setTimeout(r, 1500)); // stay under the free-tier RPM
  }

  writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(`\n[audit] wrote ${OUT}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
