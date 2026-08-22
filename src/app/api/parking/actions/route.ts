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
import { resolveCpStatus } from "@/lib/vehicle/contractEnd";
import { DS_PARKING_WORKORDER_PROMPT } from "@/lib/ai/dsAnalysis/prompt-parking";
import { getAnalysis, recordActionText } from "@/lib/mongo/dsAnalyses";
import { isStale, promptFingerprint } from "@/lib/ai/dsAnalysis/stored";
import { formatWorkOrder, mayOverwrite, statusWorkOrder } from "@/lib/ai/dsAnalysis/workOrder";
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
  // Re-analyse even when a usable stored answer exists. For the vehicle whose
  // work order looks wrong — not a default, because the whole point of the
  // store is that the second pass over the tab is free.
  const force = b.force === true;

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

      // No maintenance history is not "nothing to do" — the vehicle is still
      // in the parking and still has to go somewhere. Decided in code from its
      // status: there is nothing to analyse, so a model call here would be
      // paying for a lookup table. 3 of the 83 live vehicles are in this state
      // and used to get no ACTION at all.
      if (items.length === 0) {
        const text = formatWorkOrder({
          contractFlag: { level: "unknown", label: "" },
          actions: statusWorkOrder({ etat: String(row.etatVehicule ?? ""), isAvis: row.isAvis }),
          findings: [],
          summary: "",
          insufficientData: true,
        });
        const stored0 = await getAnalysis(imm);
        if (!mayOverwrite(String(row.action ?? ""), stored0?.actionText)) {
          results.push({ imm, outcome: "manual" });
          continue;
        }
        await updateAction(row.rowIndex, text, row.imm);
        await recordActionText(imm, text);
        results.push({ imm, outcome: "written", actions: 1 });
        continue;
      }

      // Both statuses travel with the payload: they decide whether the
      // workshop should be booking anything on this vehicle at all, which
      // outranks whatever the maintenance history says.
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

      // Reuse before spending — but only an analysis that can actually answer
      // THIS question. Two conditions, and both are needed:
      //
      //   the history has not moved   (isStale)
      //   it was produced by a prompt that was asked for actions
      //
      // The second one is not pedantry. ds_analyses is shared with DS History,
      // whose prompt produces findings and a summary and no actions at all,
      // and it also holds analyses written before `actions` existed. Reusing
      // one of those returns a work order of nothing and reports the vehicle
      // as having no work to do — which is what happened on 48083-B-7 and
      // 52722-B-7, both of which have real operations outstanding. An `actions`
      // array that is present but EMPTY is a genuine "nothing to do" and is
      // reused; an absent one means nobody ever asked.
      const stored = await getAnalysis(imm);
      const currentPrompt = promptFingerprint(DS_PARKING_WORKORDER_PROMPT);
      const fresh =
        !force &&
        stored != null &&
        Array.isArray(stored.analysis?.actions) &&
        // Produced by the rules in force TODAY. Without this, a rule change
        // silently applies to nothing: the vehicles' histories have not moved,
        // so every stored answer looks fresh and the whole tab keeps its old
        // work orders.
        stored.promptHash === currentPrompt &&
        !isStale(stored, { entriesCount: input.entries.length, lastEntryDate: input.entries[0]?.date ?? null });

      // Parking's OWN prompt — not DS History's. Same data, same grounding
      // rules, different output: a work order rather than a report.
      const analysis = fresh
        ? stored!.analysis
        : (await runDsAnalysis(input, tier, DS_PARKING_WORKORDER_PROMPT)).analysis;
      const costUsd = fresh ? 0 : undefined;

      // The model's answer, with the status-only work order as a FLOOR: rule
      // A4b makes an empty list impossible in every case but a closed
      // contract, and this is what keeps that true when the model slips or
      // when the grounding guards drop its last action.
      const modelActions = analysis.actions ?? [];
      const text = formatWorkOrder(
        modelActions.length > 0
          ? analysis
          : { ...analysis, actions: statusWorkOrder({ etat: String(row.etatVehicule ?? ""), isAvis: row.isAvis }) }
      );
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
