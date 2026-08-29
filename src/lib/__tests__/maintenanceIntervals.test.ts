import { describe, expect, it } from "vitest";
import {
  usableKmEntries,
  longestCleanRun,
  checkBeltPump,
  formatBeltPumpCheck,
  checkInterval,
  currentKmOf,
  computeIntervalChecks,
  formatIntervalChecks,
  formatRulesReference,
  resolveVehicleKm,
  formatKmSourceLine,
  INTERVALS,
  type IntervalEntry,
} from "@/lib/ai/prompts/maintenanceIntervals";

const e = (date: string, km: number | undefined, ...parts: string[]): IntervalEntry => ({ date, km, parts });

describe("currentKmOf — highest reading, not latest", () => {
  it("takes the maximum, so one mistyped low reading at the end cannot shrink it", () => {
    expect(currentKmOf([e("2025-01-01", 100_000), e("2025-06-01", 120_000), e("2025-09-01", 12_000)])).toBe(120_000);
  });
  it("coerces string km — 26,573 production rows store it as a string", () => {
    expect(currentKmOf([{ date: "x", km: "95 000" as unknown as number, parts: [] }])).toBe(95_000);
  });
  it("ignores 0, negatives and absurd values", () => {
    expect(currentKmOf([e("a", 0), e("b", -5), e("c", 2_000_000), e("d", 50_000)])).toBe(50_000);
  });
  it("returns null when nothing is usable", () => {
    expect(currentKmOf([e("a", 0), e("b", undefined)])).toBeNull();
  });
});

describe("checkInterval — rules 1, 3, 4", () => {
  it("flags an oil change past 10,000 km, with the overdue amount", () => {
    const r = checkInterval("vidange", [
      e("2025-01-01", 100_000, "VIDANGE 1:HUILE+FILTRE H+MO"),
      e("2025-09-01", 118_500, "PLAQUETTE FREIN"),
    ]);
    expect(r.status).toBe("overdue");
    expect(r.kmSince).toBe(18_500);
    expect(r.overdueByKm).toBe(8_500);
    expect(r.lastKm).toBe(100_000);
  });

  it("reports ok inside the interval", () => {
    const r = checkInterval("vidange", [
      e("2025-01-01", 100_000, "VIDANGE 1:HUILE+FILTRE H+MO"),
      e("2025-06-01", 106_000, "PNEU"),
    ]);
    expect(r.status).toBe("ok");
    expect(r.kmSince).toBe(6_000);
    expect(r.overdueByKm).toBeUndefined();
  });

  it("distinguishes 'never recorded' from 'overdue'", () => {
    const r = checkInterval("filtre_gasoil", [e("2025-01-01", 90_000, "PNEU")]);
    expect(r.status).toBe("never");
    expect(r.currentKm).toBe(90_000);
    expect(r.note).toMatch(/Aucune intervention/);
  });

  it("returns unknown — not a number — when the odometer runs backwards", () => {
    // 44.8% of sampled vehicles carry at least one backward step; worst
    // observed -30,574 km. A naive subtraction would print confident nonsense.
    const r = checkInterval("vidange", [
      e("2025-01-01", 150_000, "VIDANGE 1:HUILE+FILTRE H+MO"),
      e("2025-06-01", 120_000, "PNEU"),
    ]);
    expect(r.status).toBe("unknown");
    expect(r.note).toMatch(/aucun segment cohérent/i);
    expect(r.kmSince).toBeUndefined();
    expect(r.overdueByKm).toBeUndefined();
  });

  it("ignores incoherence that PREDATES the last service — only the window matters", () => {
    // Scanning real high-DS vehicles, 5 of 6 contain a bad reading somewhere
    // across 50-60 entries. A whole-history guard made every check on them
    // "indéterminé" — exactly the vehicles whose histories most warrant it.
    const r = checkInterval("vidange", [
      e("2022-01-01", 200_000, "PNEU"), // bad old reading
      e("2022-06-01", 40_000, "PNEU"), // -160,000 km, long before the service
      e("2025-01-01", 100_000, "VIDANGE 1:HUILE+FILTRE H+MO"),
      e("2025-09-01", 118_500, "PNEU"),
    ]);
    expect(r.status).toBe("overdue");
    expect(r.kmSince).toBe(18_500);
  });

  it("still refuses when the odometer goes backwards AFTER the last service", () => {
    const r = checkInterval("vidange", [
      e("2025-01-01", 150_000, "VIDANGE 1:HUILE+FILTRE H+MO"),
      e("2025-06-01", 120_000, "PNEU"),
    ]);
    expect(r.status).toBe("unknown");
    expect(r.note).toMatch(/aucun segment cohérent/i);
  });

  it("returns unknown when no km reading is usable at all", () => {
    const r = checkInterval("vidange", [e("2025-01-01", 0, "VIDANGE 1:HUILE+FILTRE H+MO")]);
    expect(r.status).toBe("unknown");
    expect(r.note).toMatch(/Aucun relevé/);
  });

  it("uses the LATEST service of that type, not the first", () => {
    const r = checkInterval("vidange", [
      e("2024-01-01", 50_000, "VIDANGE 1:HUILE+FILTRE H+MO"),
      e("2025-01-01", 100_000, "VIDANGE 1:HUILE+FILTRE H+MO"),
      e("2025-06-01", 104_000, "PNEU"),
    ]);
    expect(r.lastKm).toBe(100_000);
    expect(r.status).toBe("ok");
  });

  it("credits an air filter changed inside a VIDANGE 2 package", () => {
    // The whole point of parsing the codes: this is not a "FILTRE A AIR" line.
    const r = checkInterval("filtre_air", [
      e("2025-01-01", 100_000, "VIDANGE 2:HUILE+FILTRE H/A+MO"),
      e("2025-06-01", 110_000, "PNEU"),
    ]);
    expect(r.status).toBe("ok");
    expect(r.lastKm).toBe(100_000);
  });

  it("uses the documented thresholds", () => {
    expect(INTERVALS.vidange).toBe(10_000);
    expect(INTERVALS.filtre_air).toBe(30_000);
    expect(INTERVALS.filtre_gasoil).toBe(40_000);
  });
});

describe("computeIntervalChecks / formatIntervalChecks", () => {
  it("covers exactly the three unambiguous rules", () => {
    const out = computeIntervalChecks([e("2025-01-01", 100_000, "VIDANGE 1:HUILE+FILTRE H+MO")]);
    expect(out.map((c) => c.service)).toEqual(["vidange", "filtre_gasoil", "filtre_air"]);
  });

  it("renders facts the model can only restate, never recompute", () => {
    const lines = formatIntervalChecks(
      computeIntervalChecks([
        e("2025-01-01", 100_000, "VIDANGE 1:HUILE+FILTRE H+MO"),
        e("2025-09-01", 118_500, "PNEU"),
      ])
    );
    // fr-FR groups with U+202F (narrow no-break space), not a plain space.
    expect(lines[0]).toMatch(/DÉPASSÉ de 8\s500 km/u);
    expect(lines[0]).toMatch(/2025-01-01/);
    expect(lines.join("\n")).toMatch(/JAMAIS ENREGISTRÉ/);
  });

  it("states the reason when a check is indeterminate", () => {
    const lines = formatIntervalChecks(computeIntervalChecks([e("2025-01-01", 0, "PNEU")]));
    expect(lines.every((l) => l.includes("INDÉTERMINÉ"))).toBe(true);
  });
});


describe("checkBeltPump — rule 2, mileage-only", () => {
  // Real spellings, already validated against production in serviceTypes.test.ts.
  const BELT = "CHANGEMENT KIT DE DISTRIBUTION";
  const PUMP = "POMPE A EAU";
  const OTHER = "COURROIE ALTERNATEUR"; // a real trap: NOT the timing belt

  const highKm = (...extra: IntervalEntry[]): IntervalEntry[] => [
    e("2023-01-01", 100_000, "PNEU"),
    e("2025-06-01", 150_000, "PLAQUETTE FREIN"),
    ...extra,
  ];

  it("FLAGS over 120,000 km with no belt or pump ever recorded", () => {
    const r = checkBeltPump(highKm());
    expect(r.status).toBe("never");
    expect(r.currentKm).toBe(150_000);
    expect(r.thresholdKm).toBe(120_000);
  });

  it("fires regardless of contract status — it no longer reads the contract at all", () => {
    // The signature takes no contract argument; this pins that. Arity is 2 —
    // (entries, manualKm) — since the Parking KM override was added; the point
    // of the assertion is that NEITHER parameter is a contract date, not the
    // number itself.
    expect(checkBeltPump.length).toBe(2);
    // The behavioural half, which arity alone cannot express: a vehicle over
    // the threshold with no belt service fires on mileage alone, with no
    // contract information available anywhere in the input type.
    expect(checkBeltPump(highKm()).status).toBe("never");
  });

  it("does NOT flag when a timing-belt service exists", () => {
    const r = checkBeltPump(highKm(e("2024-03-01", 130_000, BELT)));
    expect(r.status).toBe("ok");
    expect(r.lastServiceDate).toBe("2024-03-01");
    expect(r.lastServiceKm).toBe(130_000);
  });

  it("accepts a water-pump service as satisfying the check", () => {
    expect(checkBeltPump(highKm(e("2024-03-01", 130_000, PUMP))).status).toBe("ok");
  });

  it("is not satisfied by an ALTERNATOR belt — a different part entirely", () => {
    expect(checkBeltPump(highKm(e("2024-03-01", 130_000, OTHER))).status).toBe("never");
  });

  it("credits a belt changed inside a combined line", () => {
    const r = checkBeltPump(highKm(e("2024-03-01", 130_000, "KIT DISTRIB+POMPE EAU+JOINT CULASSE")));
    expect(r.status).toBe("ok");
  });

  it("is NOT APPLICABLE (silent) at or below the threshold", () => {
    const low = [e("2023-01-01", 60_000, "PNEU"), e("2025-06-01", 120_000, "PNEU")];
    const r = checkBeltPump(low);
    expect(r.status).toBe("not_applicable");
    expect(r.currentKm).toBe(120_000); // strict: exactly 120,000 does not flag
  });

  it("is SKIPPED — not flagged, not cleared — when km cannot be established", () => {
    const r = checkBeltPump([e("2025-01-01", 0, "PNEU")]);
    expect(r.status).toBe("skipped");
    expect(r.note).toMatch(/indéterminable/i);
  });

  it("ignores an inflated Visite Technique reading when deciding the threshold", () => {
    // A VT alone must not push a vehicle over 120,000.
    const r = checkBeltPump([
      { date: "2025-01-01", km: 90_000, parts: ["PNEU"] },
      { date: "2025-03-01", km: 130_000, description: "visite technique", parts: [] },
    ]);
    expect(r.status).toBe("not_applicable");
    expect(r.currentKm).toBe(90_000);
  });
});

describe("formatBeltPumpCheck", () => {
  const highKm = [e("2023-01-01", 100_000, "PNEU"), e("2025-06-01", 150_000, "PNEU")];

  it("renders NOTHING when not applicable — silence is the design", () => {
    expect(formatBeltPumpCheck(checkBeltPump([e("a", 50_000, "PNEU")]))).toEqual([]);
  });

  it("states plainly that the check could not run when km is unusable", () => {
    const [line] = formatBeltPumpCheck(checkBeltPump([e("a", 0, "PNEU")]));
    expect(line).toMatch(/NON VÉRIFIÉ/);
  });

  it("cites the km and threshold on a flag, and does not mention the contract", () => {
    const [line] = formatBeltPumpCheck(checkBeltPump(highKm));
    expect(line).toMatch(/JAMAIS ENREGISTRÉ/);
    expect(line).toMatch(/150\s000 km/u);
    expect(line).toMatch(/120\s000 km/u);
    expect(line).not.toMatch(/contrat/i);
  });
});

describe("Visite Technique exclusion — the root cause of most backward steps", () => {
  // 44329-B-7's real pattern, abridged: a VT logged 130,000 km, then the next
  // genuine entry read 118,157. That single VT was its ONLY backward step.
  const real44329: IntervalEntry[] = [
    { date: "2024-12-15", km: 106_980, description: "fh+fa", parts: ["FILTRE A HUILE", "FILTRE A AIR"] },
    { date: "2025-03-30", km: 130_000, description: "viisite tech", parts: ["SERVICE VISITE TECHNIQUE"] },
    { date: "2025-05-04", km: 118_157, description: "v simple", parts: ["VIDANGE 1:HUILE+FILTRE H+MO"] },
  ];

  it("drops the VT entry from km math while leaving everything else", () => {
    const usable = usableKmEntries(real44329);
    expect(usable).toHaveLength(2);
    expect(usable.map((e) => e.km)).toEqual([106_980, 118_157]);
  });

  it("recognises the real typo spellings, not just the correct one", () => {
    for (const d of [
      "VISITE TECHNIQUE",
      "VIISTE TECHNIQUE", // 110 real rows
      "VIISITE TECHNIQUE",
      "VISIITE TECHNIQUE",
      "VSITE TECHNIQUE",
      "VISITE TECHNQIUE",
      "viisite tech",
      "VISITE VTECHNIQUE",
    ]) {
      expect(usableKmEntries([{ date: "d", km: 1, description: d, parts: [] }])).toHaveLength(0);
    }
  });

  it("does NOT drop a genuine service whose text merely contains 'TECH'", () => {
    // Real rows: "TECH. = RACHID HUILE 5W30 + FH", "RéVISION: OTHMANE TECHNICIEN".
    for (const d of ["TECH. = RACHID HUILE 5W30 + FH", "RéVISION: OTHMANE TECHNICIEN"]) {
      expect(usableKmEntries([{ date: "d", km: 1, description: d, parts: [] }])).toHaveLength(1);
    }
  });

  it("44329-B-7 now yields a real answer where it previously said Indéterminé", () => {
    const r = checkInterval("vidange", real44329);
    // The 2025-05-04 vidange is the last one, so the gap is measured from it.
    expect(r.status).not.toBe("unknown");
    expect(r.lastKm).toBe(118_157);
    expect(r.currentKm).toBe(118_157);
  });

  it("computes the air-filter gap on 44329-B-7 across the VT, which used to block it", () => {
    const r = checkInterval("filtre_air", real44329);
    expect(r.status).not.toBe("unknown");
    expect(r.lastKm).toBe(106_980); // the fh+fa entry
    expect(r.currentKm).toBe(118_157); // NOT the VT's inflated 130,000
    expect(r.kmSince).toBe(11_177);
  });
});

describe("longestCleanRun — the fallback, for genuine non-VT bad readings", () => {
  const r = (km: number, date: string): KmReadingT => ({ km, date });
  type KmReadingT = { km: number; date: string };

  it("keeps a non-decreasing run and names what it dropped", () => {
    const out = longestCleanRun([r(100_000, "a"), r(60_000, "b"), r(110_000, "c")]);
    expect(out.kept.map((x) => x.km)).toEqual([100_000, 110_000]);
    expect(out.excluded.map((x) => x.km)).toEqual([60_000]);
  });

  it("tolerates sub-threshold noise rather than dropping it", () => {
    const out = longestCleanRun([r(100_000, "a"), r(99_900, "b"), r(101_000, "c")]);
    expect(out.excluded).toEqual([]);
  });

  it("collapses to one reading when the FIRST value is the inflated outlier", () => {
    // The desired failure: this must NOT rescue a wrong answer.
    const out = longestCleanRun([r(200_000, "a"), r(100_000, "b"), r(105_000, "c")]);
    expect(out.kept).toHaveLength(1);
  });
});

describe("checkInterval — tiered guard", () => {
  it("computes despite a bad reading OUTSIDE the relevant window", () => {
    const r = checkInterval("vidange", [
      { date: "2022-01-01", km: 200_000, parts: ["PNEU"] }, // bad, long before
      { date: "2022-06-01", km: 40_000, parts: ["PNEU"] },
      { date: "2025-01-01", km: 100_000, parts: ["VIDANGE 1:HUILE+FILTRE H+MO"] },
      { date: "2025-09-01", km: 118_500, parts: ["PNEU"] },
    ]);
    expect(r.status).toBe("overdue");
    expect(r.excludedReadings).toBeUndefined();
  });

  it("falls back to the clean run INSIDE the window and names the excluded readings", () => {
    const r = checkInterval("vidange", [
      { date: "2025-01-01", km: 100_000, parts: ["VIDANGE 1:HUILE+FILTRE H+MO"] },
      { date: "2025-04-01", km: 40_000, parts: ["PNEU"] }, // genuine bad reading
      { date: "2025-09-01", km: 125_000, parts: ["PNEU"] },
    ]);
    expect(r.status).toBe("overdue");
    expect(r.kmSince).toBe(25_000);
    expect(r.excludedReadings).toEqual([{ date: "2025-04-01", km: 40_000 }]);
  });

  it("still refuses, with a SPECIFIC reason, when no clean segment exists", () => {
    const r = checkInterval("vidange", [
      { date: "2025-01-01", km: 150_000, parts: ["VIDANGE 1:HUILE+FILTRE H+MO"] },
      { date: "2025-06-01", km: 120_000, parts: ["PNEU"] },
    ]);
    expect(r.status).toBe("unknown");
    expect(r.note).toMatch(/aucun segment cohérent/i);
    expect(r.note).not.toMatch(/^Relevés kilométriques incohérents\.$/);
  });
});


// ── Regression: a fired rule must reach the MAIN analysis prompt ───────────
//
// The bug this locks in: on 44329-B-7 a user had to ASK before the
// timing-belt situation was discussed at all. Whenever a tracked condition is
// actually met, the finding must already be in the lines the main analysis
// prompt is built from — a follow-up must never be the thing that surfaces it.
describe("regression — a met condition appears in the MAIN analysis lines", () => {
  it("an overdue interval is in the analysis lines, without any follow-up", () => {
    const entries: IntervalEntry[] = [
      e("2024-01-01", 100_000, "VIDANGE 1:HUILE+FILTRE H+MO"),
      e("2025-01-01", 135_000, "PNEU"),
    ];
    const lines = formatIntervalChecks(computeIntervalChecks(entries));
    expect(lines.some((l) => /Vidange/.test(l) && /DÉPASSÉ/.test(l))).toBe(true);
  });

  it("a triggered belt/pump rule is in the analysis lines, without any follow-up", () => {
    const lines = formatBeltPumpCheck(checkBeltPump([e("2025-01-01", 150_000, "PNEU")]));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/JAMAIS ENREGISTRÉ/);
    expect(lines[0]).toMatch(/150\s000/);
  });

  it("stays silent in the analysis when the belt/pump threshold is NOT met", () => {
    // 44329-B-7's real shape: 118,157 km against a 120,000 km threshold.
    expect(formatBeltPumpCheck(checkBeltPump([e("2026-05-04", 118_157, "PNEU")]))).toEqual([]);
  });
});

// ── The follow-up rules reference ─────────────────────────────────────────
describe("formatRulesReference — every rule stated, including the silent ones", () => {
  const entries: IntervalEntry[] = [
    e("2025-12-15", 106_980, "FILTRE A AIR"),
    e("2026-05-04", 118_157, "VIDANGE 1:HUILE+FILTRE H+MO"),
  ];
  const lines = formatRulesReference(computeIntervalChecks(entries), checkBeltPump(entries));
  const belt = lines.find((l) => /Distribution/.test(l)) as string;

  it("states the belt/pump rule even though the analysis omits it entirely", () => {
    expect(formatBeltPumpCheck(checkBeltPump(entries))).toEqual([]);
    expect(belt).toBeDefined();
  });

  it("gives the real threshold, the real current km, and the real gap", () => {
    expect(belt).toMatch(/120\s000/);
    expect(belt).toMatch(/118\s157/);
    expect(belt).toMatch(/1\s843 km sous le seuil/);
    expect(belt).toMatch(/NON APPLICABLE/);
  });

  it("says the absence alone is not an anomaly at this mileage", () => {
    expect(belt).toMatch(/l'absence seule ne constitue pas une anomalie/i);
  });

  it("covers every tracked interval rule with its threshold", () => {
    for (const [label, km] of [["Vidange", /10\s000/], ["Filtre à gasoil", /40\s000/], ["Filtre à air", /30\s000/]] as [string, RegExp][]) {
      const l = lines.find((x) => x.includes(label));
      expect(l, label).toBeDefined();
      expect(l).toMatch(km);
    }
  });

  it("reports a TRIGGERED belt/pump rule as such, so the follow-up can concede", () => {
    const over = [e("2025-01-01", 150_000, "PNEU")];
    const l = formatRulesReference(computeIntervalChecks(over), checkBeltPump(over)).find((x) =>
      /Distribution/.test(x)
    ) as string;
    expect(l).toMatch(/DÉCLENCHÉE/);
    expect(l).toMatch(/150\s000/);
  });
});


// ─── Manual km override (Parking's KM column) ──────────────────────────────

describe("resolveVehicleKm — the manual reading wins, and says so", () => {
  const hist = [e("2025-01-01", 100_000, "PNEU"), e("2025-06-01", 118_000, "PNEU")];

  it("prefers the manual reading over the DS-derived one", () => {
    expect(resolveVehicleKm(150_000, hist)).toEqual({ km: 150_000, source: "manual" });
  });

  it("wins even when it is LOWER than the DS maximum — a corrected odometer is still the correction", () => {
    expect(resolveVehicleKm(90_000, hist)).toEqual({ km: 90_000, source: "manual" });
  });

  it("falls back to the DS value when there is no override", () => {
    expect(resolveVehicleKm(undefined, hist)).toEqual({ km: 118_000, source: "ds" });
    expect(resolveVehicleKm(null, hist)).toEqual({ km: 118_000, source: "ds" });
    expect(resolveVehicleKm("", hist)).toEqual({ km: 118_000, source: "ds" });
  });

  it("falls back rather than poisoning the arithmetic with an unparseable value", () => {
    for (const bad of ["abc", 0, -5, 2_000_000, NaN, {}]) {
      expect(resolveVehicleKm(bad, hist).source).toBe("ds");
    }
  });

  it("coerces the string forms a human actually types", () => {
    expect(resolveVehicleKm("142 500", hist).km).toBe(142_500);
    expect(resolveVehicleKm("142,500", hist).km).toBe(142_500);
  });

  it("reports 'none' when neither source has a reading", () => {
    expect(resolveVehicleKm(undefined, [e("2025-01-01", undefined, "PNEU")])).toEqual({
      km: null,
      source: "none",
    });
  });
});

describe("formatKmSourceLine — a real source string for the grounding guard", () => {
  const hist = [e("2025-01-01", 100_000, "PNEU")];

  it("names the manual case in the upper-case form the guard has to match", () => {
    const [line] = formatKmSourceLine(resolveVehicleKm(150_000, hist));
    expect(line).toContain("KM DÉCLARÉ MANUELLEMENT");
    // toLocaleString("fr-FR") uses a narrow no-break space as the group
    // separator, so the literal is built the same way rather than typed out.
    expect(line).toContain(`${(150_000).toLocaleString("fr-FR")} km`);
  });

  it("is NOT silent on the ordinary DS case — absent must not mean DS-derived", () => {
    const [line] = formatKmSourceLine(resolveVehicleKm(undefined, hist));
    expect(line).toContain("KM ISSU DE L'HISTORIQUE DS");
  });

  it("says nothing when there is no reading at all", () => {
    expect(formatKmSourceLine({ km: null, source: "none" })).toEqual([]);
  });
});

describe("checkInterval / checkBeltPump — honouring the override", () => {
  it("computes the gap against the manual reading, not the DS maximum", () => {
    const entries = [e("2025-01-01", 100_000, "VIDANGE 1:HUILE+FILTRE H+MO")];
    // DS alone: 0 km since, à jour. With a manual 115,000: 15,000 km since,
    // past the 10,000 km interval.
    expect(checkInterval("vidange", entries).status).toBe("ok");
    const r = checkInterval("vidange", entries, 115_000);
    expect(r.status).toBe("overdue");
    expect(r.currentKm).toBe(115_000);
    expect(r.kmSince).toBe(15_000);
    expect(r.overdueByKm).toBe(5_000);
  });

  it("refuses to invent a gap when the manual reading contradicts the last service", () => {
    const entries = [e("2025-01-01", 100_000, "VIDANGE 1:HUILE+FILTRE H+MO")];
    const r = checkInterval("vidange", entries, 50_000);
    expect(r.status).toBe("unknown");
    expect(r.note).toContain("contradiction");
    // The numbers behind the refusal are still reported, so it can be checked.
    expect(r.lastKm).toBe(100_000);
    expect(r.currentKm).toBe(50_000);
  });

  it("tolerates a keying-noise difference rather than refusing on it", () => {
    const entries = [e("2025-01-01", 100_000, "VIDANGE 1:HUILE+FILTRE H+MO")];
    expect(checkInterval("vidange", entries, 99_950).status).toBe("ok");
  });

  it("crosses the belt/pump threshold on a manual reading the DS history cannot see", () => {
    // 118,157 km in the history — the 44329-B-7 case, correctly silent. An
    // operator reading 130,000 off the dashboard changes that.
    const entries = [e("2026-05-04", 118_157, "PNEU")];
    expect(checkBeltPump(entries).status).toBe("not_applicable");
    const r = checkBeltPump(entries, 130_000);
    expect(r.status).toBe("never");
    expect(r.currentKm).toBe(130_000);
    expect(formatBeltPumpCheck(r)).toHaveLength(1);
  });

  it("changes nothing for a zone that passes no override", () => {
    const entries = [e("2025-01-01", 100_000, "VIDANGE 1:HUILE+FILTRE H+MO"), e("2025-06-01", 118_000, "PNEU")];
    expect(computeIntervalChecks(entries, undefined)).toEqual(computeIntervalChecks(entries));
    expect(checkBeltPump(entries, undefined)).toEqual(checkBeltPump(entries));
  });
});
