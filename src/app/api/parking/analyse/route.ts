// Parking's DS analysis: fills the tab's own `gemini` column, and touches
// NOTHING else.
//
// Deliberately not /api/bdd/gemini, which fans a summary out to
// BDD + ATELIER + PARKING. From the Parking page that fan-out is wrong: it
// writes into two tabs the user is not looking at, and makes an action taken
// on one page appear on another. Parking owns its own column (verified live —
// the tab has a `gemini` header of its own) and this route writes only there.
//
// Same shape as the sibling /api/parking/actions, and the same three rules:
// a stored analysis is reused when the history has not moved, a plate that
// fails gets its own verdict rather than sinking the batch, and one request
// carries at most BATCH_MAX plates so it stays inside the function timeout.
//
// The difference is which question is asked: this one runs the DS History
// analysis prompt (findings + summary, for reading), while /actions runs
// prompt-parking.ts (a work order, for booking). Two columns, two prompts,
// one store.

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { rateLimitOrNull } from "@/lib/http/rateLimit";
import { AiCallError } from "@/lib/ai";
import { log, serializeError } from "@/lib/http/logger";
import { GET as dsHistoryGET } from "@/app/api/ds/history/route";
import { buildDsAnalysisPayload } from "@/lib/ai/dsAnalysis/payload";
import { canonicalizeSuppliers } from "@/lib/ai/prompts/dsAnalysis";
import { runDsAnalysis, resolveTier } from "@/lib/ai/dsAnalysis/run";
import { resolveCpStatus } from "@/lib/vehicle/contractEnd";
import { getAnalysis } from "@/lib/mongo/dsAnalyses";
import { isStale, promptFingerprint } from "@/lib/ai/dsAnalysis/stored";
import { DS_ANALYSIS_SYSTEM_PROMPT } from "@/lib/ai/prompts/dsAnalysis";
import { getParkingRows, writeParkingGeminiSummary } from "@/lib/sheets/googleSheetsParking";
import type { DsHistoryItem } from "@/types";

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 1000;
const BATCH_MAX = 8;

type Outcome = "written" | "reused" | "no-summary" | "no-history" | "no-row" | "failed";
type Result = { imm: string; outcome: Outcome; error?: string };

export async function POST(request: Request) {
  const limited = await rateLimitOrNull(request, "parking-analyse", RATE_LIMIT, RATE_WINDOW_MS);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const imms = Array.isArray(b.imms)
    ? b.imms.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean).slice(0, BATCH_MAX)
    : [];
  if (imms.length === 0) {
    return NextResponse.json({ ok: false, error: "imms est requis" }, { status: 400 });
  }
  const tier = resolveTier(b.quality);
  // Re-analyse instead of reusing. For a vehicle whose stored answer looks
  // wrong — not a default, since reuse is the whole point of the store.
  const force = b.force === true;

  // Fresh for the same reason as the sibling /actions route.
  const rows = await getParkingRows(true);
  const results: Result[] = [];

  for (const imm of imms) {
    const row = rows.find((r) => r.imm.trim().toUpperCase() === imm.toUpperCase());
    if (!row) {
      results.push({ imm, outcome: "no-row" });
      continue;
    }

    try {
      const histRes = await dsHistoryGET(
        new Request(`http://internal/api/ds/history?imm=${encodeURIComponent(imm)}`)
      );
      const items = ((await histRes.json()) as { items?: DsHistoryItem[] }).items ?? [];
      if (items.length === 0) {
        results.push({ imm, outcome: "no-history" });
        continue;
      }

      const raw = buildDsAnalysisPayload({
        imm,
        items,
        vehicle: {
          state: String(row.etatVehicule ?? "").trim() || undefined,
          cpStatus: (await resolveCpStatus(imm)) ?? undefined,
          // Resolved on the row itself (parc tab: Client, else Société), so
          // the model is told who owns the vehicle rather than being left to
          // guess from a company name.
          owner: String(row.client ?? "").trim() || undefined,
          isAvis: row.isAvis === true,
        },
      });
      const input = { ...raw, entries: canonicalizeSuppliers(raw.entries) };

      // Every analysis carries a summary, whichever prompt produced it, so
      // reuse here only asks whether the history has moved — unlike /actions,
      // which also has to check that the stored answer contains actions at all.
      const stored = await getAnalysis(imm);
      const fresh =
        !force &&
        stored != null &&
        stored.promptHash === promptFingerprint(DS_ANALYSIS_SYSTEM_PROMPT) &&
        !isStale(stored, { entriesCount: input.entries.length, lastEntryDate: input.entries[0]?.date ?? null });

      // No prompt argument: this is the DS History analysis, the default.
      const analysis = fresh ? stored!.analysis : (await runDsAnalysis(input, tier)).analysis;

      const summary = analysis.summary?.trim() ?? "";
      if (!summary) {
        results.push({ imm, outcome: "no-summary" });
        continue;
      }

      const write = await writeParkingGeminiSummary(imm, summary);
      if (!write.ok) {
        // Both: the reason is the category, the error is what actually went
        // wrong — dropping the latter is how a write failure becomes
        // unexplainable from the client.
        results.push({
          imm,
          outcome: "failed",
          error: "error" in write && write.error ? `${write.reason}: ${write.error}` : write.reason,
        });
        continue;
      }

      results.push({ imm, outcome: fresh ? "reused" : "written" });
    } catch (e) {
      const msg = e instanceof AiCallError ? e.kind : e instanceof Error ? e.message : String(e);
      log("warn", "parking-analyse", "Plate failed", { imm, ...serializeError(e) });
      results.push({ imm, outcome: "failed", error: msg });
    }
  }

  return NextResponse.json({ ok: true, results });
}
