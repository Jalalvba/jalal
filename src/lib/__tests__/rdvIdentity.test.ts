import { describe, expect, it } from "vitest";
import { resolveUniqueMatch, RdvIdentityError } from "@/lib/sheets/rdvIdentity";
import type { RdvAddInput } from "@/types";

// Row layout matches lib/rdvIdentity.ts's COL_INDEX: [date, heure, clients,
// vehicule, matricule, intervention, contact, convoyeur]. Index 0 (date) is
// never compared by resolveUniqueMatch — the caller already scoped
// candidateRows to the right day before calling it — so its value here is
// arbitrary.
function row(overrides: Partial<Record<"heure" | "clients" | "vehicule" | "matricule" | "intervention" | "contact" | "convoyeur", string>> = {}): unknown[] {
  const base = {
    heure: "10:00",
    clients: "Client A",
    vehicule: "Clio",
    matricule: "12345-B-6",
    intervention: "Convoyage",
    contact: "0600000000",
    convoyeur: "Ahmed",
    ...overrides,
  };
  return [45000, base.heure, base.clients, base.vehicule, base.matricule, base.intervention, base.contact, base.convoyeur];
}

const snapshot: RdvAddInput = {
  date: "2026-07-30",
  heure: "10:00",
  clients: "Client A",
  vehicule: "Clio",
  matricule: "12345-B-6",
  intervention: "Convoyage",
  contact: "0600000000",
  convoyeur: "Ahmed",
};

describe("resolveUniqueMatch", () => {
  it("returns the row number on an exact single match", () => {
    const candidateRows = [row({ matricule: "OTHER-1" }), row(), row({ matricule: "OTHER-2" })];
    const rowNumbers = [10, 11, 12];

    const result = resolveUniqueMatch(candidateRows, rowNumbers, snapshot, undefined, "RDV");

    expect(result).toBe(11);
  });

  it("returns null — does not throw — when there are zero candidates matching", () => {
    const candidateRows = [row({ matricule: "OTHER-1" }), row({ matricule: "OTHER-2" })];
    const rowNumbers = [10, 11];

    const result = resolveUniqueMatch(candidateRows, rowNumbers, snapshot, undefined, "RDV");

    expect(result).toBeNull();
  });

  it("returns null on an empty candidate list (nothing scoped to this day at all)", () => {
    const result = resolveUniqueMatch([], [], snapshot, undefined, "RDV");

    expect(result).toBeNull();
  });

  it("throws RdvIdentityError with kind 'ambiguous' — never guesses — when two rows both match", () => {
    const candidateRows = [row(), row()];
    const rowNumbers = [10, 11];

    expect(() => resolveUniqueMatch(candidateRows, rowNumbers, snapshot, undefined, "RDV")).toThrow(
      RdvIdentityError
    );

    try {
      resolveUniqueMatch(candidateRows, rowNumbers, snapshot, undefined, "RDV");
      throw new Error("expected resolveUniqueMatch to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(RdvIdentityError);
      expect((e as RdvIdentityError).kind).toBe("ambiguous");
    }
  });

  it("ignores excludeField when comparing identity (the field being written can't gate its own match)", () => {
    // Real row has a different `convoyeur` than the snapshot, but convoyeur
    // is the field being updated, so it must still match by excluding it.
    const candidateRows = [row({ convoyeur: "Karim" })];
    const rowNumbers = [10];

    const result = resolveUniqueMatch(candidateRows, rowNumbers, snapshot, "convoyeur", "RDV");

    expect(result).toBe(10);
  });

  it("normalizes matricule case and whitespace, and other fields' whitespace, before comparing", () => {
    const candidateRows = [
      row({ matricule: " 12345-b-6 ", clients: "Client   A" }),
    ];
    const rowNumbers = [10];

    const result = resolveUniqueMatch(candidateRows, rowNumbers, snapshot, undefined, "RDV");

    expect(result).toBe(10);
  });
});
