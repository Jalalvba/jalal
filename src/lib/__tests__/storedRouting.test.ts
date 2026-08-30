import { describe, it, expect } from "vitest";

import { isStale, routingChanged } from "@/lib/ai/dsAnalysis/stored";

// Regression cover for the A0.0 reuse bug, measured on 31195-B-7 (2026-08-30).
//
// The analysis WRITES the ZONING cell (applyZone in /api/parking/actions), so a
// vehicle first analysed with an empty ZONING got a full work order, that work
// order's destination was written back into ZONING, and every later run then saw
// entriesCount/lastEntryDate unmoved and reused the pre-ZONING answer forever —
// so prompt rule A0.0 never got a second chance to fire and the row could not
// self-correct. The routing facts are part of the reuse key for that reason.
const base = { entriesCount: 20, lastEntryDate: "2026-02-02" };

describe("routingChanged", () => {
  it("treats absent, empty and whitespace as the same fact", () => {
    expect(routingChanged(undefined, undefined)).toBe(false);
    expect(routingChanged({}, { zoning: "" })).toBe(false);
    expect(routingChanged({ zoning: "  " }, undefined)).toBe(false);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(routingChanged({ zoning: "depot-atv" }, { zoning: " DEPOT-ATV " })).toBe(false);
  });

  it("reports a change on any of the three facts", () => {
    expect(routingChanged({ zoning: "DEPOT-ATV" }, { zoning: "ATELIER" })).toBe(true);
    expect(routingChanged({ etat: "ATV" }, { etat: "LLD" })).toBe(true);
    expect(routingChanged({ cpStatus: "Livré" }, { cpStatus: "Restitué" })).toBe(true);
  });
});

describe("isStale — routing facts", () => {
  it("is stale once a ZONING appears on an answer produced without one", () => {
    // Exactly 31195-B-7's state: the stored answer predates the zone its own
    // destination line caused to be written.
    expect(
      isStale({ ...base, routing: undefined }, { ...base, routing: { zoning: "DEPOT-ATV", etat: "ATV" } })
    ).toBe(true);
  });

  it("is not stale when the facts are unchanged", () => {
    const routing = { zoning: "DEPOT-ATV", etat: "ATV", cpStatus: "Arret facturation" };
    expect(isStale({ ...base, routing }, { ...base, routing })).toBe(false);
  });

  it("does not invalidate an older answer for a vehicle that still has no routing facts", () => {
    // The manualKm precedent: a field appearing must not mass-invalidate rows
    // it was never stored on.
    expect(isStale({ ...base, routing: undefined }, { ...base, routing: {} })).toBe(false);
  });

  it("is stale when ETAT changes even though the history has not moved", () => {
    expect(
      isStale({ ...base, routing: { etat: "LLD" } }, { ...base, routing: { etat: "ATV" } })
    ).toBe(true);
  });
});
