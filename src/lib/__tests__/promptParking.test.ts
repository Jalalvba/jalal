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
    expect(DS_PARKING_WORKORDER_PROMPT).toContain("FICHE DE CONTRÔLE");
    // Who reads the column decides how it is written.
    expect(DS_PARKING_WORKORDER_PROMPT).toContain("LE LECTEUR EST LE CONTRÔLEUR QUALITÉ");
    expect(DS_PARKING_WORKORDER_PROMPT).toContain("- actions:");
    // DS History's card renders findings and a summary; asking it for a work
    // order too would spend tokens on output nothing displays.
    expect(DS_ANALYSIS_SYSTEM_PROMPT).not.toContain("FICHE DE CONTRÔLE");
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
    expect(p).toContain("DEPOT-ATV");
    expect(p).toContain("DEPOT-REMPLACEMENT");
    expect(p).toContain("AVIS-PIERRE-PARENT");
    // A0 has to be read before the rules that would otherwise fill the list.
    expect(p.indexOf("LE STATUT DÉCIDE")).toBeLessThan(p.indexOf("A1. Chaque action"));
  });

  it("forbids the justification the analysis column already carries", () => {
    const p = DS_PARKING_WORKORDER_PROMPT;
    expect(p).toContain("RIEN D'AUTRE");
    expect(p).toContain("Pas de justification");
    // The example pair is the instruction: show the bare consigne, show the
    // rejected form next to it.
    expect(p).toContain("Écris : « Contrôler le remplacement du filtre à gasoil »");
    expect(p).toContain("PAS   : « Remplacer le filtre à gasoil (jamais enregistré, 144 878 km) »");
  });

  it("sends an AVIS vehicle to Pierre Parent after a part change", () => {
    const p = DS_PARKING_WORKORDER_PROMPT;
    // This rule used to be its own "A6. VÉHICULE DU PARC AVIS" section. The
    // A0.5 restructure folded it into criterion 4 of the destination ladder;
    // the assertions follow it there rather than being dropped, because the
    // behaviour they pin is unchanged.
    expect(p).toContain("Propriétaire = « AVIS » ou « Scal Avis »");
    expect(p).toContain("remplacement ou le changement d'une");
    expect(p).toContain("AVIS-PIERRE-PARENT");
    // Once, never twice — criterion 3 (LCD) writes the same zone.
    expect(p).toContain("si le cas 3 a déjà ajouté cette ligne");
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
    const { PARKING_ZONE_VALUES } = await import("@/lib/ai/dsAnalysis/prompt-parking");
    // Asserted against the shared constant rather than hardcoded literals. The
    // previous version pinned "depot-ATV"/"depot-rempalcmemnt" by hand and went
    // stale the moment the real dropdown was replaced (2026-08-29) — which is
    // the same hand-copied-literal drift this file exists to catch.
    expect([...PARKING_ZONE_VALUES]).toEqual(ZONING_OPTIONS_FALLBACK);
    // Every zone the model may be told to write must be a value the ZONING
    // column actually recognises, and must appear in the prompt text.
    for (const zone of PARKING_ZONE_VALUES) {
      expect(ZONING_OPTIONS_FALLBACK).toContain(zone);
      expect(p).toContain(zone);
    }
  });
});

describe("prompt fingerprinting — a rule change must invalidate stored answers", () => {
  it("changes when the prompt changes, and is stable when it does not", async () => {
    const { promptFingerprint } = await import("@/lib/ai/dsAnalysis/stored");
    const { DS_PARKING_WORKORDER_PROMPT: p } = await import("@/lib/ai/dsAnalysis/prompt-parking");
    expect(promptFingerprint(p)).toBe(promptFingerprint(p));
    expect(promptFingerprint(p)).not.toBe(promptFingerprint(p + " "));
  });

  it("distinguishes the two prompt documents", async () => {
    const { promptFingerprint } = await import("@/lib/ai/dsAnalysis/stored");
    const { DS_PARKING_WORKORDER_PROMPT } = await import("@/lib/ai/dsAnalysis/prompt-parking");
    const { DS_ANALYSIS_SYSTEM_PROMPT } = await import("@/lib/ai/dsAnalysis/prompt");
    // Otherwise an analysis written by one would be reused for the other.
    expect(promptFingerprint(DS_PARKING_WORKORDER_PROMPT)).not.toBe(
      promptFingerprint(DS_ANALYSIS_SYSTEM_PROMPT)
    );
  });
});

describe("the ACTION column is written for the quality controller", () => {
  it("asks for controls, not repairs", async () => {
    const { DS_PARKING_WORKORDER_PROMPT: p } = await import("@/lib/ai/dsAnalysis/prompt-parking");
    // He does not repair and orders no parts: "Remplacer le filtre à gasoil"
    // asks him to do somebody else's job.
    expect(p).toContain("POINT DE CONTRÔLE");
    expect(p).toContain("Jamais « Remplacer »");
    expect(p).toContain("n'est pas l'atelier");
  });

  it("always ends on the destination he will order", async () => {
    const { DS_PARKING_WORKORDER_PROMPT: p } = await import("@/lib/ai/dsAnalysis/prompt-parking");
    expect(p).toContain("LA DESTINATION — TOUJOURS, et toujours en dernier");
    // The bare zone value, not the old French sentence "À livrer au client":
    // the destination line is parsed back out and exact-matched against the
    // dropdown, so it has to BE a zone value.
    expect(p).toContain("DISPONIBLE-A-LIVRER");
    // Conditional when there is something to check first, bare when there is not.
    expect(p).toContain("Si conforme :");
  });
});
