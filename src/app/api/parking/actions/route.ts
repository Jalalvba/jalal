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
import { canonicalizeSuppliers, computeContractStatus } from "@/lib/ai/prompts/dsAnalysis";
import { runDsAnalysis, resolveTier } from "@/lib/ai/dsAnalysis/run";
import { resolveCpStatus } from "@/lib/vehicle/contractEnd";
import { DS_PARKING_WORKORDER_PROMPT } from "@/lib/ai/dsAnalysis/prompt-parking";
import { getAnalysis, recordActionText, saveAnalysis } from "@/lib/mongo/dsAnalyses";
import { isStale, promptFingerprint } from "@/lib/ai/dsAnalysis/stored";
import {
  fixedRoutingActions,
  fixedRoutingZone,
  formatWorkOrder,
  mayOverwrite,
  parseDestinationZone,
  statusWorkOrder,
  withDestination,
  zonePreconditionFailure,
  type ZoneVehicle,
} from "@/lib/ai/dsAnalysis/workOrder";
import { isValidZone } from "@/lib/ai/dsAnalysis/prompt-parking";
import { getParkingRows, updateAction, updateZoning } from "@/lib/sheets/googleSheetsParking";
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

/** What happened to the ZONING cell, reported separately from the ACTION one. */
type ZoneOutcome =
  | "written"          // a valid zone reached the cell
  | "invalid"          // the model named something that is not a real zone
  | "rejected"         // a real zone, but this vehicle's data does not permit it
  | "skipped-no-data"  // insufficientData — no basis to place the vehicle
  | "failed";          // the write itself threw

type Result = {
  imm: string;
  outcome: Outcome;
  actions?: number;
  error?: string;
  costUsd?: number;
  /** Absent when the ACTION path never got far enough to attempt a zone. */
  zone?: { outcome: ZoneOutcome; value?: string; error?: string; reason?: string };
};

/**
 * Places the model's chosen destination in the ZONING cell.
 *
 * THE EXACT-MATCH CHECK BELOW IS THE ONLY REAL ENFORCEMENT THERE IS. The sheet's
 * ZONING column carries a strict:true ONE_OF_LIST validation rule, and it is
 * tempting to treat this check as a redundant second guard in front of it. It is
 * not. Verified against the live sheet on 2026-08-29: the Sheets API does NOT
 * apply data validation to API writes — writing "DEPOT-ATV" (valid),
 * "visite technique" (valid) and a deliberately out-of-list value all three
 * succeeded and were stored. strict:true constrains the Sheets UI, not us.
 *
 * So a near-miss string — a translated zone, a lowercased one, a hallucinated
 * one — would be written and stored silently, leaving a cell that no dropdown
 * offers and that every consumer of this column then has to cope with. Do not
 * remove or weaken this check on the belief that the spreadsheet is catching it.
 *
 * On a mismatch the previous value is left ALONE and the miss is reported, so
 * the operator learns the AI's answer could not be placed instead of quietly
 * seeing a stale zone.
 */
async function applyZone(
  row: { rowIndex: number; imm: string },
  analysis: { actions?: string[]; insufficientData?: boolean },
  vehicle: ZoneVehicle,
  /**
   * The zone to write, when the caller already knows it. The fixed-routing path
   * passes it because its ACTION line no longer necessarily names its zone —
   * « Envoyer vers HAMID CLIM » parses back to "HAMID CLIM", which is not a
   * valid zone. Model answers still go through the parse below.
   */
  explicitZone?: string | null
): Promise<Result["zone"]> {
  // Rule A0.5 has no basis to fire when the data could not support a
  // conclusion, and a wrongly-placed vehicle is a physical move someone has to
  // undo. ACTION is still written (the car is in the parking and needs
  // instructions either way) — only the zone is left for a human.
  if (analysis.insufficientData === true) return { outcome: "skipped-no-data" };

  // Judged on what the MODEL said, not on what reached ACTION. withDestination()
  // substitutes statusWorkOrder()'s zone when the model's line is unusable, so
  // actionsWritten always ends on a valid zone — reading it here would report
  // every vehicle as fine and never surface a bad answer. ACTION keeps that
  // fallback (the controller must always have a destination); ZONING does not
  // inherit it, because a zone nobody chose is worse than an empty cell a human
  // will fill.
  const candidate = explicitZone ?? parseDestinationZone(analysis.actions ?? []);
  if (!candidate || !isValidZone(candidate)) {
    return { outcome: "invalid", value: candidate ?? undefined };
  }

  // Second guard: the string is a real zone, but is it one THIS vehicle may
  // receive? Refuses rather than substituting — the same choice ungroundedDates()
  // and ungroundedSuppliers() make when they drop an unsupported finding instead
  // of rewriting it. Falling through to statusWorkOrder()'s zone would put a
  // plausible-looking value in the cell that nothing actually reasoned about,
  // which is the very failure this guard exists to stop.
  const reason = zonePreconditionFailure(candidate.trim(), vehicle);
  if (reason) return { outcome: "rejected", value: candidate.trim(), reason };

  try {
    // verifyRowIdentity() inside updateZoning re-reads the row's IMM cell and
    // refuses on a mismatch (AGENTS.md rule 3) — same guard as updateAction.
    await updateZoning(row.rowIndex, candidate.trim(), row.imm);
    return { outcome: "written", value: candidate.trim() };
  } catch (e) {
    return { outcome: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}

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

  // FRESH, not cached: the overwrite rule compares the cell's current text
  // against what this app last wrote, so a row read from a 60s-old cache can
  // make it mistake its own write for a human's and refuse to touch the cell.
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
        if (!mayOverwrite(String(row.action ?? ""), stored0?.actionText, text)) {
          results.push({ imm, outcome: "manual" });
          continue;
        }
        await updateAction(row.rowIndex, text, row.imm);
        // The document has to exist BEFORE recordActionText, which updates and
        // does not upsert: without this the plate has no stored analysis (no
        // model ran), nothing is recorded, and the NEXT run reads this app's
        // own text as a human's and reports "manual". Seen on 79878-B-7 and
        // 72351-T-1 within minutes of writing them.
        await saveAnalysis({
          imm,
          analysis: {
            contractFlag: { level: "unknown", label: "" },
            actions: statusWorkOrder({ etat: String(row.etatVehicule ?? ""), isAvis: row.isAvis }),
            findings: [],
            summary: "Aucune intervention DS enregistrée pour ce véhicule.",
            insufficientData: true,
          },
          tier,
          model: "aucun (déduit du statut)",
          costUsd: 0,
          entriesCount: 0,
          lastEntryDate: null,
          routing: {
            zoning: String(row.zoning ?? "").trim() || undefined,
            etat: String(row.etatVehicule ?? "").trim() || undefined,
          },
          // Not a prompt: this answer comes from the status rules in code.
          // Never matches a prompt fingerprint, so it is always recomputed —
          // which costs nothing, since no model is involved.
          promptHash: "status-only",
        });
        await recordActionText(imm, text);
        // insufficientData is true on this path by construction, so applyZone
        // reports "skipped-no-data" and writes nothing — the vehicle still gets
        // its ACTION, and a human sets the zone.
        const zone0 = await applyZone(row, { insufficientData: true }, {
          etat: String(row.etatVehicule ?? ""),
          isAvis: row.isAvis === true,
          zoning: String(row.zoning ?? "").trim(),
        });
        results.push({ imm, outcome: "written", actions: 1, zone: zone0 });
        continue;
      }

      // Both statuses travel with the payload: they decide whether the
      // workshop should be booking anything on this vehicle at all, which
      // outranks whatever the maintenance history says.
      // One lookup, reused by the payload AND by the zone preconditions below
      // (criterion A0.5.1 reads the contract status). A second call would be a
      // second chance to disagree with itself.
      const cpStatus = (await resolveCpStatus(imm)) ?? undefined;

      const raw = buildDsAnalysisPayload({
        imm,
        items,
        vehicle: {
          state: String(row.etatVehicule ?? "").trim() || undefined,
          cpStatus,
          // Resolved on the row itself (parc tab: Client, else Société), so
          // the model is told who owns the vehicle rather than being left to
          // guess from a company name.
          owner: String(row.client ?? "").trim() || undefined,
          isAvis: row.isAvis === true,
          zoning: String(row.zoning ?? "").trim() || undefined,
          bdd: String(row.bdd ?? "").trim() || undefined,
          prestataire: String(row.prestataire ?? "").trim() || undefined,
        },
        // The tab's own KM column, when an operator filled it in. Takes
        // priority over the DS-derived odometer in every interval and
        // belt/pump check — see resolveVehicleKm() in
        // lib/ai/prompts/maintenanceIntervals.ts, which is where that
        // precedence is decided, not here.
        manualKm: row.manualKm,
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
      // The facts every zone decision is made from — built once and shared by
      // the A0.0 short-circuit below, withDestination() (ACTION) and applyZone()
      // (ZONING), so all three judge the same destination against the same data.
      const vehicle: ZoneVehicle = {
        etat: String(row.etatVehicule ?? ""),
        isAvis: row.isAvis === true,
        cpStatus,
        zoning: String(row.zoning ?? "").trim(),
        prestataire: String(row.prestataire ?? "").trim(),
      };

      // A0.0, decided here rather than asked of the model — see
      // fixedRoutingActions()'s header for the measurements that moved it into
      // code. A zone already in the cell means a human or an earlier process
      // decided, so there is nothing to analyse and no model call to pay for.
      const fixedActions = fixedRoutingActions(vehicle);

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
        !isStale(stored, {
          entriesCount: input.entries.length,
          lastEntryDate: input.entries[0]?.date ?? null,
          // A corrected odometer changes every verdict without touching the
          // history, so it has to participate in the reuse decision.
          manualKm: input.manualKm,
          // And so do the routing facts: A0.0 fires off ZONING, which applyZone()
          // below WRITES from this very answer. Without this the first run's full
          // work order is pinned forever and A0.0 never gets a second chance.
          routing: {
            zoning: input.vehicle.zoning,
            etat: input.vehicle.state,
            cpStatus: input.vehicle.cpStatus,
          },
        });

      // Parking's OWN prompt — not DS History's. Same data, same grounding
      // rules, different output: a work order rather than a report.
      const analysis = fixedActions
        ? {
            contractFlag: computeContractStatus(input.contractEnd),
            actions: fixedActions,
            // Empty by construction: there is nothing to report about a vehicle
            // whose destination was already decided elsewhere.
            findings: [],
            summary: `Zone déjà déterminée : ${vehicle.zoning}.`,
            insufficientData: false,
          }
        : fresh
          ? stored!.analysis
          : (await runDsAnalysis(input, tier, DS_PARKING_WORKORDER_PROMPT)).analysis;
      const costUsd = fresh || fixedActions ? 0 : undefined;

      // runDsAnalysis() stores its own answer; this path never called it, so it
      // stores its own. promptHash is a sentinel rather than a fingerprint: no
      // prompt produced this, and "never matches, always recomputed" is right
      // when recomputing is free — the same choice the status-only path makes.
      if (fixedActions) {
        await saveAnalysis({
          imm,
          analysis,
          tier,
          model: "aucun (routage fixe A0.0)",
          costUsd: 0,
          entriesCount: input.entries.length,
          lastEntryDate: input.entries[0]?.date ?? null,
          manualKm: input.manualKm,
          routing: { zoning: vehicle.zoning, etat: vehicle.etat, cpStatus: vehicle.cpStatus },
          promptHash: "fixed-routing",
        });
      }

      // The model's answer, with the status-only work order as a FLOOR: rule
      // A4b makes an empty list impossible in every case but a closed
      // contract, and this is what keeps that true when the model slips or
      // when the grounding guards drop its last action.
      // The destination is guaranteed in code, not merely requested: it is the
      // line the controller cannot work without, and withDestination() also
      // normalises whatever wording a reused answer carries.
      // The facts every zone precondition is decided from — built once and
      // passed to both withDestination() (ACTION) and applyZone() (ZONING), so
      // the two columns judge the same destination against the same data.
      // withDestination() now KEEPS the model's own A0.5 choice and only falls
      // back to statusWorkOrder() when it produced no destination at all. The
      // resulting list is what both the ACTION cell and the zone parse read, so
      // the two can never describe different destinations.
      // withDestination() exists to guarantee a destination on a MODEL answer and
      // to normalise its wording. The fixed-routing line is already exact and
      // already single, and putting it through the parse would only give the
      // provider-name form a chance to be rewritten — so it is passed straight
      // through.
      const finalActions = fixedActions ?? withDestination(analysis.actions ?? [], vehicle);
      const text = formatWorkOrder({ ...analysis, actions: finalActions });
      if (!text) {
        results.push({ imm, outcome: "no-action" });
        continue;
      }

      if (!mayOverwrite(String(row.action ?? ""), stored?.actionText, text)) {
        results.push({ imm, outcome: "manual" });
        continue;
      }

      // updateAction() re-reads the row's IMM cell and refuses on a mismatch
      // (verifyRowIdentity, AGENTS.md rule 3) — the same guard a manual edit
      // goes through, which matters more here because nobody is watching each
      // individual write.
      await updateAction(row.rowIndex, text, row.imm);
      await recordActionText(imm, text);

      // AFTER the ACTION write, deliberately: the work order is the thing the
      // controller cannot do without, so a zone failure must never cost him the
      // instructions. Reported as its own outcome rather than folded into the
      // ACTION one, because "work order written, zone rejected" is a real and
      // actionable state.
      const zone = await applyZone(row, analysis, vehicle, fixedRoutingZone(vehicle));
      if (zone?.outcome === "invalid") {
        log("warn", "parking-actions", "Model named a zone that is not in the dropdown", {
          imm,
          candidate: zone.value ?? "(none)",
        });
      }
      if (zone?.outcome === "rejected") {
        // Logged at warn, not swallowed: a rejection means the model applied a
        // criterion whose precondition this vehicle does not meet, and the
        // operator needs to place it by hand.
        log("warn", "parking-actions", "Zone rejected — precondition not met for this vehicle", {
          imm,
          candidate: zone.value ?? "(none)",
          reason: zone.reason ?? "",
          etat: String(row.etatVehicule ?? ""),
          isAvis: row.isAvis === true,
          cpStatus: cpStatus ?? "",
        });
      }

      results.push({
        imm,
        outcome: fresh ? "reused" : "written",
        actions: analysis.actions?.length ?? 0,
        costUsd,
        zone,
      });
    } catch (e) {
      const msg = e instanceof AiCallError ? e.kind : e instanceof Error ? e.message : String(e);
      log("warn", "parking-actions", "Plate failed", { imm, ...serializeError(e) });
      results.push({ imm, outcome: "failed", error: msg });
    }
  }

  return NextResponse.json({ ok: true, results });
}