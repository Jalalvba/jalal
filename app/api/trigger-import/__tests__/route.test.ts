import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/rateLimit", () => ({
  rateLimitOrNull: vi.fn().mockResolvedValue(null),
}));

import { rateLimitOrNull } from "@/lib/rateLimit";
import { POST } from "@/app/api/trigger-import/route";

const mockedRateLimit = vi.mocked(rateLimitOrNull);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function req(): Request {
  return new Request("http://localhost/api/trigger-import", { method: "POST" });
}

const ORIGINAL_TOKEN = process.env.IMPORT_PIPELINE_TOKEN;

beforeEach(() => {
  vi.clearAllMocks();
  mockedRateLimit.mockResolvedValue(null);
  process.env.IMPORT_PIPELINE_TOKEN = "test-token";
});

afterEach(() => {
  process.env.IMPORT_PIPELINE_TOKEN = ORIGINAL_TOKEN;
  vi.unstubAllGlobals();
});

describe("POST /api/trigger-import", () => {
  it("returns 500 and never calls fetch when IMPORT_PIPELINE_TOKEN is unset", async () => {
    delete process.env.IMPORT_PIPELINE_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(req());

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/IMPORT_PIPELINE_TOKEN/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the rate limiter's response directly, without ever calling fetch", async () => {
    const limited = new Response(JSON.stringify({ ok: false, error: "Trop de requêtes." }), { status: 429 });
    mockedRateLimit.mockResolvedValue(limited as never);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(req());

    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 when the trigger call itself throws (network error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")));

    const res = await POST(req());

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/[Cc]ould not reach/);
  });

  it("returns 502 with a token-mismatch hint on a 401 from the trigger endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "unauthorized" }, 401)));

    const res = await POST(req());

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/PIPELINE_TRIGGER_SECRET/);
  });

  it("returns 502 when the trigger response has no 'results' array", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ success: true })));

    const res = await POST(req());

    expect(res.status).toBe(502);
  });

  it("passes through successfully, backfilling step detail from each run's status lookup", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/api?token=")) {
        return jsonResponse({
          success: true,
          results: [{ label: "DS", filename: "ds.xlsx", status: "success", run_id: "run-ds", steps: ["download:success"] }],
        });
      }
      if (url.includes("run_id=run-ds")) {
        return jsonResponse({
          pipeline: "ds",
          started_at: "2026-08-06 09:00:00.000000+00:00",
          finished_at: "2026-08-06 09:01:30.000000+00:00",
          status: "success",
          steps: [{ step: "download", status: "success", detail: "12 rows", timestamp: "2026-08-06 09:00:30.000000+00:00" }],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(req());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.success).toBe(true);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].pipeline).toBe("ds");
    expect(body.results[0].steps[0]).toEqual({
      step: "download",
      status: "success",
      detail: "12 rows",
      timestamp: "2026-08-06T09:00:30.000+00:00",
    });
    expect(body.results[0].stepDetailWarning).toBeUndefined();
  });

  it("degrades gracefully to the compact step summary when a run's status lookup fails, with a visible warning", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/api?token=")) {
        return jsonResponse({
          success: false,
          results: [{ label: "BC", filename: "bc.xlsx", status: "failed", run_id: "run-bc", steps: ["parse:failed"] }],
        });
      }
      if (url.includes("run_id=run-bc")) {
        return new Response("not found", { status: 404 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(req());

    expect(res.status).toBe(200);
    const body = await res.json();
    const run = body.results[0];
    expect(run.stepDetailWarning).toBeTruthy();
    expect(run.steps).toEqual([{ step: "parse", status: "failed", detail: "", timestamp: null }]);
  });
});
