import { describe, expect, it } from "vitest";
import { etatBadgeClass, ETAT_OPTIONS_FALLBACK } from "@/lib/types";

describe("etatBadgeClass — shared ETAT color mapping (M4)", () => {
  it("every real ETAT_OPTIONS_FALLBACK value returns a non-empty class string", () => {
    for (const etat of ETAT_OPTIONS_FALLBACK) {
      expect(etatBadgeClass(etat)).toMatch(/\S/);
    }
  });

  it("ANNULE and ANNULEE get the same treatment — the exact gap ds-history's old etatStyle() had (only ANNULEE was covered)", () => {
    expect(etatBadgeClass("ANNULE")).toBe(etatBadgeClass("ANNULEE"));
  });

  it("DISPONIBLE/INTERNE/EXTERNE each get a visually distinct class", () => {
    const classes = new Set([
      etatBadgeClass("DISPONIBLE"),
      etatBadgeClass("INTERNE"),
      etatBadgeClass("EXTERNE"),
    ]);
    expect(classes.size).toBe(3);
  });

  it("is case-insensitive, matching how both pages call it with a live sheet value", () => {
    expect(etatBadgeClass("externe")).toBe(etatBadgeClass("EXTERNE"));
  });

  it("an unknown/empty value falls back to the muted token, not a literal zinc shade", () => {
    expect(etatBadgeClass("")).toContain("bg-muted");
    expect(etatBadgeClass("SOMETHING_UNEXPECTED")).toContain("bg-muted");
  });
});
