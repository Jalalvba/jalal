import { describe, expect, it } from "vitest";
import { enforceActionStyle, formatWorkOrder, mayOverwrite, statusWorkOrder, withDestination } from "@/lib/ai/dsAnalysis/workOrder";
import type { DsAnalysis } from "@/lib/ai/prompts/dsAnalysis";

const analysis = (actions?: string[]): DsAnalysis => ({
  contractFlag: { level: "unknown", label: "Date de fin de contrat indisponible" },
  ...(actions ? { actions } : {}),
  findings: [],
  summary: "Résumé.",
  insufficientData: false,
});

describe("formatWorkOrder", () => {
  it("numbers the operations, and strips the justification on the way", () => {
    // The stripping happens HERE, not only where the model answers, so a
    // stored analysis replayed into this function is normalised too — that is
    // what stopped "Diagnostiquer diagnostic" surviving the rule banning it.
    expect(
      formatWorkOrder(
        analysis(["Remplacer le filtre à gasoil (jamais enregistré, 144 878 km)", "Contrôler les injecteurs (3 fois)"])
      )
    ).toBe("1. Remplacer le filtre à gasoil\n2. Contrôler les injecteurs");
  });

  it("returns empty when there is nothing to do", () => {
    // NOT "RAS": the cell is shared with the team's own text, and writing a
    // placeholder over it would destroy a real value to say nothing.
    expect(formatWorkOrder(analysis([]))).toBe("");
    expect(formatWorkOrder(analysis())).toBe("");
    expect(formatWorkOrder(analysis(["  ", ""]))).toBe("");
  });

  it("truncates rather than pushing an unbounded string into a cell", () => {
    // Each action is capped at 90 chars, so it takes many of them to reach the
    // cell limit — which is the point: both bounds exist, at different scales.
    const many = Array.from({ length: 60 }, (_, i) => `Contrôler ${"organe".repeat(6)} ${i}`);
    const out = formatWorkOrder(analysis(many));
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

  it("allows a write that changes nothing, so an unrecorded write can unstick itself", () => {
    // The no-history path used to write the cell without recording it, and
    // every later run then read this app's own text as a human's and refused
    // to touch it — permanently. Observed on 79878-B-7 and 72351-T-1.
    const ours = "1. À envoyer vers depot-ATV";
    expect(mayOverwrite(ours, undefined, ours)).toBe(true);
    // …but only when it is genuinely identical.
    expect(mayOverwrite("DISPONIBLE", undefined, ours)).toBe(false);
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

describe("statusWorkOrder — a vehicle with no history still has to go somewhere", () => {
  it("sends an ATV vehicle to its depot zone", () => {
    // 79878-B-7 exactly: ETAT ATV, zero DS lines, and previously no ACTION at
    // all because the batch stopped at "aucune intervention DS à analyser".
    expect(statusWorkOrder({ etat: "ATV" })).toEqual(["À envoyer vers depot-ATV"]);
  });

  it("sends a Remplacement vehicle to its depot zone", () => {
    expect(statusWorkOrder({ etat: "Remplacement" })).toEqual(["À envoyer vers depot-rempalcmemnt"]);
  });

  it("sends an AVIS vehicle to Pierre Parent", () => {
    expect(statusWorkOrder({ etat: "LLD", isAvis: true })).toEqual(["À envoyer au garage Pierre Parent"]);
  });

  it("lets ETAT outrank ownership — the zone says where the car physically goes", () => {
    expect(statusWorkOrder({ etat: "ATV", isAvis: true })).toEqual(["À envoyer vers depot-ATV"]);
  });

  it("otherwise says the vehicle is ready to be delivered", () => {
    // No "Si conforme :" prefix here — with nothing to control, the
    // destination is not conditional on anything.
    expect(statusWorkOrder({ etat: "LLD" })).toEqual(["À livrer au client"]);
    expect(statusWorkOrder({})).toEqual(["À livrer au client"]);
  });

  it("never returns an empty list — that is the whole point", () => {
    for (const etat of ["", "ATV", "Remplacement", "LCD", "En stock", "inconnu"]) {
      expect(statusWorkOrder({ etat }).length).toBeGreaterThan(0);
    }
  });
});

describe("enforceActionStyle — degenerate lines and the conditional prefix", () => {
  it("drops a verb applied to a word that names nothing", () => {
    // Produced twice in production, from a DS whose description was literally
    // "DIAGNOSTIC".
    expect(enforceActionStyle(["Diagnostiquer diagnostic"])).toEqual([]);
    expect(enforceActionStyle(["Contrôler le contrôle"])).toEqual([]);
    expect(enforceActionStyle(["Vérifier pb"])).toEqual([]);
  });

  it("keeps a verb applied to a real subject", () => {
    expect(enforceActionStyle(["Contrôler le remplacement du filtre à gasoil"])).toEqual([
      "Contrôler le remplacement du filtre à gasoil",
    ]);
    // "Diagnostiquer" is rewritten to the controller's own verb.
    expect(enforceActionStyle(["Diagnostiquer bruit moteur"])).toEqual(["Vérifier bruit moteur"]);
  });

  it("drops 'Si conforme :' when the destination stands alone", () => {
    // Nothing precedes it, so it is conditional on nothing.
    expect(enforceActionStyle(["Si conforme : À livrer au client"])).toEqual(["À livrer au client"]);
  });

  it("keeps the prefix when something is being checked first", () => {
    expect(
      enforceActionStyle(["Contrôler les injecteurs", "Si conforme : À livrer au client"])
    ).toEqual(["Contrôler les injecteurs", "Si conforme : À livrer au client"]);
  });
});

describe("withDestination — the controller always knows where the car goes", () => {
  const v = { etat: "LLD" };

  it("appends the destination when the model forgot it", () => {
    // 45802-B-7 came back with six checks and nowhere to send the car.
    expect(withDestination(["Contrôler la batterie", "Contrôler le turbo"], v)).toEqual([
      "Contrôler la batterie",
      "Contrôler le turbo",
      "Si conforme : À livrer au client",
    ]);
  });

  it("normalises an older phrasing instead of leaving two spellings", () => {
    expect(withDestination(["Disponible — à livrer au client"], v)).toEqual(["À livrer au client"]);
  });

  it("never duplicates it, wherever the model put it", () => {
    expect(
      withDestination(["Si conforme : À livrer au client", "Contrôler les freins"], v)
    ).toEqual(["Contrôler les freins", "Si conforme : À livrer au client"]);
  });

  it("routes by status, and ETAT outranks ownership", () => {
    expect(withDestination(["Contrôler X"], { etat: "ATV", isAvis: true })).toEqual([
      "Contrôler X",
      "Si conforme : À envoyer vers depot-ATV",
    ]);
    expect(withDestination([], { etat: "LCD", isAvis: true })).toEqual([
      "À envoyer au garage Pierre Parent",
    ]);
  });
});

describe("enforceActionStyle — the verb and the runaway subject", () => {
  it("turns Diagnostiquer into Vérifier: the controller verifies, he does not diagnose", () => {
    expect(enforceActionStyle(["Diagnostiquer pb démarrage"])).toEqual(["Vérifier pb démarrage"]);
  });

  it("cuts a pasted DS description down to an instruction", () => {
    // 45802-B-7's real first line.
    const [out] = enforceActionStyle([
      "Diagnostiquer pb démarrage antigel+2l huil boit+huile frein+cullase+colle+fh+5l 5w30",
    ]);
    expect(out.length).toBeLessThanOrEqual(90);
    expect(out.startsWith("Vérifier pb démarrage")).toBe(true);
    expect(out.endsWith("+")).toBe(false);
  });

  it("leaves a normal-length control point alone", () => {
    const line = "Contrôler le remplacement du filtre à gasoil";
    expect(enforceActionStyle([line])).toEqual([line]);
  });
});
