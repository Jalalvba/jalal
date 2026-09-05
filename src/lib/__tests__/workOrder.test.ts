import { describe, expect, it } from "vitest";
import { enforceActionStyle, formatWorkOrder, mayOverwrite, statusWorkOrder, withDestination, zonePreconditionFailure } from "@/lib/ai/dsAnalysis/workOrder";
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
    const ours = "1. DEPOT-ATV";
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
    expect(enforceActionStyle(["DEPOT-ATV"])).toEqual(["DEPOT-ATV"]);
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
    expect(statusWorkOrder({ etat: "ATV" })).toEqual(["DEPOT-ATV"]);
  });

  it("sends a Remplacement vehicle to its depot zone", () => {
    expect(statusWorkOrder({ etat: "Remplacement" })).toEqual(["DEPOT-REMPLACEMENT"]);
  });

  it("sends an AVIS vehicle to Pierre Parent", () => {
    expect(statusWorkOrder({ etat: "LLD", isAvis: true })).toEqual(["AVIS-PIERRE-PARENT"]);
  });

  it("lets ETAT outrank ownership — the zone says where the car physically goes", () => {
    expect(statusWorkOrder({ etat: "ATV", isAvis: true })).toEqual(["DEPOT-ATV"]);
  });

  it("otherwise says the vehicle is ready to be delivered", () => {
    // No "Si conforme :" prefix here — with nothing to control, the
    // destination is not conditional on anything.
    expect(statusWorkOrder({ etat: "LLD" })).toEqual(["DISPONIBLE-A-LIVRER"]);
    expect(statusWorkOrder({})).toEqual(["DISPONIBLE-A-LIVRER"]);
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
    expect(enforceActionStyle(["Si conforme : DISPONIBLE-A-LIVRER"])).toEqual(["DISPONIBLE-A-LIVRER"]);
  });

  it("keeps the prefix when something is being checked first", () => {
    expect(
      enforceActionStyle(["Contrôler les injecteurs", "Si conforme : DISPONIBLE-A-LIVRER"])
    ).toEqual(["Contrôler les injecteurs", "Si conforme : DISPONIBLE-A-LIVRER"]);
  });
});

describe("withDestination — the controller always knows where the car goes", () => {
  const v = { etat: "LLD" };

  it("appends the destination when the model forgot it", () => {
    // 45802-B-7 came back with six checks and nowhere to send the car.
    expect(withDestination(["Contrôler la batterie", "Contrôler le turbo"], v)).toEqual([
      "Contrôler la batterie",
      "Contrôler le turbo",
      "Si conforme : DISPONIBLE-A-LIVRER",
    ]);
  });

  it("normalises an older phrasing instead of leaving two spellings", () => {
    // A stored answer written under the pre-2026-08-29 rules: the sentence form
    // is recognised as a destination, dropped from the checks, and replaced by
    // a real zone value rather than surviving as a second spelling.
    expect(withDestination(["Disponible — à livrer au client"], v)).toEqual([
      "DISPONIBLE-A-LIVRER",
    ]);
  });

  it("never duplicates it, wherever the model put it", () => {
    expect(
      withDestination(["Si conforme : DISPONIBLE-A-LIVRER", "Contrôler les freins"], v)
    ).toEqual(["Contrôler les freins", "Si conforme : DISPONIBLE-A-LIVRER"]);
  });

  it("KEEPS the zone the model chose, rather than substituting a status rule", () => {
    // The point of the 2026-08-29 change. This vehicle is ETAT ATV and AVIS-
    // owned, so the old status logic would have forced DEPOT-ATV; the model
    // applied A0.5 criterion 5 (carrosserie) and that choice now survives.
    expect(
      withDestination(["Contrôler le pare-chocs", "Si conforme : CARROSSERIE-FSM"], {
        etat: "ATV",
        isAvis: true,
      })
    ).toEqual(["Contrôler le pare-chocs", "Si conforme : CARROSSERIE-FSM"]);
  });

  it("falls back to the status rule only when the model named no destination", () => {
    // The last line is a CHECK, not a zone — it must not be promoted into the
    // destination slot.
    expect(withDestination(["Contrôler X"], { etat: "ATV", isAvis: true })).toEqual([
      "Contrôler X",
      "Si conforme : DEPOT-ATV",
    ]);
    expect(withDestination([], { etat: "LCD", isAvis: true })).toEqual(["AVIS-PIERRE-PARENT"]);
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

// ─── Zone preconditions, and the ACTION/ZONING agreement they enforce ──────
//
// Measured live 2026-08-29, twice with identical results at temperature 0.2:
// the model sent 908977WW (owner REVE COSMETIQUE) and 18148-T-6 (owner
// LOGISMAR) to AVIS-PIERRE-PARENT with neither an AVIS owner nor ETAT « LCD »,
// and with no part-change action either — so BOTH conjuncts of criterion
// A0.5.4 were absent, not just the first.
describe("zonePreconditionFailure — the factual gates, in one place", () => {
  it("permits AVIS-PIERRE-PARENT for an AVIS vehicle, whatever its ETAT", () => {
    expect(zonePreconditionFailure("AVIS-PIERRE-PARENT", { etat: "LLD", isAvis: true })).toBeNull();
  });

  it("permits it for an LCD vehicle that is not flagged AVIS", () => {
    expect(zonePreconditionFailure("AVIS-PIERRE-PARENT", { etat: "LCD" })).toBeNull();
    expect(zonePreconditionFailure("AVIS-PIERRE-PARENT", { etat: "  lcd " })).toBeNull();
  });

  it("refuses the exact shape observed failing in production", () => {
    const r = zonePreconditionFailure("AVIS-PIERRE-PARENT", { etat: "LLD", isAvis: false });
    expect(r).toContain("A0.5.4");
  });

  it("gates DEPOT-ATV on the ETAT or a closed contract", () => {
    expect(zonePreconditionFailure("DEPOT-ATV", { etat: "ATV" })).toBeNull();
    expect(zonePreconditionFailure("DEPOT-ATV", { etat: "LLD", cpStatus: "Arret facturation" })).toBeNull();
    // "Restitué" carries its accent; "Arret" carries no circumflex (see CpItem).
    expect(zonePreconditionFailure("DEPOT-ATV", { etat: "LLD", cpStatus: "Restitué" })).toBeNull();
    expect(zonePreconditionFailure("DEPOT-ATV", { etat: "LLD", cpStatus: "Livré" })).toContain("A0.5.1");
  });

  it("gates DEPOT-REMPLACEMENT on the ETAT", () => {
    expect(zonePreconditionFailure("DEPOT-REMPLACEMENT", { etat: "Remplacement" })).toBeNull();
    expect(zonePreconditionFailure("DEPOT-REMPLACEMENT", { etat: "LLD" })).toContain("A0.5.2");
  });

  it("leaves the interpretive and residual criteria ungoverned", () => {
    // 5 is a genuine reading of the history; 7, 8, 9 are residual.
    for (const z of ["CARROSSERIE-FSM", "ATELIER", "DISPONIBLE-A-LIVRER", "DEPOT-DISPONIBLE"]) {
      expect(zonePreconditionFailure(z, { etat: "LLD", isAvis: false })).toBeNull();
    }
  });

  it("refuses PRESTATAIRE-EXTERNE when the prestataire is actually in-house (Scal)", () => {
    expect(zonePreconditionFailure("PRESTATAIRE-EXTERNE", { etat: "LLD", prestataire: "SCAL Casa" })).toContain(
      "A0.5.6"
    );
    expect(zonePreconditionFailure("PRESTATAIRE-EXTERNE", { etat: "LLD", prestataire: "Garage Hamid" })).toBeNull();
    expect(zonePreconditionFailure("PRESTATAIRE-EXTERNE", { etat: "LLD" })).toBeNull();
  });

  it("refuses 'visite technique' on the A0.5 analysis path — it is only reachable via A0.0's ZONING bypass", () => {
    expect(zonePreconditionFailure("visite technique", { etat: "LLD", isAvis: false })).not.toBeNull();
  });
});

describe("ACTION and ZONING never disagree about a refused destination", () => {
  // The gap this closed: the guard used to live only on the ZONING write, so a
  // refused vehicle got a blank zone while ACTION still read
  // "Si conforme : AVIS-PIERRE-PARENT" — the column the controller works from
  // asserting a destination the sheet had just refused to record.
  const nonAvis = { etat: "LLD", isAvis: false };

  it("drops a precondition-failing zone out of the ACTION text too", () => {
    const out = withDestination(["Contrôler le thermostat", "Si conforme : AVIS-PIERRE-PARENT"], nonAvis);
    expect(out.join(" ")).not.toContain("AVIS-PIERRE-PARENT");
    expect(out[out.length - 1]).toBe("Si conforme : DISPONIBLE-A-LIVRER");
  });

  it("keeps a permitted zone untouched", () => {
    const v = { etat: "LCD", isAvis: false };
    expect(withDestination(["Contrôler X", "Si conforme : AVIS-PIERRE-PARENT"], v)).toEqual([
      "Contrôler X",
      "Si conforme : AVIS-PIERRE-PARENT",
    ]);
  });

  it("refuses DEPOT-ATV and DEPOT-REMPLACEMENT on the same rule", () => {
    expect(withDestination(["DEPOT-ATV"], nonAvis)).toEqual(["DISPONIBLE-A-LIVRER"]);
    expect(withDestination(["DEPOT-REMPLACEMENT"], nonAvis)).toEqual(["DISPONIBLE-A-LIVRER"]);
    expect(withDestination(["DEPOT-ATV"], { etat: "ATV" })).toEqual(["DEPOT-ATV"]);
  });

  it("never falls back to a zone that itself fails a precondition", () => {
    // statusWorkOrder() is the fallback, so its four outcomes must all be
    // precondition-safe for the vehicle they were derived from.
    for (const v of [
      { etat: "ATV" }, { etat: "Remplacement" }, { etat: "LLD", isAvis: true },
      { etat: "LLD" }, { etat: "LCD" }, { etat: "" },
    ]) {
      const zone = withDestination([], v)[0];
      expect(zonePreconditionFailure(zone, v)).toBeNull();
    }
  });
});
