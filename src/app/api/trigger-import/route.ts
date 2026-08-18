// app/api/trigger-import/route.ts
export const runtime = "nodejs";
export const maxDuration = 180;

import { NextResponse } from "next/server";
import { rateLimitOrNull } from "@/lib/http/rateLimit";
import { toErrorResponse } from "@/lib/http/apiError";
import { invalidateIMMListCache } from "@/lib/sheets/googleSheetsParking";
import { invalidateVehicleSuggestionListCache } from "@/lib/mongo/vehicleSuggestions";
import type {
  ImportPipelineResult,
  ImportPipelineStep,
  TriggerImportResponse,
} from "@/types";

// Separate Vercel project (~/import), not part of this repo. GET /api
// blocks synchronously until all four pipelines (ds/cp/parc/bc) finish —
// confirmed live to typically take 60-90s against real Drive/Mongo Atlas
// traffic, which is why that project's own vercel.json sets its function's
// maxDuration to 180 for headroom; this route mirrors that (above) plus
// margin for the /api/status follow-up calls made below.
const IMPORT_API_BASE = "https://import-red.vercel.app";

type RawTriggerResult = {
  label: string;
  filename: string;
  // Confirmed against ~/import/run.py's run_all() directly — never a bare
  // "skipped", see lib/types.ts's ImportPipelineRunStatus comment.
  status: "success" | "failed" | "skipped_absent" | "skipped_unchanged";
  run_id: string;
  steps: string[]; // "step:status" — no timestamp/detail, see lib/types.ts's comment
};

type RawTriggerBody = {
  success?: boolean;
  results?: RawTriggerResult[];
  error?: string;
};

type RawStep = { step?: string; status?: string; detail?: string; timestamp?: string };

type RawStatusDoc = {
  pipeline?: string;
  started_at?: string;
  finished_at?: string | null;
  status?: string;
  steps?: RawStep[];
};

// Backend serializes datetimes via Python's `json.dumps(..., default=str)`,
// i.e. str(datetime) — "2026-08-03 20:14:23.680208+00:00" (space-separated,
// microsecond precision). Not guaranteed parseable by every JS Date
// implementation as-is, so normalize to a real ISO 8601 string here rather
// than pushing that parsing risk to the browser.
function normalizeTimestamp(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?([+-]\d{2}:\d{2}|Z)?$/);
  if (!m) return null;
  const [, date, time, frac, offset] = m;
  const millis = frac ? "." + frac.slice(1, 4).padEnd(3, "0") : "";
  return `${date}T${time}${millis}${offset ?? "Z"}`;
}

const KNOWN_STEP_STATUSES = new Set(["started", "success", "failed", "skipped"]);

function normalizeStep(raw: RawStep): ImportPipelineStep {
  const status = KNOWN_STEP_STATUSES.has(raw.status ?? "") ? (raw.status as ImportPipelineStep["status"]) : "failed";
  return {
    step: raw.step ?? "unknown",
    status,
    detail: raw.detail ?? "",
    timestamp: normalizeTimestamp(raw.timestamp),
  };
}

// Fallback used only if the /api/status follow-up call for a given run_id
// itself fails — reconstructs what little the trigger response gives us
// ("step:status" strings, no detail/timestamp) so the pipeline still shows
// up in the terminal replay instead of silently vanishing.
function stepsFromCompactSummary(compact: string[]): ImportPipelineStep[] {
  return compact.map((entry) => {
    const [step, status] = entry.split(":");
    return {
      step: step || "unknown",
      status: KNOWN_STEP_STATUSES.has(status) ? (status as ImportPipelineStep["status"]) : "failed",
      detail: "",
      timestamp: null,
    };
  });
}

export async function POST(req: Request) {
  // Each trigger is a real, expensive (~60-90s) Drive+Mongo run — this
  // guards against double-submits / accidental repeat clicks, not against
  // legitimate reuse (a manual admin action from one confirm dialog).
  const limited = await rateLimitOrNull(req, "trigger-import", 3, 15 * 60_000);
  if (limited) return limited;

  const token = process.env.IMPORT_PIPELINE_TOKEN;
  if (!token) {
    return NextResponse.json<TriggerImportResponse>(
      { ok: false, error: "IMPORT_PIPELINE_TOKEN is not configured on this deployment." },
      { status: 500 }
    );
  }

  try {
    let triggerRes: Response;
    try {
      // Accepted tradeoff (M7 in the audit this responds to), not an
      // oversight: the token travels as a query param, which lands in
      // ~/import's own access logs. A header would avoid that, but ~/import's
      // api/index.py reads the token via `query.get("token")` only — there is
      // no header-auth path on the receiving side (confirmed by reading that
      // project's source directly, not assumed). Fixing this properly means
      // coordinated changes across two separate Vercel projects/deployments
      // (this repo's caller AND ~/import's handler, redeployed together) —
      // out of scope for a one-sided change here, and per this repo's own
      // AGENTS.md, ~/import is a separate repo this session doesn't touch
      // without being explicitly asked to. If ~/import ever gains header
      // support, switch this to an Authorization header at the same time.
      triggerRes = await fetch(`${IMPORT_API_BASE}/api?token=${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
    } catch (e) {
      console.error("trigger-import: network error calling import pipeline", e);
      return NextResponse.json<TriggerImportResponse>(
        { ok: false, error: "Could not reach the import pipeline service (network error)." },
        { status: 502 }
      );
    }

    let body: RawTriggerBody | null = null;
    try {
      body = (await triggerRes.json()) as RawTriggerBody;
    } catch {
      // e.g. a platform-level timeout/504 with a non-JSON body
    }

    if (triggerRes.status === 401) {
      return NextResponse.json<TriggerImportResponse>(
        {
          ok: false,
          error:
            "Import pipeline rejected the trigger token (401) — check that IMPORT_PIPELINE_TOKEN matches ~/import's PIPELINE_TRIGGER_SECRET.",
        },
        { status: 502 }
      );
    }

    if (!body || !Array.isArray(body.results)) {
      return NextResponse.json<TriggerImportResponse>(
        {
          ok: false,
          error: body?.error
            ? `Import pipeline error: ${body.error}`
            : `Import pipeline returned an unexpected response (HTTP ${triggerRes.status}).`,
        },
        { status: 502 }
      );
    }

    // Trigger response's own steps are compact "step:status" strings only
    // (see run.py's run_all()) — fetch each run's full status document now
    // that every pipeline has already finished, to get real timestamps and
    // detail text for the terminal replay.
    const results: ImportPipelineResult[] = await Promise.all(
      body.results.map(async (r): Promise<ImportPipelineResult> => {
        try {
          const statusRes = await fetch(
            `${IMPORT_API_BASE}/api/status?run_id=${encodeURIComponent(r.run_id)}`,
            { cache: "no-store" }
          );
          if (!statusRes.ok) {
            throw new Error(
              `status endpoint returned HTTP ${statusRes.status} — likely not deployed on the backend yet`
            );
          }
          const doc = (await statusRes.json()) as RawStatusDoc;
          return {
            label: r.label,
            filename: r.filename,
            pipeline: doc.pipeline ?? r.label,
            run_id: r.run_id,
            status: r.status,
            started_at: normalizeTimestamp(doc.started_at),
            finished_at: normalizeTimestamp(doc.finished_at),
            steps: Array.isArray(doc.steps) ? doc.steps.map(normalizeStep) : stepsFromCompactSummary(r.steps),
          };
        } catch (e) {
          const message = e instanceof Error ? e.message : "unknown error";
          console.error(`trigger-import: could not fetch step detail for run_id ${r.run_id}`, e);
          return {
            label: r.label,
            filename: r.filename,
            pipeline: r.label,
            run_id: r.run_id,
            status: r.status,
            started_at: null,
            finished_at: null,
            steps: stepsFromCompactSummary(r.steps),
            stepDetailWarning: `Full step detail unavailable (${message}) — showing compact summary only, no real timestamps.`,
          };
        }
      })
    );

    // getIMMList()'s cache (lib/googleSheetsParking.ts) is a week-long TTL —
    // refresh it immediately on a real parc change instead of waiting that
    // out. Only "success" counts: "skipped_unchanged"/"skipped_absent" mean
    // parc's data didn't actually change, and "failed" means it may not be
    // trustworthy yet either.
    if (results.some((r) => r.pipeline === "parc" && r.status === "success")) {
      invalidateIMMListCache();
    }

    // The combined parc+cp suggestion list (lib/vehicleSuggestions.ts) draws
    // from both collections, so either one changing real data invalidates it.
    if (results.some((r) => (r.pipeline === "parc" || r.pipeline === "cp") && r.status === "success")) {
      invalidateVehicleSuggestionListCache();
    }

    return NextResponse.json<TriggerImportResponse>({
      ok: true,
      success: body.success ?? !results.some((r) => r.status === "failed"),
      results,
    });
  } catch (e) {
    return toErrorResponse(e, "Failed to run fleet data import");
  }
}
