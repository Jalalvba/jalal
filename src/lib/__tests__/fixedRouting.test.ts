import { describe, it, expect } from "vitest";

import { ATELIER_ACTION, enforceActionStyle, fixedRoutingActions } from "@/lib/ai/dsAnalysis/workOrder";

// A0.0 in code. The prompt states the same rule and the model would not follow
// it — 0/8 on four separate live vehicles across three wording attempts, see
// fixedRoutingActions()'s header. These cases are the whole rule.
describe("fixedRoutingActions", () => {
  it("returns null for the zones that must get the full analysis", () => {
    for (const zoning of ["", "DEPOT-DISPONIBLE", "DISPONIBLE-A-LIVRER", "AVIS-PIERRE-PARENT"]) {
      expect(fixedRoutingActions({ zoning })).toBeNull();
    }
    // Named in neither of A0.0's clauses — deliberately not fixed-routing.
    expect(fixedRoutingActions({ zoning: "DEPOT-REMPLACEMENT" })).toBeNull();
  });

  it("routes the plain fixed zones to a single line", () => {
    expect(fixedRoutingActions({ zoning: "DEPOT-ATV" })).toEqual(["Envoyer vers DEPOT-ATV"]);
    expect(fixedRoutingActions({ zoning: "CARROSSERIE-FSM" })).toEqual(["Envoyer vers CARROSSERIE-FSM"]);
    expect(fixedRoutingActions({ zoning: "visite technique" })).toEqual(["Envoyer vers visite technique"]);
  });

  it("gives ATELIER its own mandated text, not an « Envoyer vers » line", () => {
    expect(fixedRoutingActions({ zoning: "ATELIER" })).toEqual([ATELIER_ACTION]);
  });

  it("never depends on how much history the vehicle has", () => {
    // The failure mode being fixed: the model produced a checklist precisely
    // when there was material for one. This function cannot see the history.
    expect(fixedRoutingActions({ zoning: "visite technique", etat: "LLD", cpStatus: "Livré" }))
      .toEqual(["Envoyer vers visite technique"]);
  });

  describe("PRESTATAIRE-EXTERNE", () => {
    const zoning = "PRESTATAIRE-EXTERNE";

    it("copies a real provider name verbatim", () => {
      expect(fixedRoutingActions({ zoning, prestataire: "HAMID CLIM" }))
        .toEqual(["Envoyer vers PRESTATAIRE-EXTERNE (HAMID CLIM)"]);
      expect(fixedRoutingActions({ zoning, prestataire: "amine diag" }))
        .toEqual(["Envoyer vers PRESTATAIRE-EXTERNE (amine diag)"]);
    });

    it("redirects any Scal value to the workshop, in any case or position", () => {
      for (const p of ["SCAL", "scal", "Scal Casa", "SCAL AVIS", "  Scal  "]) {
        expect(fixedRoutingActions({ zoning, prestataire: p })).toEqual([ATELIER_ACTION]);
      }
    });

    it("omits the parenthetical when there is no name to put in it", () => {
      expect(fixedRoutingActions({ zoning })).toEqual(["Envoyer vers PRESTATAIRE-EXTERNE"]);
      expect(fixedRoutingActions({ zoning, prestataire: "   " })).toEqual(["Envoyer vers PRESTATAIRE-EXTERNE"]);
    });
  });
});

// The provider name has to survive the whole pipeline, not just leave
// fixedRoutingActions() correct — enforceActionStyle() used to strip it.
describe("the provider name reaches the ACTION text", () => {
  it("keeps the parenthetical through enforceActionStyle", () => {
    expect(enforceActionStyle(["Envoyer vers PRESTATAIRE-EXTERNE (HAMID CLIM)"]))
      .toEqual(["Envoyer vers PRESTATAIRE-EXTERNE (HAMID CLIM)"]);
  });

  it("still strips a genuine parenthetical justification off a control point", () => {
    expect(enforceActionStyle(["Contrôler les injecteurs (3 interventions)"]))
      .toEqual(["Contrôler les injecteurs"]);
  });
});
