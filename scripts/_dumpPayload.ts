import "./_loadEnv";
import { writeFileSync } from "node:fs";
import { GET } from "@/app/api/ds/history/route";
import { buildDsAnalysisPayload } from "@/lib/ai/dsAnalysis/payload";
import { buildDsAnalysisPrompt, computeContractStatus, canonicalizeSuppliers } from "@/lib/ai/prompts/dsAnalysis";
import { computeIntervalChecks, formatIntervalChecks, checkBeltPump, formatBeltPumpCheck } from "@/lib/ai/prompts/maintenanceIntervals";
import { checkOilGrade, formatOilGradeCheck } from "@/lib/ai/prompts/oilGrade";
import type { DsHistoryItem } from "@/types";

const plates = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const out = process.argv.find((a) => a.startsWith("--out="))!.slice(6);

(async () => {
  const blocks: string[] = [];
  for (const imm of plates) {
    const res = await GET(new Request(`http://x/api/ds/history?imm=${encodeURIComponent(imm)}`));
    const items = ((await res.json()) as { items?: DsHistoryItem[] }).items ?? [];
    const raw = buildDsAnalysisPayload({ imm, items });
    const input = { ...raw, entries: canonicalizeSuppliers(raw.entries) };
    const cs = computeContractStatus(input.contractEnd);
    const lines = [
      ...formatIntervalChecks(computeIntervalChecks(input.entries)),
      ...formatBeltPumpCheck(checkBeltPump(input.entries)),
      ...formatOilGradeCheck(checkOilGrade(input.entries)),
    ];
    blocks.push(`===== ${imm} (${input.entries.length} interventions) =====\n` + buildDsAnalysisPrompt(input, cs, lines));
  }
  writeFileSync(out, blocks.join("\n\n"));
  console.log("wrote", out);
})().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
