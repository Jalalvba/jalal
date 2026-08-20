import { describe, expect, it } from "vitest";
import { detectServices, servicesInEntry } from "@/lib/ai/prompts/serviceTypes";

describe("detectServices — real production strings", () => {
  it.each([
    // AVIS's own package codes: the filter letters say what else was changed.
    ["VIDANGE 1:HUILE+FILTRE H+MO", ["vidange"]],
    ["VIDANGE 2:HUILE+FILTRE H/A+MO", ["vidange", "filtre_air"]],
    ["VIDANGE 4: HUILE+FILTRE H/G+MO", ["vidange", "filtre_gasoil"]],
    ["VIDANGE 3:HUIL+FILTRE H/A/G+MO", ["vidange", "filtre_air", "filtre_gasoil"]],
    ["VIDANGE 6:HUILE+MO", ["vidange"]],
    ["VIDANGE 1:HUILE+FILTRE H+MO+FA", ["vidange", "filtre_air"]],
    // Standalone lines.
    ["FILTRE A AIR", ["filtre_air"]],
    ["FILTRE A GASOIL", ["filtre_gasoil"]],
    ["FILTRE CARBURANT PFX FCS921", ["filtre_gasoil"]],
    ["CHANGEMENT KIT DE DISTRIBUTION", ["distribution"]],
    ["CHANG. COURROIE DISTRIBUTION", ["distribution"]],
    ["POMPE A EAU", ["pompe_eau"]],
    ["CHANGEMENT POMPE à EAU", ["pompe_eau"]],
  ])("%s", (input, expected) => {
    expect([...detectServices(input)].sort()).toEqual([...expected].sort());
  });

  it.each([
    // Each of these is a high-volume false positive a naive keyword match hits.
    ["FILTRE A HUILE"],           // the oil FILTER part, not an oil change (26,379 rows)
    ["COURROIE ALTERNATEUR"],     // a different belt (724 rows)
    ["COURROIE D'ACCESSOIRE"],    // a different belt (261 rows)
    ["TENDEUR DE COURROIE"],
    ["BOUCHON POMPE A EAU"],      // a cap
    ["JOINT POMPE A EAU"],        // a gasket
    ["DURITE FILTRE A AIR"],      // a hose
    ["POMPE A GASOIL"],           // a pump
    ["CAPTEUR FILTRE A GASOIL"],  // a sensor
    ["FILTRE A CLIM"],            // cabin filter — a different service
    ["VIDANGE 5: BOITE A VITESSE"], // gearbox oil, not engine oil
    ["GASOIL"],                   // the fuel itself
  ])("does not match the trap %s", (input) => {
    expect([...detectServices(input)]).toEqual([]);
  });

  it("survives non-string values from Mongo", () => {
    expect(() => detectServices(12345)).not.toThrow();
    expect([...detectServices(null)]).toEqual([]);
  });

  it("unions services across an entry's parts", () => {
    expect([...servicesInEntry(["FILTRE A AIR", "POMPE A EAU"])].sort()).toEqual([
      "filtre_air",
      "pompe_eau",
    ]);
  });
});
