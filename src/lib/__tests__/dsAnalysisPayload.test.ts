import { describe, it, expect } from "vitest";
import { buildDsAnalysisPayload, toDsAnalysisEntries } from "@/lib/ai/dsAnalysis/payload";
import { EXTERNAL_TECHNICIAN_SENTINEL } from "@/lib/ai/prompts/dsAnalysis";
import type { DsHistoryItem } from "@/types";

// This builder is the one input the model sees, shared by DS History's card
// and the compact button on Suivi RL / Parking / Atelier / Depot. These pin the
// parts that were previously duplicated per call site and could drift.

describe("toDsAnalysisEntries", () => {
  it("coerces non-string Mongo values instead of trusting the declared types", () => {
    const items = [
      {
        n_ds: "1",
        date_ds: "2026-01-05",
        // Mongo hands these back as numbers often enough that .trim() on the
        // declared `string` would throw — 77f9eef's footgun.
        description: 208 as unknown as string,
        lines: [{ designation_consommation: 4 as unknown as string }, { designation_consommation: "  " }],
      } as unknown as DsHistoryItem,
    ];
    const [e] = toDsAnalysisEntries(items);
    expect(e.description).toBe("208");
    // Blank-only designations are dropped; the numeric one survives as text.
    expect(e.parts).toEqual(["4"]);
  });

  it("classifies origin per entry, including the external sentinel", () => {
    const items = [
      { n_ds: "1", fournisseur: "STAR PNEUMATIQUE", techniciens: [] },
      { n_ds: "2", techniciens: [EXTERNAL_TECHNICIAN_SENTINEL] },
      { n_ds: "3", techniciens: ["Youssef"] },
      { n_ds: "4", techniciens: [] },
    ] as DsHistoryItem[];
    expect(toDsAnalysisEntries(items).map((e) => e.origin)).toEqual([
      "externe",
      "externe",
      "interne",
      "inconnu",
    ]);
    expect(toDsAnalysisEntries(items)[0].supplier).toBe("STAR PNEUMATIQUE");
    // External but unnamed — the supplier is absent, not guessed.
    expect(toDsAnalysisEntries(items)[1].supplier).toBeUndefined();
  });

  it("has no lines at all without inventing an empty part", () => {
    expect(toDsAnalysisEntries([{ n_ds: "1" } as DsHistoryItem])[0].parts).toEqual([]);
  });
});

describe("buildDsAnalysisPayload", () => {
  it("fills the context the zone pages do not have with honest empties", () => {
    // Parking/Atelier/Depot/Suivi RL know a plate and nothing else. contractEnd
    // must be null so the prompt takes its documented "date indisponible"
    // branch rather than being handed a made-up date as fact.
    const p = buildDsAnalysisPayload({ imm: "12345-A-6", items: [] });
    expect(p).toEqual({
      imm: "12345-A-6",
      contractEnd: null,
      vehicle: {},
      replacements: [],
      entries: [],
    });
  });

  it("passes DS History's richer context through unchanged", () => {
    const p = buildDsAnalysisPayload({
      imm: "12345-A-6",
      items: [],
      contractEnd: "2026-12-31",
      vehicle: { brand: "Peugeot", model: "208", state: "En service" },
      replacements: [{ date: "2026-03-01", motif: "Panne" }],
    });
    expect(p.contractEnd).toBe("2026-12-31");
    expect(p.vehicle).toEqual({ brand: "Peugeot", model: "208", state: "En service" });
    expect(p.replacements).toEqual([{ date: "2026-03-01", motif: "Panne" }]);
  });
});
