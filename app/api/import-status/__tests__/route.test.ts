import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/rateLimit", () => ({
  rateLimitOrNull: vi.fn().mockResolvedValue(null),
}));

import { rateLimitOrNull } from "@/lib/rateLimit";
import { GET } from "@/app/api/import-status/route";

const mockedRateLimit = vi.mocked(rateLimitOrNull);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function req(runId?: string): Request {
  const url = runId
    ? `http://localhost/api/import-status?run_id=${encodeURIComponent(runId)}`
    : "http://localhost/api/import-status";
  return new Request(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedRateLimit.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/import-status", () => {
  it("returns 400 when run_id is missing", async () => {
    const res = await GET(req());
    expect(res.status).toBe(400);
  });

  it("returns 400 when run_id is present but blank", async () => {
    const res = await GET(req("   "));
    expect(res.status).toBe(400);
  });

  it("returns a normalized run on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          pipeline: "cp",
          started_at: "2026-08-06 09:00:00.000000+00:00",
          finished_at: "2026-08-06 09:01:00.000000+00:00",
          status: "success",
          steps: [{ step: "upload", status: "success", detail: "", timestamp: "2026-08-06 09:00:45.000000+00:00" }],
        })
      )
    );

    const res = await GET(req("run-cp"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.run.run_id).toBe("run-cp");
    expect(body.run.pipeline).toBe("cp");
    expect(body.run.steps).toHaveLength(1);
  });

  // Regression guard for the bug 9fe833d fixed in /api/trigger-import but
  // never applied here: the run status was validated against the *step*
  // status set, so both real skip outcomes silently became "failed". These
  // are the exact status strings ~/import's run.py emits.
  it.each([
    ["skipped_absent"],
    ["skipped_unchanged"],
    ["success"],
    ["failed"],
    ["running"],
  ])("passes a real run status through unchanged: %s", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ pipeline: "parc", started_at: null, finished_at: null, status, steps: [] })
      )
    );

    const res = await GET(req(`run-${status}`));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run.status).toBe(status);
  });

  it("coerces an unrecognized run status to failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        // A bare "skipped" is never a real run status (see lib/types.ts's
        // ImportPipelineRunStatus) — treated as unrecognized, not as a skip.
        jsonResponse({ pipeline: "ds", started_at: null, finished_at: null, status: "skipped", steps: [] })
      )
    );

    const res = await GET(req("run-bogus"));

    expect(res.status).toBe(200);
    expect((await res.json()).run.status).toBe("failed");
  });

  it("forwards a 404 from the backend as 404, not a generic 502", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not found", { status: 404 })));

    const res = await GET(req("unknown-run"));

    expect(res.status).toBe(404);
  });

  it("returns 502 on a network error reaching the backend", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")));

    const res = await GET(req("run-x"));

    expect(res.status).toBe(502);
  });

  it("returns the rate limiter's response directly when over budget", async () => {
    mockedRateLimit.mockResolvedValue(new Response(JSON.stringify({ ok: false }), { status: 429 }) as never);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(req("run-x"));

    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
