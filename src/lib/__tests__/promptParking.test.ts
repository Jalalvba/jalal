import { describe, expect, it } from "vitest";
import { DS_ANALYSIS_SYSTEM_PROMPT, DS_GROUNDING_RULES } from "@/lib/ai/dsAnalysis/prompt";
import { DS_PARKING_WORKORDER_PROMPT } from "@/lib/ai/dsAnalysis/prompt-parking";

describe("the two prompts are separate documents on one set of rules", () => {
  it("both carry every grounding rule, verbatim", () => {
    // The rules are what keep the model honest. A work order built on a
    // hallucinated date is worse than a report built on one — somebody books
    // the work — so these must never drift apart.
    for (const rule of DS_GROUNDING_RULES) {
      expect(DS_ANALYSIS_SYSTEM_PROMPT).toContain(rule);
      expect(DS_PARKING_WORKORDER_PROMPT).toContain(rule);
    }
  });

  it("only Parking's asks for actions", () => {
    expect(DS_PARKING_WORKORDER_PROMPT).toContain("ORDRE DE TRAVAIL");
    expect(DS_PARKING_WORKORDER_PROMPT).toContain("- actions:");
    // DS History's card renders findings and a summary; asking it for a work
    // order too would spend tokens on output nothing displays.
    expect(DS_ANALYSIS_SYSTEM_PROMPT).not.toContain("ORDRE DE TRAVAIL");
    expect(DS_ANALYSIS_SYSTEM_PROMPT).not.toContain("- actions:");
  });

  it("both still demand the same JSON field names", () => {
    for (const field of ["contractFlag", "findings", "summary", "insufficientData"]) {
      expect(DS_ANALYSIS_SYSTEM_PROMPT).toContain(field);
      expect(DS_PARKING_WORKORDER_PROMPT).toContain(field);
    }
  });

  it("makes the vehicle's status outrank its history", () => {
    const p = DS_PARKING_WORKORDER_PROMPT;
    // Live vocabulary, not invented: PARKING's ETAT VÉHICULE holds LLD (62),
    // ATV (8), Remplacement (6), En stock (4), LCD (3); cp.statut holds
    // "Livré" (5 673), "Arret facturation" (4 546), "Restitué" (11).
    expect(p).toContain("Arret facturation");
    expect(p).toContain("Restitué");
    // Verbatim strings: the prompt tells the model to copy them word for word,
    // so a change here is a change to what lands in the sheet.
    // The zone names are the sheet's ZONING values verbatim, misspelling
    // included ("depot-rempalcmemnt"): the action has to name the zone as it
    // exists, not as it should be spelled, or it points at a bucket the column
    // does not have.
    expect(p).toContain("À envoyer vers depot-ATV");
    expect(p).toContain("À envoyer vers depot-rempalcmemnt");
    expect(p).toContain("À envoyer au garage Pierre Parent");
    // A0 has to be read before the rules that would otherwise fill the list.
    expect(p.indexOf("LE STATUT DÉCIDE")).toBeLessThan(p.indexOf("A1. Chaque action"));
  });

  it("forbids the justification the analysis column already carries", () => {
    const p = DS_PARKING_WORKORDER_PROMPT;
    expect(p).toContain("RIEN D'AUTRE");
    expect(p).toContain("Pas de justification");
    // The example pair is the instruction: show the bare consigne, show the
    // rejected form next to it.
    expect(p).toContain('Écris : « Remplacer le filtre à gasoil »');
    expect(p).toContain("PAS   : « Remplacer le filtre à gasoil (jamais enregistré, 144 878 km) »");
  });

  it("sends an AVIS vehicle to Pierre Parent after a part change", () => {
    const p = DS_PARKING_WORKORDER_PROMPT;
    expect(p).toContain("VÉHICULE DU PARC AVIS");
    expect(p).toContain("À envoyer au garage Pierre Parent");
    // Once, never twice — the LCD rule writes the same line.
    expect(p).toContain("jamais en double");
  });

  it("keeps the imposed order of a work order", () => {
    const p = DS_PARKING_WORKORDER_PROMPT;
    // The complaint the vehicle came in with must be the first line the
    // advisor reads, before any periodic maintenance.
    expect(p.indexOf("LA PLAINTE EN COURS")).toBeLessThan(p.indexOf("Les entretiens DÉPASSÉS"));
    expect(p.indexOf("Les entretiens DÉPASSÉS")).toBeLessThan(p.indexOf("Les organes qui reviennent"));
  });
});

describe("the zone actions name real ZONING values", () => {
  it("uses only values from the configured option list", async () => {
    const { ZONING_OPTIONS_FALLBACK } = await import("@/types");
    const { DS_PARKING_WORKORDER_PROMPT: p } = await import("@/lib/ai/dsAnalysis/prompt-parking");
    // Every zone the prompt tells the model to write must be a value the
    // ZONING column (and its filter chips) actually recognises — otherwise the
    // work order sends a vehicle to a zone that does not exist.
    for (const zone of ["depot-ATV", "depot-rempalcmemnt"]) {
      expect(ZONING_OPTIONS_FALLBACK).toContain(zone);
      expect(p).toContain(zone);
    }
  });
});
