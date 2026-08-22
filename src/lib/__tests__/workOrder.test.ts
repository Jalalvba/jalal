import { describe, expect, it } from "vitest";
import { enforceActionStyle, formatWorkOrder, mayOverwrite } from "@/lib/ai/dsAnalysis/workOrder";
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

describe("enforceActionStyle — the column takes instructions, not evidence", () => {
  it("strips the parenthetical justification", () => {
    expect(enforceActionStyle(["Remplacer le filtre à gasoil (jamais enregistré, 144 878 km)"])).toEqual([
      "Remplacer le filtre à gasoil",
    ]);
  });

  it("strips dates, which would otherwise get the whole action deleted", () => {
    // The real failure: ungroundedDates() drops any action carrying a date not
    // in the source, so 48083-B-7 lost "Contrôler les plaquettes" entirely and
    // its work order read "Disponible — à livrer au client".
    expect(
      enforceActionStyle(["Contrôler les plaquettes AV : 2024-04-12, 2025-12-03"])
    ).toEqual(["Contrôler les plaquettes AV"]);
  });

  it("strips a trailing km count written without parentheses", () => {
    expect(enforceActionStyle(["Vidange moteur — 12 000 km"])).toEqual(["Vidange moteur"]);
  });

  it("keeps a clean instruction untouched", () => {
    expect(enforceActionStyle(["À envoyer vers depot-ATV"])).toEqual(["À envoyer vers depot-ATV"]);
  });

  it("drops duplicates left behind by the stripping", () => {
    expect(
      enforceActionStyle(["Remplacer le filtre à air (30 000 km)", "Remplacer le filtre à air"])
    ).toEqual(["Remplacer le filtre à air"]);
  });

  it("drops an action that was nothing but decoration", () => {
    expect(enforceActionStyle(["(2025-01-04)", "   "])).toEqual([]);
  });
});
