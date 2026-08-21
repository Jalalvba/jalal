import { describe, expect, it } from "vitest";
import {
  mergeVehicleIdentity, identityFromImmOnly,
  PARC_ONLY_LABELS, PARC_ONLY_KEYS, PARC_ONLY_FIELDS,
} from "@/lib/vehicle/identity";
import type { CpItem, ParcItem } from "@/types";

// Shapes taken from real API responses observed in the browser; the VIN and
// the gestionnaire name are replaced with synthetic equivalents of the same
// shape — the field layout is what these fixtures pin, not the values, and an
// identifiable employee name does not belong in git history. The plates are
// kept real so a failure here can be re-checked against live data directly.
const PARC: ParcItem = {
  imm: "44329-B-7", ww: "051583WW", vin: "VF1TESTVIN0000002",
  brand: "FORD", model: "Ranger", vehicle_state: "En parc",
  location_type: "LLD", tenant: "GE VERNOVA", mce_date: "2023-01-10T00:00:00.000Z",
  client: "GE VERNOVA INTERNATIONAL LLC - MOROCCO BRANCH",
};
// 11734-T-1: the real plate that triggered this — cp has it, parc does not.
const CP: CpItem = {
  gestionnaire: "Gestionnaire Test", ww: "358227WW", imm: "11734-T-1",
  vin: "VF1TESTVIN0000001", marque: "AUDI", model: "A4",
  version: "AUDI A4 Premium 2,0L Tdi 163 S-Tronic Automatique Diesel",
  client: "Saint Gobain Maroc",
  statut: "Arret facturation",
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
    expect(id.vin).toBe("VF1TESTVIN0000001");
    expect(id.brand).toBe("AUDI");
    expect(id.model).toBe("A4");
    expect(id.location_type).toBe("Véhicule neuf");
    expect(id.mce_date).toBe("2024-04-25T00:00:00.000Z");
  });

  it("leaves the parc-only fields undefined and NAMES them", () => {
    const id = mergeVehicleIdentity(null, [CP])!;
    expect(id.vehicle_state).toBeUndefined();
    expect(id.tenant).toBeUndefined();
    expect(id.unavailable).toEqual(PARC_ONLY_LABELS);
  });

  it("no longer treats client as parc-only — cp always carries it", () => {
    // Was unavailable until ~/import 8ecafd5 added client to cp. All 10,230
    // cp documents have one, 0 blanks.
    expect(PARC_ONLY_LABELS).not.toContain("Client");
    expect(mergeVehicleIdentity(null, [CP])!.client).toBe("Saint Gobain Maroc");
  });

  it("surfaces statut, which explains a legitimately absent parc row", () => {
    // 11734-T-1's real value: billing stopped, so it correctly left the parc.
    expect(mergeVehicleIdentity(null, [CP])!.statut).toBe("Arret facturation");
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
    // client is NOT asserted here — it now comes from cp (see the
    // client-precedence block below), which is the one deliberate inversion.
    expect(id.vehicle_state).toBe("En parc");
    expect(id.tenant).toBe("GE VERNOVA");
    expect(id.unavailable).toEqual([]);
  });

  it("prefers parc field by field — cp never overwrites the master record", () => {
    const id = mergeVehicleIdentity(PARC, [CP])!;
    expect(id.brand).toBe("FORD");   // not AUDI
    expect(id.model).toBe("Ranger"); // not A4
    expect(id.vin).toBe("VF1TESTVIN0000002");
    expect(id.imm).toBe("44329-B-7");
  });

  it("falls back to cp per FIELD when parc has a gap", () => {
    const sparse: ParcItem = { imm: "44329-B-7" };
    const id = mergeVehicleIdentity(sparse, [CP])!;
    expect(id.brand).toBe("AUDI");           // filled from cp
    expect(id.vin).toBe("VF1TESTVIN0000001");
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


// ── Keys and labels must describe the SAME fields ─────────────────────────
//
// The card renders by label, the exports resolve by ParcItem key. If these two
// projections ever drift, one surface says a field is unavailable while the
// other renders "—" for it, and nothing fails loudly.
describe("PARC_ONLY_FIELDS — one definition, two projections", () => {
  it("derives labels and keys from the same list, in the same order", () => {
    expect(PARC_ONLY_LABELS).toEqual(PARC_ONLY_FIELDS.map((f) => f.label));
    expect(PARC_ONLY_KEYS).toEqual(PARC_ONLY_FIELDS.map((f) => f.key));
    expect(PARC_ONLY_LABELS).toHaveLength(PARC_ONLY_KEYS.length);
  });

  it("names exactly the fields that are undefined on a cp-only identity", () => {
    const id = mergeVehicleIdentity(null, [CP])!;
    for (const key of PARC_ONLY_KEYS) {
      expect(id[key as "client" | "vehicle_state" | "tenant"]).toBeUndefined();
    }
    expect(id.unavailableKeys).toEqual(PARC_ONLY_KEYS);
  });

  it("reports nothing unavailable when parc backs the identity", () => {
    expect(mergeVehicleIdentity(PARC, [CP])!.unavailableKeys).toEqual([]);
    expect(mergeVehicleIdentity(PARC, [])!.unavailableKeys).toEqual([]);
  });
});

describe("identityFromImmOnly — the export fallback", () => {
  it("carries the plate and claims nothing else", () => {
    const id = identityFromImmOnly("99999-A-1");
    expect(id.imm).toBe("99999-A-1");
    expect(id.brand).toBeUndefined();
    expect(id.client).toBeUndefined();
  });

  it("reports NOTHING as unavailable — no record at all is not a missing source", () => {
    // Every field renders "—" as it did before this change, rather than
    // claiming three specific fields were lost to a missing parc record.
    const id = identityFromImmOnly("99999-A-1");
    expect(id.unavailableKeys).toEqual([]);
    expect(id.unavailable).toEqual([]);
  });
});

// ── What the exports and the AI payload actually read off the identity ────
describe("identity supplies what the export and AI payload consume", () => {
  it("exposes every ParcItem key the export resolves, for a cp-only vehicle", () => {
    // PARC_MANDATORY + PARC_EXTRA in ds-history/page.tsx.
    const id = mergeVehicleIdentity(null, [CP])! as unknown as Record<string, unknown>;
    for (const key of ["imm", "ww", "vin", "brand", "model", "mce_date", "location_type"]) {
      expect(id[key], key).toBeTruthy();
    }
  });

  it("gives the AI payload a real brand and model where parc had none", () => {
    // Before this change the payload sent {brand: undefined, model: undefined}
    // for all 3,202 cp-only plates, so the prompt had no vehicle context.
    const id = mergeVehicleIdentity(null, [CP])!;
    const payload = { brand: id.brand, model: id.model, state: id.vehicle_state };
    expect(payload).toEqual({ brand: "AUDI", model: "A4", state: undefined });
  });

  it("leaves state undefined rather than inventing one — prompt omits the line", () => {
    expect(mergeVehicleIdentity(null, [CP])!.vehicle_state).toBeUndefined();
  });
});


// ── Client precedence is inverted, on purpose ─────────────────────────────
describe("client — cp wins, parc is the fallback", () => {
  it("prefers the cp client even when parc has one", () => {
    // The ONLY field where cp outranks parc: cp is the live rental contract,
    // so it names who is renting the vehicle now.
    const id = mergeVehicleIdentity(PARC, [CP])!;
    expect(id.client).toBe("Saint Gobain Maroc");
    expect(id.client).not.toBe(PARC.client);
  });

  it("falls back to parc when cp has no client", () => {
    const id = mergeVehicleIdentity(PARC, [{ ...CP, client: undefined }])!;
    expect(id.client).toBe("GE VERNOVA INTERNATIONAL LLC - MOROCCO BRANCH");
  });

  it("falls back to parc when a cp client is blank, not just missing", () => {
    const id = mergeVehicleIdentity(PARC, [{ ...CP, client: "   " }])!;
    expect(id.client).toBe("GE VERNOVA INTERNATIONAL LLC - MOROCCO BRANCH");
  });

  it("keeps every OTHER field on parc-wins — the inversion is client only", () => {
    const id = mergeVehicleIdentity(PARC, [CP])!;
    expect(id.brand).toBe("FORD");        // not AUDI
    expect(id.model).toBe("Ranger");      // not A4
    expect(id.vin).toBe(PARC.vin);
  });

  it("carries statut through the parc-backed path too", () => {
    expect(mergeVehicleIdentity(PARC, [CP])!.statut).toBe("Arret facturation");
  });

  it("has no statut when there is no contract", () => {
    expect(mergeVehicleIdentity(PARC, [])!.statut).toBeUndefined();
  });
});
