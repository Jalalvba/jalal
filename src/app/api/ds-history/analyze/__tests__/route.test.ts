import { describe, expect, it, vi, beforeEach } from "vitest";

// Mocked before importing the route (vitest hoists vi.mock above imports).
vi.mock("@/lib/http/rateLimit", () => ({ rateLimitOrNull: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/ai", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai")>("@/lib/ai");
  return { ...actual, callAI: vi.fn() };
});

import { POST } from "@/app/api/ds-history/analyze/route";
import { callAI, AiCallError } from "@/lib/ai";
import { MAX_ENTRIES } from "@/lib/ai/prompts/dsAnalysis";

const mockedCallAI = vi.mocked(callAI);

const COST = {
  model: "gemini-flash-lite-latest",
  pricedAs: "gemini-3-5-flash-lite",
  aliasDrift: false,
  tier: "free" as const,
  inputTokens: 10,
  outputTokens: 5,
  costUsd: 0,
  costMad: 0,
  remainingCreditUsd: 1,
};

const GOOD = {
  contractFlag: { level: "ok", label: "Contrat valide jusqu'au 03/07/2027" },
  findings: [{ level: "warn", title: "Turbo moteur", detail: "3 remplacements le 15/01/2025" }],
  summary: "Récurrence turbo.",
  insufficientData: false,
};

function req(body: unknown) {
  return new Request("http://localhost/api/ds-history/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const BASE = {
  imm: "39357-B-7",
  contractEnd: "2027-07-03T00:00:00.000Z",
  vehicle: { brand: "DACIA" },
  replacements: [],
  entries: [{ date: "2025-01-15T00:00:00.000Z", description: "PB MOTEUR", parts: ["turbo moteur"] }],
};

function resolveWith(obj: unknown) {
  mockedCallAI.mockResolvedValue({ text: JSON.stringify(obj), costInfo: COST });
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/ds-history/analyze — input validation", () => {
  it("rejects a non-JSON body", async () => {
    const r = new Request("http://localhost/x", { method: "POST", body: "not json" });
    const res = await POST(r);
    expect(res.status).toBe(400);
    expect(mockedCallAI).not.toHaveBeenCalled();
  });

  it("requires imm", async () => {
    const res = await POST(req({ ...BASE, imm: "   " }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/imm/);
  });

  it("rejects an empty history rather than asking the model about nothing", async () => {
    const res = await POST(req({ ...BASE, entries: [] }));
    expect(res.status).toBe(400);
    expect(mockedCallAI).not.toHaveBeenCalled();
  });

  it("caps an absurdly large payload", async () => {
    const entries = Array.from({ length: 501 }, () => ({ parts: [] }));
    const res = await POST(req({ ...BASE, entries }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Trop d'interventions/);
  });

  it("tolerates junk inside entries instead of throwing", async () => {
    resolveWith(GOOD);
    const res = await POST(
      req({ ...BASE, entries: [{ date: 12345, km: "abc", description: null, parts: [1, "réel"] }] })
    );
    expect(res.status).toBe(200);
    const prompt = mockedCallAI.mock.calls[0][0].prompt;
    expect(prompt).toContain("réel");
  });
});

describe("POST /api/ds-history/analyze — AI failures", () => {
  it.each([
    ["unconfigured", 500],
    ["rate-limited", 429],
    ["timeout", 504],
    ["upstream", 502],
    ["bad-response", 500],
  ] as const)("maps AiCallError %s to its status with a French message", async (kind, status) => {
    mockedCallAI.mockRejectedValue(new AiCallError(status, kind));
    const res = await POST(req(BASE));
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBeTruthy();
  });

  it("returns 500 for an unexpected non-AiCallError throw", async () => {
    mockedCallAI.mockRejectedValue(new Error("boom"));
    const res = await POST(req(BASE));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/ds-history/analyze — grounding", () => {
  it("returns the analysis and costInfo on success", async () => {
    resolveWith(GOOD);
    const res = await POST(req(BASE));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.analysis.findings).toHaveLength(1);
    expect(body.costInfo.pricedAs).toBe("gemini-3-5-flash-lite");
  });

  it("passes a validate hook that rejects a wrong-shaped response", async () => {
    resolveWith(GOOD);
    await POST(req(BASE));
    const validate = mockedCallAI.mock.calls[0][0].validate!;

    expect(validate(JSON.stringify(GOOD))).toBe(true);
    expect(validate('{"nope":1}')).toBe(false);
    expect(validate("not json at all")).toBe(false);
  });

  it("accepts a fenced ```json response, which models emit often enough to matter", async () => {
    mockedCallAI.mockResolvedValue({
      text: "```json\n" + JSON.stringify(GOOD) + "\n```",
      costInfo: COST,
    });
    const res = await POST(req(BASE));
    expect(res.status).toBe(200);
    expect((await res.json()).analysis.summary).toBe("Récurrence turbo.");
  });

  it("drops a finding citing a date absent from the source data", async () => {
    resolveWith({
      ...GOOD,
      findings: [
        { level: "warn", title: "Turbo moteur", detail: "vu le 15/01/2025" }, // grounded
        { level: "critical", title: "Boîte", detail: "panne le 09/09/2023" }, // invented
      ],
    });
    const res = await POST(req(BASE));
    const body = await res.json();

    expect(body.analysis.findings).toHaveLength(1);
    expect(body.analysis.findings[0].title).toBe("Turbo moteur");
  });

  it("replaces the summary when IT carries an invented date", async () => {
    resolveWith({ ...GOOD, summary: "Dégradation depuis le 01/02/2019." });
    const body = await (await POST(req(BASE))).json();
    expect(body.analysis.summary).toMatch(/dates absentes des données sources/);
  });

  it("reports truncation counts so the UI can surface them", async () => {
    resolveWith(GOOD);
    const entries = Array.from({ length: MAX_ENTRIES + 5 }, () => ({
      date: "2025-01-15T00:00:00.000Z",
      parts: [],
    }));
    const body = await (await POST(req({ ...BASE, entries }))).json();

    expect(body.truncated).toBe(true);
    expect(body.analysedCount).toBe(MAX_ENTRIES);
    expect(body.totalCount).toBe(MAX_ENTRIES + 5);
  });

  it("reports truncated:false for a normal-sized history", async () => {
    resolveWith(GOOD);
    const body = await (await POST(req(BASE))).json();
    expect(body.truncated).toBe(false);
    expect(body.analysedCount).toBe(1);
  });

  it("logs the call under a distinct action so cost is traceable separately", async () => {
    resolveWith(GOOD);
    await POST(req(BASE));
    expect(mockedCallAI.mock.calls[0][0].action).toBe("ds-history-analysis");
  });
});
