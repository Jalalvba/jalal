import { describe, expect, it } from "vitest";
import {
  computeContractStatus,
  isDsAnalysisShape,
  ungroundedDates,
  buildDsAnalysisPrompt,
  MAX_ENTRIES,
  type DsAnalysis,
  type DsAnalysisInput,
} from "@/lib/ai/prompts/dsAnalysis";

const NOW = new Date("2026-08-20T12:00:00.000Z");

function analysis(over: Partial<DsAnalysis> = {}): DsAnalysis {
  return {
    contractFlag: { level: "ok", label: "Contrat valide" },
    findings: [{ level: "warn", title: "Turbo moteur", detail: "3 remplacements" }],
    summary: "Véhicule globalement sain.",
    insufficientData: false,
    ...over,
  };
}

function input(over: Partial<DsAnalysisInput> = {}): DsAnalysisInput {
  return {
    imm: "39357-B-7",
    contractEnd: "2027-07-03T00:00:00.000Z",
    vehicle: { brand: "DACIA", model: "Dokker Van" },
    replacements: [],
    entries: [{ date: "2025-01-15T00:00:00.000Z", parts: ["turbo moteur"] }],
    ...over,
  };
}

describe("computeContractStatus — computed in code, never asked of the model", () => {
  it("flags a contract that already ended", () => {
    const r = computeContractStatus("2026-01-01T00:00:00.000Z", NOW);
    expect(r.level).toBe("expired");
    expect(r.daysRemaining).toBeLessThan(0);
  });

  it("warns inside the 90-day window", () => {
    const r = computeContractStatus("2026-09-15T00:00:00.000Z", NOW);
    expect(r.level).toBe("warn");
    expect(r.daysRemaining).toBe(26);
  });

  it("reports healthy runway beyond the window", () => {
    expect(computeContractStatus("2027-07-03T00:00:00.000Z", NOW).level).toBe("ok");
  });

  it("says the date is unavailable rather than guessing when it is null", () => {
    const r = computeContractStatus(null, NOW);
    expect(r.level).toBe("unknown");
    expect(r.label).toMatch(/indisponible/i);
    expect(r.daysRemaining).toBeNull();
  });

  it("treats an unparseable date as unknown, not as expired", () => {
    expect(computeContractStatus("not-a-date", NOW).level).toBe("unknown");
  });
});

describe("isDsAnalysisShape — schema steers, it does not guarantee", () => {
  it("accepts a well-formed analysis", () => {
    expect(isDsAnalysisShape(analysis())).toBe(true);
  });

  it("accepts an empty findings array (nothing notable is a valid answer)", () => {
    expect(isDsAnalysisShape(analysis({ findings: [] }))).toBe(true);
  });

  it.each([
    ["null", null],
    ["a string", "some text"],
    ["a bare array", []],
  ])("rejects %s", (_label, v) => {
    expect(isDsAnalysisShape(v)).toBe(false);
  });

  it("rejects an unknown contract level", () => {
    expect(isDsAnalysisShape(analysis({ contractFlag: { level: "danger" as never, label: "x" } }))).toBe(false);
  });

  it("rejects an unknown finding level", () => {
    expect(
      isDsAnalysisShape(analysis({ findings: [{ level: "urgent" as never, title: "t", detail: "d" }] }))
    ).toBe(false);
  });

  it("rejects an empty summary — a blank analysis must not render as complete", () => {
    expect(isDsAnalysisShape(analysis({ summary: "   " }))).toBe(false);
  });

  it("rejects insufficientData sent as a string instead of a boolean", () => {
    expect(isDsAnalysisShape({ ...analysis(), insufficientData: "false" })).toBe(false);
  });
});

describe("ungroundedDates — a fabricated date is the highest-risk hallucination", () => {
  it("passes an analysis whose dates all come from the source", () => {
    const a = analysis({ summary: "Turbo remplacé le 15/01/2025." });
    expect(ungroundedDates(a, input())).toEqual([]);
  });

  it("accepts the several ways a source date can legitimately be written", () => {
    const a = analysis({ summary: "Le 15/1/2025, puis 01/2025, puis 2025-01-15." });
    expect(ungroundedDates(a, input())).toEqual([]);
  });

  it("catches a date the model invented", () => {
    const a = analysis({ summary: "Panne récurrente depuis le 09/09/2023." });
    expect(ungroundedDates(a, input())).toEqual(["09/09/2023"]);
  });

  it("checks finding titles and details, not just the summary", () => {
    const a = analysis({ findings: [{ level: "warn", title: "Turbo", detail: "vu le 03/03/2022" }] });
    expect(ungroundedDates(a, input())).toEqual(["03/03/2022"]);
  });

  it("allows the contract end date, which is supplied rather than observed", () => {
    const a = analysis({ contractFlag: { level: "ok", label: "Valide jusqu'au 03/07/2027" } });
    expect(ungroundedDates(a, input())).toEqual([]);
  });

  it("allows a replacement date", () => {
    const a = analysis({ summary: "Remplacé le 20/02/2024." });
    const i = input({ replacements: [{ date: "2024-02-20T00:00:00.000Z", motif: "panne" }] });
    expect(ungroundedDates(a, i)).toEqual([]);
  });

  it("ignores a bare year — 'depuis 2024' is prose, not a fabricated date", () => {
    const a = analysis({ summary: "Dégradation observée depuis 2024." });
    expect(ungroundedDates(a, input())).toEqual([]);
  });
});

describe("buildDsAnalysisPrompt", () => {
  const status = computeContractStatus("2027-07-03T00:00:00.000Z", NOW);

  it("hands the model the pre-computed contract status rather than the raw date", () => {
    const p = buildDsAnalysisPrompt(input(), status);
    expect(p).toContain("Statut du contrat (déjà calculé, à reprendre): ok");
  });

  it("marks an empty description explicitly instead of emitting a blank field", () => {
    const p = buildDsAnalysisPrompt(input({ entries: [{ date: "2025-01-15T00:00:00.000Z", description: "  ", parts: [] }] }), status);
    expect(p).toContain("desc: (vide)");
    expect(p).toContain("pièces: (aucune)");
  });

  it("truncates to MAX_ENTRIES and TELLS the model it truncated", () => {
    const many = Array.from({ length: MAX_ENTRIES + 20 }, (_, i) => ({
      date: `2025-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      parts: ["x"],
    }));
    const p = buildDsAnalysisPrompt(input({ entries: many }), status);

    expect(p).toContain(`Interventions (${MAX_ENTRIES} sur ${MAX_ENTRIES + 20}`);
    expect(p).toContain("Ne conclus rien sur la période antérieure");
    expect(p.split("\n").filter((l) => l.startsWith("- 2025-")).length).toBe(MAX_ENTRIES);
  });

  it("includes replacement motifs when present", () => {
    const p = buildDsAnalysisPrompt(input({ replacements: [{ date: "2024-02-20", motif: "panne moteur" }] }), status);
    expect(p).toContain("motif: panne moteur");
  });

  it("omits the replacements block entirely when there are none", () => {
    expect(buildDsAnalysisPrompt(input(), status)).not.toContain("Remplacements");
  });
});
