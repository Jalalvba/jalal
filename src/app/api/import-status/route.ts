// app/api/import-status/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { rateLimitOrNull } from "@/lib/http/rateLimit";
import { toErrorResponse } from "@/lib/http/apiError";
import type {
  ImportPipelineResult,
  ImportPipelineRunStatus,
  ImportStatusResponse,
} from "@/types";

// Read-only lookup of a past run's full step history — for re-viewing a
// prior run's detail, not for polling during a trigger (the trigger route
// already backfills full step detail once it resolves). No token needed:
// ~/import's api/status.py is itself unauthenticated (run_id is an
// unguessable UUID4, see that file's own comment), so this route just
// forwards the query param through.
const IMPORT_API_BASE = "https://import-red.vercel.app";

type RawStep = { step?: string; status?: string; detail?: string; timestamp?: string };
type RawStatusDoc = {
  pipeline?: string;
  started_at?: string;
  finished_at?: string | null;
  status?: string;
  steps?: RawStep[];
  error?: string;
};

const KNOWN_STEP_STATUSES = new Set(["started", "success", "failed", "skipped"]);

// Deliberately NOT the same set as KNOWN_STEP_STATUSES above: a pipeline
// *run*'s status has its own vocabulary (lib/types.ts's
// ImportPipelineRunStatus), and the two are not interchangeable. Validating a
// run status against the step set is exactly the bug 9fe833d fixed in
// app/api/trigger-import/route.ts — since neither "skipped_absent" nor
// "skipped_unchanged" is a step status, both silently coerced to "failed",
// reporting a legitimately skipped run as a failed one. The fix was never
// applied here at the time; this is it.
const KNOWN_RUN_STATUSES = new Set<string>([
  "success",
  "failed",
  "skipped_absent",
  "skipped_unchanged",
  // Only /api/status can report this — a run still in progress when polled
  // (PipelineLogger.status starts "running" until finish() is called). The
  // trigger route never returns it.
  "running",
]);

function normalizeRunStatus(raw: unknown): ImportPipelineRunStatus {
  return typeof raw === "string" && KNOWN_RUN_STATUSES.has(raw)
    ? (raw as ImportPipelineRunStatus)
    : "failed";
}

function normalizeTimestamp(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?([+-]\d{2}:\d{2}|Z)?$/);
  if (!m) return null;
  const [, date, time, frac, offset] = m;
  const millis = frac ? "." + frac.slice(1, 4).padEnd(3, "0") : "";
  return `${date}T${time}${millis}${offset ?? "Z"}`;
}

export async function GET(req: Request) {
  const limited = await rateLimitOrNull(req, "import-status", 30, 60_000);
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const runId = searchParams.get("run_id")?.trim();
  if (!runId) {
    return NextResponse.json<ImportStatusResponse>(
      { ok: false, error: "Missing required query param: run_id" },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(`${IMPORT_API_BASE}/api/status?run_id=${encodeURIComponent(runId)}`, {
      cache: "no-store",
    });

    let doc: RawStatusDoc | null = null;
    try {
      doc = (await res.json()) as RawStatusDoc;
    } catch {
      // fall through to the !res.ok branch below
    }

    if (!res.ok || !doc) {
      return NextResponse.json<ImportStatusResponse>(
        { ok: false, error: doc?.error ?? `Import pipeline status lookup failed (HTTP ${res.status}).` },
        { status: res.status === 404 ? 404 : 502 }
      );
    }

    const run: ImportPipelineResult = {
      label: doc.pipeline ?? runId,
      filename: "",
      pipeline: doc.pipeline ?? "",
      run_id: runId,
      status: normalizeRunStatus(doc.status),
      started_at: normalizeTimestamp(doc.started_at),
      finished_at: normalizeTimestamp(doc.finished_at),
      steps: Array.isArray(doc.steps)
        ? doc.steps.map((s) => ({
            step: s.step ?? "unknown",
            status: (KNOWN_STEP_STATUSES.has(s.status ?? "") ? s.status : "failed") as ImportPipelineResult["steps"][number]["status"],
            detail: s.detail ?? "",
            timestamp: normalizeTimestamp(s.timestamp),
          }))
        : [],
    };

    return NextResponse.json<ImportStatusResponse>({ ok: true, run });
  } catch (e) {
    return toErrorResponse(e, "Could not reach the import pipeline status service", 502);
  }
}
