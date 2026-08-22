// Generates the work order for a batch of PARKING rows and writes it into
// each row's ACTION cell.
//
// Why a batch endpoint and not the existing per-card button: the point is one
// click for the whole tab (84 rows live). Doing that from the browser as 84
// separate analyses would take ~9 minutes against this route's own rate limit
// and show nothing useful while it ran. The client sends small batches, this
// route answers with a per-plate verdict, and the page reports progress.
//
// Three rules hold this together:
//
//   1. A stored analysis is REUSED when the history has not moved since — so
//      the second run over the tab costs nothing and takes seconds. Only
//      vehicles that are new, or that have been worked on since, reach the
//      model.
//   2. The ACTION column belongs to the team too — it holds values like
//      "DISPONIBLE" typed by hand. A cell is written only when it is empty or
//      still holds this app's own previous output byte for byte
//      (mayOverwrite). Anything else is reported as `manual` and left alone.
//   3. One vehicle failing never sinks the batch: every plate gets its own
//      verdict.

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { rateLimitOrNull } from "@/lib/http/rateLimit";
import { AiCallError } from "@/lib/ai";
import { log, serializeError } from "@/lib/http/logger";
import { GET as dsHistoryGET } from "@/app/api/ds/history/route";
import { buildDsAnalysisPayload } from "@/lib/ai/dsAnalysis/payload";
import { canonicalizeSuppliers } from "@/lib/ai/prompts/dsAnalysis";
import { runDsAnalysis, resolveTier } from "@/lib/ai/dsAnalysis/run";
import { getAnalysis, recordActionText } from "@/lib/mongo/dsAnalyses";
import { isStale } from "@/lib/ai/dsAnalysis/stored";
import { formatWorkOrder, mayOverwrite } from "@/lib/ai/dsAnalysis/workOrder";
import { getParkingRows, updateAction } from "@/lib/sheets/googleSheetsParking";
import type { DsHistoryItem } from "@/types";

// Generous: a batch is at most BATCH_MAX plates and the client walks the tab
// in sequence, so this is ~10 batches for the whole of PARKING.
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 1000;
// Small enough that one request stays well inside the function timeout even
// when every plate in it needs a real analysis (~5s each).
const BATCH_MAX = 8;

type Outcome =
  | "written"       // the cell now holds a fresh work order
  | "reused"        // ...and it came from a stored analysis, no model call
  | "manual"        // someone typed in that cell; left untouched
  | "no-action"     // nothing to do on this vehicle
  | "no-history"    // no DS to analyse
  | "no-row"        // plate is not on the PARKING tab
  | "failed";

type Result = { imm: string; outcome: Outcome; actions?: number; error?: string; costUsd?: number };

export async function POST(request: Request) {
  const limited = await rateLimitOrNull(request, "parking-actions", RATE_LIMIT, RATE_WINDOW_MS);
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

  // One read for the whole batch: rows carry both the sheet row index the
  // write needs and the current ACTION text the overwrite rule needs.
  const rows = await getParkingRows();
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

      const raw = buildDsAnalysisPayload({ imm, items });
      const input = { ...raw, entries: canonicalizeSuppliers(raw.entries) };

      // Reuse before spending: only a vehicle whose history has moved since
      // its stored analysis needs the model again.
      const stored = await getAnalysis(imm);
      const fresh =
        stored != null &&
        !isStale(stored, { entriesCount: input.entries.length, lastEntryDate: input.entries[0]?.date ?? null });

      const analysis = fresh ? stored!.analysis : (await runDsAnalysis(input, tier)).analysis;
      const costUsd = fresh ? 0 : undefined;

      const text = formatWorkOrder(analysis);
      if (!text) {
        results.push({ imm, outcome: "no-action" });
        continue;
      }

      if (!mayOverwrite(String(row.action ?? ""), stored?.actionText)) {
        results.push({ imm, outcome: "manual" });
        continue;
      }

      // updateAction() re-reads the row's IMM cell and refuses on a mismatch
      // (verifyRowIdentity, AGENTS.md rule 3) — the same guard a manual edit
      // goes through, which matters more here because nobody is watching each
      // individual write.
      await updateAction(row.rowIndex, text, row.imm);
      await recordActionText(imm, text);

      results.push({
        imm,
        outcome: fresh ? "reused" : "written",
        actions: analysis.actions?.length ?? 0,
        costUsd,
      });
    } catch (e) {
      const msg = e instanceof AiCallError ? e.kind : e instanceof Error ? e.message : String(e);
      log("warn", "parking-actions", "Plate failed", { imm, ...serializeError(e) });
      results.push({ imm, outcome: "failed", error: msg });
    }
  }

  return NextResponse.json({ ok: true, results });
}
