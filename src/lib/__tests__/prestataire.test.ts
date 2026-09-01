import { describe, expect, it } from "vitest";
import { isInHousePrestataire } from "@/lib/utils/prestataire";

describe("isInHousePrestataire", () => {
  it("matches the in-house entity in any case, anywhere in the value", () => {
    expect(isInHousePrestataire("SCAL")).toBe(true);
    expect(isInHousePrestataire("Scal Casa")).toBe(true);
    expect(isInHousePrestataire("SCAL AVIS")).toBe(true);
    expect(isInHousePrestataire("  scal  ")).toBe(true);
  });

  it("does not match a real external garage", () => {
    for (const p of ["amine diag", "STELLANTIS", "SMEIA", "HAMID CLIM", "simo BV", "EMAA"]) {
      expect(isInHousePrestataire(p)).toBe(false);
    }
  });

  it("treats a blank or absent value as not in-house — an empty cell says nothing", () => {
    expect(isInHousePrestataire("")).toBe(false);
    expect(isInHousePrestataire(null)).toBe(false);
    expect(isInHousePrestataire(undefined)).toBe(false);
  });
});
