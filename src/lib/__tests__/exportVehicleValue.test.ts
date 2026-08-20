import { describe, expect, it } from "vitest";
import { getVehicleValue, vehicleSectionHeading } from "@/app/api/export/route";
import { mergeVehicleIdentity, identityFromImmOnly } from "@/lib/vehicle/identity";
import type { CpItem, ParcItem } from "@/types";

const CP: CpItem = { imm: "11734-T-1", ww: "358227WW", vin: "VF1TESTVIN0000001", marque: "AUDI", model: "A4" };
const PARC: ParcItem = { imm: "44329-B-7", brand: "FORD", model: "Ranger", client: "GE VERNOVA", vehicle_state: "En parc" };

describe("getVehicleValue — export mirrors the card's missing-source wording", () => {
  it("renders parc-only fields as 'non disponible' on a cp-only identity", () => {
    const id = mergeVehicleIdentity(null, [CP])!;
    for (const key of ["client", "vehicle_state", "tenant"]) {
      expect(getVehicleValue(id, key), key).toBe("non disponible");
    }
  });

  it("still renders the fields cp CAN supply", () => {
    const id = mergeVehicleIdentity(null, [CP])!;
    expect(getVehicleValue(id, "brand")).toBe("AUDI");
    expect(getVehicleValue(id, "model")).toBe("A4");
    expect(getVehicleValue(id, "vin")).toBe("VF1TESTVIN0000001");
  });

  it("keeps '—' for a field simply blank in a parc record that exists", () => {
    const id = mergeVehicleIdentity(PARC, [])!;
    expect(getVehicleValue(id, "tenant")).toBe("—");   // blank, not missing-source
    expect(getVehicleValue(id, "client")).toBe("GE VERNOVA");
  });

  it("keeps '—' everywhere when neither collection knows the plate", () => {
    const id = identityFromImmOnly("99999-A-1");
    expect(getVehicleValue(id, "client")).toBe("—");
    expect(getVehicleValue(id, "brand")).toBe("—");
    expect(getVehicleValue(id, "imm")).toBe("99999-A-1");
  });

  it("still handles a null vehicle, as before", () => {
    expect(getVehicleValue(null, "client")).toBe("—");
    expect(getVehicleValue(undefined, "brand")).toBe("—");
  });
});

describe("vehicleSectionHeading — names the real source, like the card", () => {
  it("says cp when the identity came from cp alone", () => {
    const id = mergeVehicleIdentity(null, [CP])!;
    expect(vehicleSectionHeading(id)).toBe("Véhicule — Données fixes (cp (aucune fiche parc))");
  });

  it("says parc + cp when both back it", () => {
    const id = mergeVehicleIdentity(PARC, [CP])!;
    expect(vehicleSectionHeading(id)).toBe("Véhicule — Données fixes (parc + cp)");
  });

  it("falls back to the original heading when there is no identity at all", () => {
    expect(vehicleSectionHeading(null)).toBe("Véhicule — Données fixes (parc)");
    expect(vehicleSectionHeading(identityFromImmOnly("9-A-1"))).toBe("Véhicule — Données fixes (parc)");
  });
});
