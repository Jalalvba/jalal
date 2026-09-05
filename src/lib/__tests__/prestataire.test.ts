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

  it("does not match 'scal' as a bare substring of an unrelated word — word-bounded, not a plain includes()", () => {
    // All real-shaped external garage names that a bare /scal/i previously
    // matched, silently routing them to ATELIER and describing them as
    // in-house. "Pascal" is an entirely ordinary garage name.
    for (const p of [
      "Garage Pascal",
      "PASCAL AUTO",
      "Carrosserie Pascal",
      "Escale Auto",
      "GARAGE L'ESCALE",
      "Fiscal Services",
      "Mescaline Motors",
      "Rescal",
    ]) {
      expect(isInHousePrestataire(p)).toBe(false);
    }
  });

  it("treats a blank or absent value as not in-house — an empty cell says nothing", () => {
    expect(isInHousePrestataire("")).toBe(false);
    expect(isInHousePrestataire(null)).toBe(false);
    expect(isInHousePrestataire(undefined)).toBe(false);
  });
});
