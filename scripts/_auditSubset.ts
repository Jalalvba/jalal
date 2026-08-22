import "./_loadEnv";
// Re-runs the analysis for an explicit plate list (the ETAT=INTERNE/flag=REP
// filtered set), reusing the audit harness's grading by shelling out is not
// possible, so this simply prints the fresh analyses for eyeball comparison.
import { GET } from "@/app/api/ds/history/route";
import { buildDsAnalysisPayload } from "@/lib/ai/dsAnalysis/payload";
import {
  buildDsAnalysisPrompt, computeContractStatus, canonicalizeSuppliers, DS_ANALYSIS_SYSTEM_PROMPT,
} from "@/lib/ai/prompts/dsAnalysis";
import {
  computeIntervalChecks, formatIntervalChecks, checkBeltPump, formatBeltPumpCheck,
} from "@/lib/ai/prompts/maintenanceIntervals";
import { checkOilGrade, formatOilGradeCheck } from "@/lib/ai/prompts/oilGrade";
import { callAI } from "@/lib/ai";
import type { DsHistoryItem } from "@/types";
import { writeFileSync } from "node:fs";

(async () => {
  const plates = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const out = process.argv.find((a) => a.startsWith("--out="))?.slice(6);
  const all: unknown[] = [];
  for (const imm of plates) {
    const res = await GET(new Request(`http://x/api/ds/history?imm=${encodeURIComponent(imm)}`));
    const items = ((await res.json()) as { items?: DsHistoryItem[] }).items ?? [];
    if (!items.length) { console.log(`### ${imm} — aucune intervention`); continue; }
    const raw = buildDsAnalysisPayload({ imm, items });
    const input = { ...raw, entries: canonicalizeSuppliers(raw.entries) };
    const cs = computeContractStatus(input.contractEnd);
    const lines = [
      ...formatIntervalChecks(computeIntervalChecks(input.entries)),
      ...formatBeltPumpCheck(checkBeltPump(input.entries)),
      ...formatOilGradeCheck(checkOilGrade(input.entries)),
    ];
    const { text } = await callAI({
      action: "ds-history-analysis-audit",
      model: "gemini-flash-latest",
      prompt: buildDsAnalysisPrompt(input, cs, lines),
      systemPrompt: DS_ANALYSIS_SYSTEM_PROMPT,
      maxTokens: 5000, temperature: 0.2, timeoutMs: 60_000,
    });
    const a = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
    all.push({ imm, analysis: a });
    console.log(`### ${imm} (${a.findings.length} constats)`);
    for (const f of a.findings) console.log("  *", f.title, "::", String(f.detail).slice(0, 250));
    console.log("  SUMMARY:", a.summary);
    await new Promise((r) => setTimeout(r, 1200));
  }
  if (out) writeFileSync(out, JSON.stringify(all, null, 2));
})().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
