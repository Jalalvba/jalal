import { describe, expect, it } from "vitest";
import { formatWorkOrder, mayOverwrite } from "@/lib/ai/dsAnalysis/workOrder";
import type { DsAnalysis } from "@/lib/ai/prompts/dsAnalysis";

const analysis = (actions?: string[]): DsAnalysis => ({
  contractFlag: { level: "unknown", label: "Date de fin de contrat indisponible" },
  ...(actions ? { actions } : {}),
  findings: [],
  summary: "Résumé.",
  insufficientData: false,
});

describe("formatWorkOrder", () => {
  it("numbers the operations, and writes nothing else", () => {
    expect(
      formatWorkOrder(
        analysis(["Remplacer le filtre à gasoil (jamais enregistré, 144 878 km)", "Contrôler les injecteurs (3 fois)"])
      )
    ).toBe(
      "1. Remplacer le filtre à gasoil (jamais enregistré, 144 878 km)\n2. Contrôler les injecteurs (3 fois)"
    );
  });

  it("returns empty when there is nothing to do", () => {
    // NOT "RAS": the cell is shared with the team's own text, and writing a
    // placeholder over it would destroy a real value to say nothing.
    expect(formatWorkOrder(analysis([]))).toBe("");
    expect(formatWorkOrder(analysis())).toBe("");
    expect(formatWorkOrder(analysis(["  ", ""]))).toBe("");
  });

  it("truncates rather than pushing an unbounded string into a cell", () => {
    const out = formatWorkOrder(analysis([("x".repeat(400) + " ").repeat(6)]));
    expect(out.length).toBeLessThanOrEqual(1500);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("mayOverwrite — the ACTION column belongs to the team too", () => {
  it("writes into an empty cell", () => {
    expect(mayOverwrite("", undefined)).toBe(true);
    expect(mayOverwrite("   ", "anything")).toBe(true);
  });

  it("refreshes its own previous output", () => {
    const prev = "1. Remplacer le filtre à gasoil";
    expect(mayOverwrite(prev, prev)).toBe(true);
    expect(mayOverwrite(` ${prev} `, prev)).toBe(true);
  });

  it("never touches text a human typed", () => {
    // "DISPONIBLE" is what 8 of the 84 live rows hold today.
    expect(mayOverwrite("DISPONIBLE", undefined)).toBe(false);
    expect(mayOverwrite("DISPONIBLE", "1. Remplacer le filtre à gasoil")).toBe(false);
  });

  it("does not overwrite an edited version of its own output", () => {
    expect(mayOverwrite("1. Remplacer le filtre à gasoil — FAIT le 12/08", "1. Remplacer le filtre à gasoil")).toBe(false);
  });
});
