import { describe, expect, it } from "vitest";
import {
  checkBeltPump,
  formatBeltPumpCheck,
  checkInterval,
  currentKmOf,
  computeIntervalChecks,
  formatIntervalChecks,
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
    expect(r.note).toMatch(/incohérents/);
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
    expect(r.note).toMatch(/incohérents/);
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


describe("checkBeltPump — rule 2", () => {
  const NOW = new Date("2026-08-20T12:00:00.000Z");
  // Real spellings, already validated against production in serviceTypes.test.ts —
  // reused here rather than inventing new synthetic part names.
  const BELT = "CHANGEMENT KIT DE DISTRIBUTION";
  const PUMP = "POMPE A EAU";
  const OTHER = "COURROIE ALTERNATEUR"; // a real trap: NOT the timing belt

  const highKm = (...extra: IntervalEntry[]): IntervalEntry[] => [
    e("2023-01-01", 100_000, "PNEU"),
    e("2025-06-01", 150_000, "PLAQUETTE FREIN"),
    ...extra,
  ];

  it("is SKIPPED, not flagged and not cleared, when the contract date is missing", () => {
    const r = checkBeltPump(highKm(), null, NOW);
    expect(r.status).toBe("skipped");
    expect(r.note).toMatch(/indisponible/i);
  });

  it("is SKIPPED when the contract date is unparseable", () => {
    expect(checkBeltPump(highKm(), "not-a-date", NOW).status).toBe("skipped");
  });

  it("FLAGS >6 months past contract, >120,000 km, never recorded", () => {
    const r = checkBeltPump(highKm(), "2025-01-15T00:00:00.000Z", NOW);
    expect(r.status).toBe("never");
    expect(r.monthsPastContract).toBe(19);
    expect(r.currentKm).toBe(150_000);
  });

  it("does NOT flag when a timing-belt service exists", () => {
    const r = checkBeltPump(highKm(e("2024-03-01", 130_000, BELT)), "2025-01-15T00:00:00.000Z", NOW);
    expect(r.status).toBe("ok");
    expect(r.lastServiceDate).toBe("2024-03-01");
    expect(r.lastServiceKm).toBe(130_000);
  });

  it("accepts a water-pump service as satisfying the check", () => {
    const r = checkBeltPump(highKm(e("2024-03-01", 130_000, PUMP)), "2025-01-15T00:00:00.000Z", NOW);
    expect(r.status).toBe("ok");
  });

  it("is not satisfied by an ALTERNATOR belt — a different part entirely", () => {
    const r = checkBeltPump(highKm(e("2024-03-01", 130_000, OTHER)), "2025-01-15T00:00:00.000Z", NOW);
    expect(r.status).toBe("never");
  });

  it("is NOT APPLICABLE (silent) at exactly 6 months past contract", () => {
    // Boundary: the rule says MORE than 6 months.
    const r = checkBeltPump(highKm(), "2026-02-20T00:00:00.000Z", NOW);
    expect(r.monthsPastContract).toBe(6);
    expect(r.status).toBe("not_applicable");
  });

  it("is NOT APPLICABLE (silent) while still inside the contract", () => {
    expect(checkBeltPump(highKm(), "2027-01-01T00:00:00.000Z", NOW).status).toBe("not_applicable");
  });

  it("is NOT APPLICABLE (silent) below the 120,000 km threshold", () => {
    const low = [e("2023-01-01", 60_000, "PNEU"), e("2025-06-01", 119_000, "PNEU")];
    const r = checkBeltPump(low, "2025-01-15T00:00:00.000Z", NOW);
    expect(r.status).toBe("not_applicable");
    expect(r.currentKm).toBe(119_000);
  });

  it("uses whole calendar months, not days/30", () => {
    // 2026-02-20 -> 2026-08-20 is exactly 6 months, not 6.1 from day-division.
    expect(checkBeltPump(highKm(), "2026-02-20T00:00:00.000Z", NOW).monthsPastContract).toBe(6);
    // One day earlier is a full 6 months plus a day, still 6 whole months.
    expect(checkBeltPump(highKm(), "2026-02-19T00:00:00.000Z", NOW).monthsPastContract).toBe(6);
  });

  it("credits a belt changed inside a combined line", () => {
    const r = checkBeltPump(
      highKm(e("2024-03-01", 130_000, "KIT DISTRIB+POMPE EAU+JOINT CULASSE")),
      "2025-01-15T00:00:00.000Z",
      NOW
    );
    expect(r.status).toBe("ok");
  });
});

describe("formatBeltPumpCheck", () => {
  const NOW = new Date("2026-08-20T12:00:00.000Z");
  const highKm = [e("2023-01-01", 100_000, "PNEU"), e("2025-06-01", 150_000, "PNEU")];

  it("renders NOTHING when not applicable — silence is the design", () => {
    expect(formatBeltPumpCheck(checkBeltPump(highKm, "2027-01-01T00:00:00.000Z", NOW))).toEqual([]);
  });

  it("states plainly that the check could not run when the date is missing", () => {
    const [line] = formatBeltPumpCheck(checkBeltPump(highKm, null, NOW));
    expect(line).toMatch(/NON VÉRIFIÉ/);
  });

  it("cites the months, contract date and km on a flag", () => {
    const [line] = formatBeltPumpCheck(checkBeltPump(highKm, "2025-01-15T00:00:00.000Z", NOW));
    expect(line).toMatch(/JAMAIS ENREGISTRÉ/);
    expect(line).toMatch(/19 mois/);
    expect(line).toMatch(/15\/01\/2025/);
    expect(line).toMatch(/150\s000 km/u);
  });
});
