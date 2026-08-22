import { describe, expect, it, vi, beforeEach } from "vitest";

// Mocked before importing the route (vitest hoists vi.mock above imports).
vi.mock("@/lib/http/rateLimit", () => ({ rateLimitOrNull: vi.fn().mockResolvedValue(null) }));
// Real Mongo is not reachable from a unit test, and the route AWAITS the
// store — so without this every success-path test hangs to its timeout. That
// is the point of awaiting it: a silent fire-and-forget would have made the
// storage failure invisible here and in production alike.
vi.mock("@/lib/mongo/dsAnalyses", () => ({ saveAnalysis: vi.fn().mockResolvedValue(true) }));
// Neither Mongo nor Sheets is reachable from a unit test; the fallback's own
// behaviour is pinned in src/lib/__tests__/contractEnd.test.ts.
vi.mock("@/lib/vehicle/contractEnd", () => ({
  resolveContractEnd: vi.fn(async (_imm: string, fromClient: string | null) => fromClient),
}));
vi.mock("@/lib/ai", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai")>("@/lib/ai");
  return { ...actual, callAI: vi.fn() };
});

import { POST } from "@/app/api/ds-history/analyze/route";
import { callAI, AiCallError } from "@/lib/ai";
import { saveAnalysis } from "@/lib/mongo/dsAnalyses";
import { MAX_ENTRIES } from "@/lib/ai/prompts/dsAnalysis";

const mockedCallAI = vi.mocked(callAI);
const mockedSave = vi.mocked(saveAnalysis);

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

beforeEach(() => {
  vi.clearAllMocks();
  mockedSave.mockResolvedValue(true);
});

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


describe("POST /api/ds-history/analyze — storage", () => {
  it("stores the analysis so the next reader gets it without paying again", async () => {
    resolveWith(GOOD);
    const res = await POST(req({ ...BASE, quality: "pro" }));
    expect(mockedSave).toHaveBeenCalledTimes(1);
    const saved = mockedSave.mock.calls[0][0];
    expect(saved.imm).toBe("39357-B-7");
    expect(saved.tier).toBe("pro");
    expect(saved.entriesCount).toBe(1);
    // The freshness markers isStale() compares against — without them a stored
    // analysis could never be known to be out of date.
    expect(saved.lastEntryDate).toBe("2025-01-15T00:00:00.000Z");
    expect((await res.json()).stored).toBe(true);
  });

  it("still returns the analysis when storing it fails", async () => {
    // The call is already billed and the answer is already correct. Losing it
    // over a database hiccup would be the worst of both.
    resolveWith(GOOD);
    mockedSave.mockRejectedValue(new Error("mongo down"));
    const res = await POST(req(BASE));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.analysis.summary).toBe("Récurrence turbo.");
    expect(json.stored).toBe(false);
  });

  it("does not store a follow-up answer — it is prose, not an analysis", async () => {
    mockedCallAI.mockResolvedValue({ text: "Réponse.", costInfo: COST });
    await POST(req({ ...BASE, followUp: { question: "pourquoi ?", previousAnalysis: GOOD } }));
    expect(mockedSave).not.toHaveBeenCalled();
  });
});

describe("POST /api/ds-history/analyze — tiers", () => {
  // The paid tier exists because it is measurably more accurate, and it is
  // opt-in because it measurably costs money. Both halves are pinned here: a
  // page that says nothing must never spend, and a client must never be able
  // to name a model of its own.
  it("defaults to the free model when no quality is asked for", async () => {
    resolveWith(GOOD);
    await POST(req(BASE));
    expect(mockedCallAI.mock.calls[0][0].model).toBe("gemini-flash-lite-latest");
    expect(mockedCallAI.mock.calls[0][0].maxTokens).toBe(1_800);
  });

  it('uses the paid model, with its larger cap, for quality: "pro"', async () => {
    resolveWith(GOOD);
    const res = await POST(req({ ...BASE, quality: "pro" }));
    expect(mockedCallAI.mock.calls[0][0].model).toBe("gemini-flash-latest");
    // 1_800 truncated 31 of 101 real pro calls — thinking tokens are billed as
    // output — so the cap moving with the tier is the point, not a detail.
    expect(mockedCallAI.mock.calls[0][0].maxTokens).toBe(5_000);
    expect((await res.json()).tier).toBe("pro");
  });

  it("ignores an unknown quality rather than failing the request", async () => {
    resolveWith(GOOD);
    await POST(req({ ...BASE, quality: "ultra" }));
    expect(mockedCallAI.mock.calls[0][0].model).toBe("gemini-flash-lite-latest");
  });

  it("refuses to let the client name a model directly", async () => {
    resolveWith(GOOD);
    await POST(req({ ...BASE, model: "gemini-3-7-flash", quality: "nope" }));
    expect(mockedCallAI.mock.calls[0][0].model).toBe("gemini-flash-lite-latest");
  });

  it("answers a follow-up with the same tier that produced the analysis", async () => {
    mockedCallAI.mockResolvedValue({ text: "Réponse.", costInfo: COST });
    await POST(req({
      ...BASE,
      quality: "pro",
      followUp: { question: "pourquoi ?", previousAnalysis: GOOD },
    }));
    expect(mockedCallAI.mock.calls[0][0].model).toBe("gemini-flash-latest");
  });
});

describe("POST /api/ds-history/analyze — follow-up mode", () => {
  const PRIOR = {
    contractFlag: { level: "ok", label: "Contrat valide" },
    findings: [{ level: "warn", title: "Turbo moteur", detail: "3 remplacements" }],
    summary: "Récurrence turbo.",
    insufficientData: false,
  };
  const fu = (over: Record<string, unknown> = {}) => ({
    ...BASE,
    followUp: { question: "pourquoi tu n'as pas mentionné l'injection", previousAnalysis: PRIOR, ...over },
  });

  it("answers a challenge with free text, not the analysis JSON shape", async () => {
    mockedCallAI.mockResolvedValue({
      text: "Vous avez raison, je ne l'ai pas relevé : les injecteurs apparaissent 3 fois.",
      costInfo: COST,
    });

    const res = await POST(req(fu()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.answer).toMatch(/Vous avez raison/);
    expect(body.question).toBe("pourquoi tu n'as pas mentionné l'injection");
    expect(body.analysis).toBeUndefined(); // does NOT re-run the analysis
  });

  it("bills follow-ups to their own action so their cost is separable", async () => {
    mockedCallAI.mockResolvedValue({ text: "réponse", costInfo: COST });
    await POST(req(fu()));
    expect(mockedCallAI.mock.calls[0][0].action).toBe("ds-history-followup");
  });

  it("instructs the model to re-examine the data rather than defend itself", async () => {
    mockedCallAI.mockResolvedValue({ text: "réponse", costInfo: COST });
    await POST(req(fu()));
    const sys = mockedCallAI.mock.calls[0][0].systemPrompt!;
    expect(sys).toMatch(/RÉEXAMINE LES DONNÉES/);
    expect(sys).toMatch(/Ne te contente pas de justifier ton analyse précédente/);
  });

  it("carries BOTH the original data and the prior analysis into the prompt", async () => {
    mockedCallAI.mockResolvedValue({ text: "réponse", costInfo: COST });
    await POST(req(fu()));
    const prompt = mockedCallAI.mock.calls[0][0].prompt;
    expect(prompt).toContain("DONNÉES SOURCES");
    expect(prompt).toContain("turbo moteur"); // from the source entries
    expect(prompt).toContain("ANALYSE QUE TU AS PRODUITE");
    expect(prompt).toContain("Récurrence turbo."); // the prior summary
    expect(prompt).toContain("QUESTION DE L'UTILISATEUR");
  });

  it("accepts a follow-up defending a correct original analysis", async () => {
    mockedCallAI.mockResolvedValue({
      text: "L'injection n'apparaît qu'une fois (2025-01-15), ce qui ne constitue pas une récurrence.",
      costInfo: COST,
    });
    const body = await (await POST(req(fu()))).json();
    expect(body.ok).toBe(true);
    expect(body.answer).toMatch(/ne constitue pas une récurrence/);
  });

  it("rejects an empty question without calling the model", async () => {
    const res = await POST(req(fu({ question: "   " })));
    expect(res.status).toBe(400);
    expect(mockedCallAI).not.toHaveBeenCalled();
  });

  it("rejects an over-long question", async () => {
    const res = await POST(req(fu({ question: "x".repeat(501) })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/dépasse/);
  });

  it("rejects a missing or malformed previousAnalysis rather than guessing", async () => {
    for (const bad of [undefined, null, {}, { findings: [] }, "not an object"]) {
      vi.clearAllMocks();
      const res = await POST(req(fu({ previousAnalysis: bad })));
      expect(res.status).toBe(400);
      expect(mockedCallAI).not.toHaveBeenCalled();
    }
  });

  it("still validates the underlying payload — a follow-up needs real entries", async () => {
    const res = await POST(req({ ...fu(), entries: [] }));
    expect(res.status).toBe(400);
  });

  it("flags a date the follow-up invented, rather than serving it silently", async () => {
    // Caught live: the model cited "2025-01-04" for an entry actually dated
    // 2025-02-04 — right part, right km, wrong month. Prose cannot have a bad
    // finding dropped from it, so the reader is told.
    mockedCallAI.mockResolvedValue({
      text: "L'embrayage a été changé le 09/09/2019.",
      costInfo: COST,
    });
    const body = await (await POST(req(fu()))).json();

    expect(body.ok).toBe(true);
    expect(body.ungroundedDates).toEqual(["09/09/2019"]);
    expect(body.answer).toMatch(/Vérification automatique/);
    expect(body.answer).toMatch(/09\/09\/2019/);
  });

  it("leaves a correctly-grounded answer untouched", async () => {
    mockedCallAI.mockResolvedValue({
      text: "Le turbo a été remplacé le 15/01/2025.",
      costInfo: COST,
    });
    const body = await (await POST(req(fu()))).json();

    expect(body.ungroundedDates).toEqual([]);
    expect(body.answer).not.toMatch(/Vérification automatique/);
  });

  it("tells the model to verify before conceding", async () => {
    mockedCallAI.mockResolvedValue({ text: "réponse", costInfo: COST });
    await POST(req(fu()));
    const sys = mockedCallAI.mock.calls[0][0].systemPrompt!;
    expect(sys).toMatch(/VÉRIFIE D'ABORD, CONCÈDE ENSUITE/);
    expect(sys).toMatch(/Ne commence JAMAIS par « Vous avez raison »/);
  });

  it("maps AI failures the same way the analysis path does", async () => {
    mockedCallAI.mockRejectedValue(new AiCallError(504, "timeout"));
    const res = await POST(req(fu()));
    expect(res.status).toBe(504);
    expect((await res.json()).ok).toBe(false);
  });
});
