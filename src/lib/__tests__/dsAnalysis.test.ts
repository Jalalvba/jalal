import { describe, expect, it } from "vitest";
import {
  DS_ANALYSIS_SYSTEM_PROMPT,
  classifyRepairOrigin,
  canonicalizeSuppliers,
  ungroundedSuppliers,
  EXTERNAL_TECHNICIAN_SENTINEL,
  computeContractStatus,
  isDsAnalysisShape,
  ungroundedDates,
  buildDsAnalysisPrompt,
  MAX_ENTRIES,
  type DsAnalysis,
  type DsAnalysisInput,
  type DsAnalysisEntry,
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
    entries: [{ date: "2025-01-15T00:00:00.000Z", parts: ["turbo moteur"], origin: "interne" }],
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
    const p = buildDsAnalysisPrompt(input({ entries: [{ date: "2025-01-15T00:00:00.000Z", description: "  ", parts: [], origin: "interne" }] }), status);
    expect(p).toContain("desc: (vide)");
    expect(p).toContain("pièces: (aucune)");
  });

  it("truncates to MAX_ENTRIES and TELLS the model it truncated", () => {
    const many = Array.from({ length: MAX_ENTRIES + 20 }, (_, i) => ({
      date: `2025-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      parts: ["x"],
      origin: "interne" as const,
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


describe("classifyRepairOrigin — the rule, verified against production shapes", () => {
  it("a named fournisseur is external, and carries the supplier name", () => {
    // Real shape: n_ds=DSES22120945, fournisseur="STAR PNEUMATIQUE", no technicien.
    expect(classifyRepairOrigin("STAR PNEUMATIQUE", [])).toEqual({
      origin: "externe",
      supplier: "STAR PNEUMATIQUE",
    });
  });

  it("the 'Fournisseur Externe' sentinel alone is external, unnamed", () => {
    // 10,277 production records look exactly like this. A rule keyed only on
    // fournisseur would file every one of them as in-house work.
    expect(classifyRepairOrigin(null, [EXTERNAL_TECHNICIAN_SENTINEL])).toEqual({ origin: "externe" });
  });

  it("a real technicien name with no fournisseur is internal", () => {
    // Real shape: n_ds=DSES22010077, with a named AVIS technician. The name is
    // a placeholder — this repo is public and the assertion is about "a
    // non-sentinel technician string means internal", not about any individual.
    expect(classifyRepairOrigin(undefined, ["Mohamed Alami"])).toEqual({ origin: "interne" });
  });

  it("both a supplier and the sentinel resolves to external WITH the name", () => {
    // Real shape: fournisseur="STAR PNEUMATIQUE", technicien="Fournisseur Externe",
    // entite="Garage Ain Sebaa" — the garage is where, not who.
    expect(classifyRepairOrigin("STAR PNEUMATIQUE", [EXTERNAL_TECHNICIAN_SENTINEL])).toEqual({
      origin: "externe",
      supplier: "STAR PNEUMATIQUE",
    });
  });

  it("neither signal is 'inconnu' — never silently internal", () => {
    expect(classifyRepairOrigin(null, [])).toEqual({ origin: "inconnu" });
    expect(classifyRepairOrigin("   ", ["  "])).toEqual({ origin: "inconnu" });
  });

  it("matches the sentinel case-insensitively", () => {
    expect(classifyRepairOrigin(null, ["fournisseur externe"]).origin).toBe("externe");
  });

  it("survives non-string values from Mongo, which does not honour declared types", () => {
    // A numeric fournisseur is still a supplier identifier, so external is
    // correct here — the point is that String() coercion means neither value
    // throws on .trim(), the footgun 77f9eef fixed elsewhere.
    expect(classifyRepairOrigin(12345, [])).toEqual({ origin: "externe", supplier: "12345" });
    // A numeric technicien with no fournisseur is still someone, so: internal.
    expect(classifyRepairOrigin(null, [678])).toEqual({ origin: "interne" });
    // A non-array techniciens must not throw.
    expect(() => classifyRepairOrigin(null, "not-an-array")).not.toThrow();
    expect(classifyRepairOrigin(null, "not-an-array")).toEqual({ origin: "inconnu" });
  });
});

describe("canonicalizeSuppliers", () => {
  const e = (supplier?: string): DsAnalysisEntry => ({ parts: [], origin: "externe", supplier });

  it("collapses the one real production collision onto the most frequent spelling", () => {
    const out = canonicalizeSuppliers([
      e("EQUIPEMENT MOYEN ATLAS ASSALAMA"),
      e("EQUIPEMENT MOYEN ATLAS ASSALAMA"),
      e("Equipement moyen atlas assalama"),
    ]);
    expect(out.map((x) => x.supplier)).toEqual([
      "EQUIPEMENT MOYEN ATLAS ASSALAMA",
      "EQUIPEMENT MOYEN ATLAS ASSALAMA",
      "EQUIPEMENT MOYEN ATLAS ASSALAMA",
    ]);
  });

  it("never merges genuinely different suppliers", () => {
    const out = canonicalizeSuppliers([e("AUTO 26"), e("AUTO MECANIQUE IBN ROCHD")]);
    expect(new Set(out.map((x) => x.supplier)).size).toBe(2);
  });

  it("leaves internal and unnamed-external entries untouched", () => {
    const out = canonicalizeSuppliers([
      { parts: [], origin: "interne" },
      { parts: [], origin: "externe" },
    ]);
    expect(out[0].supplier).toBeUndefined();
    expect(out[1].supplier).toBeUndefined();
  });
});

describe("ungroundedSuppliers — an invented garage reads as authoritative", () => {
  const withSuppliers = (): DsAnalysisInput =>
    input({
      entries: [
        { parts: ["turbo"], origin: "externe", supplier: "AUTO MECANIQUE IBN ROCHD", description: "PB MOTEUR" },
        { parts: [], origin: "interne", description: "4 PNEUS" },
      ],
    });

  it("passes a finding naming a supplier that is really in the data", () => {
    const a = analysis({
      findings: [{ level: "warn", title: "AUTO MECANIQUE IBN ROCHD", detail: "8 interventions" }],
    });
    expect(ungroundedSuppliers(a, withSuppliers())).toEqual([]);
  });

  it("catches a fabricated garage name", () => {
    const a = analysis({
      findings: [{ level: "critical", title: "GARAGE DUPONT SARL", detail: "5 interventions" }],
    });
    expect(ungroundedSuppliers(a, withSuppliers())).toEqual(["GARAGE DUPONT SARL"]);
  });

  it("does NOT flag an upper-case description the model quoted verbatim", () => {
    // The whole reason the haystack is the full payload, not just the supplier
    // list: descriptions are upper-case too ("PB MOTEUR", "4 PNEUS").
    const a = analysis({ findings: [{ level: "info", title: "PB MOTEUR", detail: "récurrent" }] });
    expect(ungroundedSuppliers(a, withSuppliers())).toEqual([]);
  });

  it("tolerates a casing difference in the model's echo", () => {
    const a = analysis({
      findings: [{ level: "warn", title: "Auto Mecanique Ibn Rochd", detail: "8 fois" }],
    });
    expect(ungroundedSuppliers(a, withSuppliers())).toEqual([]);
  });

  it("returns nothing when the vehicle has no external work at all", () => {
    const a = analysis({ findings: [{ level: "info", title: "RIEN A SIGNALER", detail: "" }] });
    const noExt = input({ entries: [{ parts: [], origin: "interne" }] });
    expect(ungroundedSuppliers(a, noExt)).toEqual([]);
  });
});

describe("buildDsAnalysisPrompt — origin markers (rule 8)", () => {
  const status = computeContractStatus("2027-07-03T00:00:00.000Z", NOW);

  it("marks each of the four origin cases distinctly", () => {
    const p = buildDsAnalysisPrompt(
      input({
        entries: [
          { date: "2025-01-01", parts: [], origin: "interne" },
          { date: "2025-01-02", parts: [], origin: "externe", supplier: "STAR PNEUMATIQUE" },
          { date: "2025-01-03", parts: [], origin: "externe" },
          { date: "2025-01-04", parts: [], origin: "inconnu" },
        ],
      }),
      status
    );
    expect(p).toContain("| interne");
    expect(p).toContain("| externe: STAR PNEUMATIQUE");
    expect(p).toContain("| externe (non nommé)");
    expect(p).toContain("| inconnu");
  });
});


describe("DS_ANALYSIS_SYSTEM_PROMPT — the three mandatory axes", () => {
  // These assertions exist because part-recurrence detection REGRESSED once
  // already: it was the only axis with no "actively search" mandate, while
  // rule 9 mandated supplier recurrence and rule 14 explicitly ranked
  // recurrences below interval checks. Measured on 47024-B-7, three runs
  // produced 2, 0 and 1 part-recurrence findings despite the data containing
  // injectors 6x, embrayage 3x and moyeu 2x. After the restructure: 4, 3, 3.

  it("states all three axes as independent and non-optional", () => {
    expect(DS_ANALYSIS_SYSTEM_PROMPT).toContain("TROIS AXES");
    expect(DS_ANALYSIS_SYSTEM_PROMPT).toMatch(/AXE 1 —.*[Ii]ntervalle/);
    expect(DS_ANALYSIS_SYSTEM_PROMPT).toMatch(/AXE 2 —.*[Rr]écurrences de pièces/);
    expect(DS_ANALYSIS_SYSTEM_PROMPT).toMatch(/AXE 3 —.*[Rr]écurrences de prestataires/);
    expect(DS_ANALYSIS_SYSTEM_PROMPT).toContain("Aucun n'est optionnel");
  });

  it("mandates an ACTIVE search for part recurrence, not merely how to phrase one", () => {
    // The distinction that caused the regression: rules 2 and 3 describe the
    // FORMAT of a recurrence finding; neither asks for one to exist.
    expect(DS_ANALYSIS_SYSTEM_PROMPT).toMatch(/RECHERCHE ACTIVEMENT les récurrences de pièces/);
  });

  it("keeps the same active mandate for supplier recurrence", () => {
    expect(DS_ANALYSIS_SYSTEM_PROMPT).toMatch(/RECHERCHE ACTIVEMENT les récurrences par prestataire/);
  });

  it("instructs grouping of spelling variants into one finding", () => {
    expect(DS_ANALYSIS_SYSTEM_PROMPT).toContain("REGROUPE les variantes");
    expect(DS_ANALYSIS_SYSTEM_PROMPT).toContain("TARAGE INJECTEUR");
  });

  it("no longer ranks interval checks ABOVE recurrences", () => {
    // The exact wording that demoted axis 2.
    expect(DS_ANALYSIS_SYSTEM_PROMPT).not.toContain("AVANT les récurrences");
    expect(DS_ANALYSIS_SYSTEM_PROMPT).toContain("GARANTIE DE PLACE, PAS DE PRIORITÉ ENTRE AXES");
  });

  it("allows 10 findings, not 6 — the cap was the mechanical cause of crowding", () => {
    expect(DS_ANALYSIS_SYSTEM_PROMPT).toMatch(/jusqu'à 10 éléments/);
    expect(DS_ANALYSIS_SYSTEM_PROMPT).not.toMatch(/0 à 6 éléments/);
  });

  it("uses a 2-occurrence threshold for parts, looser than suppliers' 3", () => {
    expect(DS_ANALYSIS_SYSTEM_PROMPT).toMatch(/2 fois ou plus/);
    expect(DS_ANALYSIS_SYSTEM_PROMPT).toMatch(/3 fois ou plus/);
  });
});
