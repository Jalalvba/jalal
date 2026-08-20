import { describe, expect, it } from "vitest";
import { mergeVehicleIdentity, PARC_ONLY_LABELS } from "@/lib/vehicle/identity";
import type { CpItem, ParcItem } from "@/types";

// Shapes taken from real API responses observed in the browser.
const PARC: ParcItem = {
  imm: "44329-B-7", ww: "051583WW", vin: "6FPPXXMJ2PNT05941",
  brand: "FORD", model: "Ranger", vehicle_state: "En parc",
  location_type: "LLD", tenant: "GE VERNOVA", mce_date: "2023-01-10T00:00:00.000Z",
  client: "GE VERNOVA INTERNATIONAL LLC - MOROCCO BRANCH",
};
// 11734-T-1: the real plate that triggered this — cp has it, parc does not.
const CP: CpItem = {
  gestionnaire: "Aouad Mohammed Jaouad", ww: "358227WW", imm: "11734-T-1",
  vin: "WAUZZZF49RN006632", marque: "AUDI", model: "A4",
  version: "AUDI A4 Premium 2,0L Tdi 163 S-Tronic Automatique Diesel",
  type_location: "Véhicule neuf", mce_date: "2024-04-25T00:00:00.000Z",
  date_debut_contrat: "2024-04-29T00:00:00.000Z",
  date_fin_contrat: "2028-04-29T00:00:00.000Z", jockey: "Inclu",
};

describe("mergeVehicleIdentity — the empty-parc path", () => {
  it("still produces an identity when ONLY cp has the vehicle", () => {
    // The regression this whole change exists for: 3,202 plates hit this.
    const id = mergeVehicleIdentity(null, [CP]);
    expect(id).not.toBeNull();
    expect(id!.source).toBe("cp");
  });

  it("carries every field cp can actually supply", () => {
    const id = mergeVehicleIdentity(null, [CP])!;
    expect(id.imm).toBe("11734-T-1");
    expect(id.ww).toBe("358227WW");
    expect(id.vin).toBe("WAUZZZF49RN006632");
    expect(id.brand).toBe("AUDI");
    expect(id.model).toBe("A4");
    expect(id.location_type).toBe("Véhicule neuf");
    expect(id.mce_date).toBe("2024-04-25T00:00:00.000Z");
  });

  it("leaves the three parc-only fields undefined and NAMES them", () => {
    const id = mergeVehicleIdentity(null, [CP])!;
    expect(id.client).toBeUndefined();
    expect(id.vehicle_state).toBeUndefined();
    expect(id.tenant).toBeUndefined();
    expect(id.unavailable).toEqual(PARC_ONLY_LABELS);
  });

  it("labels the card honestly instead of claiming parc data", () => {
    const id = mergeVehicleIdentity(null, [CP])!;
    expect(id.sourceLabel).toBe("cp (aucune fiche parc)");
    expect(id.sourceLabel).not.toContain("parc +");
  });

  it("returns null only when NEITHER source has anything — the one hidden case", () => {
    expect(mergeVehicleIdentity(null, [])).toBeNull();
    expect(mergeVehicleIdentity(null, null)).toBeNull();
    expect(mergeVehicleIdentity(undefined, undefined)).toBeNull();
  });
});

describe("mergeVehicleIdentity — unchanged behaviour when parc exists", () => {
  it("keeps parc's values and the parc + cp stamp", () => {
    const id = mergeVehicleIdentity(PARC, [CP])!;
    expect(id.source).toBe("parc+cp");
    expect(id.sourceLabel).toBe("parc + cp");
    expect(id.client).toBe("GE VERNOVA INTERNATIONAL LLC - MOROCCO BRANCH");
    expect(id.vehicle_state).toBe("En parc");
    expect(id.tenant).toBe("GE VERNOVA");
    expect(id.unavailable).toEqual([]);
  });

  it("prefers parc field by field — cp never overwrites the master record", () => {
    const id = mergeVehicleIdentity(PARC, [CP])!;
    expect(id.brand).toBe("FORD");   // not AUDI
    expect(id.model).toBe("Ranger"); // not A4
    expect(id.vin).toBe("6FPPXXMJ2PNT05941");
    expect(id.imm).toBe("44329-B-7");
  });

  it("falls back to cp per FIELD when parc has a gap", () => {
    const sparse: ParcItem = { imm: "44329-B-7" };
    const id = mergeVehicleIdentity(sparse, [CP])!;
    expect(id.brand).toBe("AUDI");           // filled from cp
    expect(id.vin).toBe("WAUZZZF49RN006632");
    expect(id.imm).toBe("44329-B-7");        // parc still wins where present
    // Still a parc-backed identity, so nothing is reported unavailable.
    expect(id.unavailable).toEqual([]);
  });

  it("says parc alone when there is no contract", () => {
    const id = mergeVehicleIdentity(PARC, [])!;
    expect(id.source).toBe("parc");
    expect(id.sourceLabel).toBe("parc");
  });

  it("treats whitespace-only values as absent rather than as data", () => {
    const id = mergeVehicleIdentity({ imm: "  ", brand: "" }, [CP])!;
    expect(id.imm).toBe("11734-T-1"); // fell through to cp
    expect(id.brand).toBe("AUDI");
  });

  it("uses the FIRST contract, matching what the card displays", () => {
    const second: CpItem = { ...CP, imm: "OTHER", marque: "RENAULT" };
    const id = mergeVehicleIdentity(null, [CP, second])!;
    expect(id.brand).toBe("AUDI");
  });
});
