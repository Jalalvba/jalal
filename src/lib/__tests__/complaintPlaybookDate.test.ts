import { describe, it, expect } from "vitest";
import { containsDateLiteral } from "@/lib/gemini/complaintPlaybook";

// The guard exists because the model invents dateRangeObserved on undated
// input regardless of the prompt — see containsDateLiteral's comment. These
// cases pin the "generous, but not fooled by identifiers" balance it strikes.
describe("containsDateLiteral", () => {
  it("finds ISO and month-first dates", () => {
    expect(containsDateLiteral("réservation du 2026-08-19")).toBe(true);
    expect(containsDateLiteral("période 2026-03 à 2026-08")).toBe(true);
  });

  it("finds day-first numeric dates", () => {
    expect(containsDateLiteral("loué le 19/08/2026")).toBe(true);
    expect(containsDateLiteral("rendu le 3.09.26")).toBe(true);
  });

  it("finds French month names, accented or not", () => {
    expect(containsDateLiteral("le 19 août 2026")).toBe(true);
    expect(containsDateLiteral("en aout dernier")).toBe(true);
    expect(containsDateLiteral("Décembre a été difficile")).toBe(true);
  });

  it("finds a standalone year", () => {
    expect(containsDateLiteral("depuis 2025 nous constatons")).toBe(true);
  });

  it("returns false for undated text", () => {
    expect(containsDateLiteral("Le véhicule est tombé en panne sur l'autoroute.")).toBe(false);
    expect(containsDateLiteral("")).toBe(false);
  });

  it("is not fooled by identifiers that merely contain digits", () => {
    // The real failure this protects: a reservation number or a plate must not
    // read as a date and license an invented range.
    expect(containsDateLiteral("location 4412, plaque 12345-A-7")).toBe(false);
    expect(containsDateLiteral("montant de 450 MAD prélevé")).toBe(false);
  });
});
