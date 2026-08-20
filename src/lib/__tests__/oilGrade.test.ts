import { describe, expect, it } from "vitest";
import {
  gradeOfEntry, checkOilGrade, formatOilGradeCheck, ESTABLISHED_GRADE,
} from "@/lib/ai/prompts/oilGrade";
import type { IntervalEntry } from "@/lib/ai/prompts/maintenanceIntervals";

const e = (date: string, km: number | undefined, ...parts: string[]): IntervalEntry => ({ date, km, parts });
const withDesc = (date: string, description: string, ...parts: string[]): IntervalEntry => ({ date, description, parts });

describe("gradeOfEntry — real production spellings", () => {
  // Every string below is a verbatim value from ds["Désignation Consomation"].
  it.each([
    ["Huile FV 5W30 SL/CF 200 LT", "5W30"],
    ["Huile moteur 10W40 1L", "10W40"],
    ["Huile moteur 10W40 Fut", "10W40"],
    ["Lub Nexol 5W30 SP/SN C3 200L", "5W30"],
    ["Huile FEU VERT X 5W30 SL 200 L", "5W30"],
    ["Huile moteur 5W40 FUT", "5W40"],
    ["Huile moteur 0W20 5L", "0W20"],
    ["Huile Moteur EDGE LL 0W30 5L", "0W30"],
    ["Vidange 1:Huile+Filtre H+MO+5l 5w30", "5W30"], // lowercase, real row
    ["10.4 10W40 - 1L (15)", "10W40"],               // no "huile" keyword at all
    ["OIL 10W40", "10W40"],
  ])("reads %s as %s", (part, grade) => {
    expect(gradeOfEntry(e("2025-01-01", 1000, part))).toEqual({ kind: "known", grade });
  });

  it("normalises spacing and hyphens to one canonical form", () => {
    for (const v of ["5W30", "5w30", "5W-30", "5 W 30", "5w-30"]) {
      expect(gradeOfEntry(e("2025-01-01", 1, `Huile moteur ${v}`))).toEqual({ kind: "known", grade: "5W30" });
    }
  });

  it("rejects the real false positive: a lamp, not an oil grade", () => {
    // 78 production lines. A bare /\d{1,2}W\d{2}/ reads "5W12" out of this.
    expect(gradeOfEntry(e("2025-01-01", 1, "Lampe 2p W 21/5W 12V"))).toEqual({ kind: "absent" });
  });

  it("reads the grade from the DESCRIPTION too — 2,604 lines carry it only there", () => {
    expect(gradeOfEntry(withDesc("2025-01-01", "HUILE 5W30 + FH + CONTROLE GENERAL", "Vidange 1:Huile+Filtre H+MO")))
      .toEqual({ kind: "known", grade: "5W30" });
  });

  it("says absent for a generic package code rather than guessing", () => {
    expect(gradeOfEntry(e("2025-01-01", 1, "Vidange 1:Huile+Filtre H+MO", "Filtre a huile"))).toEqual({ kind: "absent" });
  });

  it("reports two grades on one DS as ambiguous instead of picking one", () => {
    const r = gradeOfEntry(e("2025-01-01", 1, "Huile moteur 10W40 1L", "Huile FV 5W30 SL/CF 200 LT"));
    expect(r).toEqual({ kind: "ambiguous", grades: ["10W40", "5W30"] });
  });
});

describe("checkOilGrade — regression, not plain change detection", () => {
  it("does NOT fire on the fleet-wide 10W40 -> 5W30 switchover", () => {
    // The exact shape of most long-history vehicles. A change-detector would
    // flag this; it is the fleet's own deliberate migration.
    const r = checkOilGrade([
      e("2022-01-04", 22_806, "Huile moteur 10W40 FUT"),
      e("2023-01-24", 110_779, "Huile moteur 10W40 1L"),
      e("2024-03-13", 121_956, "Huile moteur 5W30 Fut"),
      e("2025-11-13", 180_637, "Huile FV 5W30 SL/CF 200 LT"),
    ]);
    expect(r.status).toBe("ok");
    expect(formatOilGradeCheck(r)).toEqual([]);
  });

  it("fires when a later service reverts off the established grade", () => {
    const r = checkOilGrade([
      e("2022-01-04", 22_806, "Huile moteur 10W40 FUT"),
      e("2024-03-13", 121_956, "Huile moteur 5W30 Fut"),
      e("2025-03-17", 211_925, "Huile moteur 10W40 Fut"),
    ]);
    expect(r.status).toBe("regression");
    expect(r.establishedAt).toEqual({ date: "2024-03-13", km: 121_956, grade: "5W30" });
    expect(r.regressions).toEqual([{ date: "2025-03-17", km: 211_925, grade: "10W40" }]);
  });

  it("orders by date, not by array order", () => {
    const r = checkOilGrade([
      e("2025-03-17", 211_925, "Huile moteur 10W40 Fut"),
      e("2024-03-13", 121_956, "Huile moteur 5W30 Fut"),
    ]);
    expect(r.status).toBe("regression");
    expect(r.regressions).toHaveLength(1);
  });

  it("is not_applicable when the vehicle never reached the established grade", () => {
    const r = checkOilGrade([
      e("2022-01-04", 22_806, "Huile moteur 10W40 FUT"),
      e("2022-08-02", 50_388, "Huile moteur 5W40 FUT"),
    ]);
    expect(r.status).toBe("not_applicable");
    expect(formatOilGradeCheck(r)).toEqual([]);
  });

  it("is unknown when no entry carries a readable grade", () => {
    const r = checkOilGrade([e("2025-01-01", 1000, "Vidange 1:Huile+Filtre H+MO")]);
    expect(r.status).toBe("unknown");
    expect(r.note).toMatch(/Aucun grade d'huile lisible/);
    expect(formatOilGradeCheck(r)).toEqual([]);
  });

  it("counts coverage honestly — graded vs examined", () => {
    const r = checkOilGrade([
      e("2024-03-13", 121_956, "Huile moteur 5W30 Fut"),
      e("2024-06-01", 130_000, "Vidange 1:Huile+Filtre H+MO"),
      e("2024-09-01", 140_000, "4 PNEUS"),
    ]);
    expect(r.gradedCount).toBe(1);
    expect(r.examinedCount).toBe(3);
  });

  it("names ambiguous DS without counting them as a regression", () => {
    const r = checkOilGrade([
      e("2024-03-13", 121_956, "Huile moteur 5W30 Fut"),
      e("2025-01-01", 150_000, "Huile moteur 10W40 1L", "Huile FV 5W30 SL/CF 200 LT"),
    ]);
    expect(r.status).toBe("ok");
    expect(r.regressions).toEqual([]);
    expect(r.ambiguous).toEqual([{ date: "2025-01-01", grades: ["10W40", "5W30"] }]);
  });

  it("collects every later departure, not just the first", () => {
    const r = checkOilGrade([
      e("2024-01-01", 100_000, "Huile moteur 5W30 Fut"),
      e("2024-06-01", 110_000, "Huile moteur 10W40 1L"),
      e("2025-01-01", 120_000, "Huile moteur 5W40 FUT"),
    ]);
    expect(r.regressions.map((x) => x.grade)).toEqual(["10W40", "5W40"]);
  });
});

describe("formatOilGradeCheck — silent unless it fired, and never asserts fault", () => {
  const fired = checkOilGrade([
    e("2024-03-13", 121_956, "Huile moteur 5W30 Fut"),
    e("2025-03-17", 211_925, "Huile moteur 10W40 Fut"),
  ]);

  it("emits exactly one line, citing both sides with real dates and km", () => {
    const [line] = formatOilGradeCheck(fired);
    expect(formatOilGradeCheck(fired)).toHaveLength(1);
    expect(line).toContain("2024-03-13");
    expect(line).toContain("2025-03-17");
    expect(line).toContain("10W40");
    expect(line).toMatch(/121\s956/);
    expect(line).toMatch(/211\s925/);
  });

  it("states plainly that the correct grade is unknown to this app", () => {
    const [line] = formatOilGradeCheck(fired);
    expect(line).toMatch(/n'est pas connu de cette application/);
    expect(line).not.toMatch(/incorrect|mauvais|erreur/i);
  });

  it("uses 5W30 as the established grade, per the measured fleet share", () => {
    expect(ESTABLISHED_GRADE).toBe("5W30");
  });
});


// ── uniqueGrades: the distinct set, led with and never recomputed ──────────
describe("uniqueGrades — deduplicated, normalised, and consistent with the detail", () => {
  it("collapses format variants of the SAME grade instead of inflating the count", () => {
    // "5W-30" and "5w30" are the same oil. If canonicalisation were skipped,
    // this would report 3 distinct grades instead of 2.
    const r = checkOilGrade([
      e("2024-01-01", 100_000, "Huile moteur 5W30 Fut"),
      e("2024-06-01", 110_000, "Huile moteur 5W-30 5L"),
      e("2024-09-01", 115_000, "Vidange 1:Huile+Filtre H+MO+5l 5w30"),
      e("2025-01-01", 120_000, "Huile moteur 10W40 1L"),
    ]);
    expect(r.status).toBe("regression");
    expect(r.uniqueGrades).toEqual(["5W30", "10W40"]);
    expect(r.uniqueGrades).toHaveLength(2);
  });

  it("lists the established grade first, then each later one in order", () => {
    const r = checkOilGrade([
      e("2024-10-08", 20_469, "Huile moteur 5W30 Fut"),
      e("2024-12-24", 30_427, "Huile moteur 5W40 FUT"),
      e("2026-02-05", 82_171, "Huile moteur 0W20 5L"),
      e("2026-05-22", 93_842, "Huile moteur 0W30 5L"),
    ]);
    expect(r.uniqueGrades).toEqual(["5W30", "5W40", "0W20", "0W30"]);
  });

  it("deduplicates a grade that recurs across several later services", () => {
    const r = checkOilGrade([
      e("2024-01-01", 100_000, "Huile moteur 5W30 Fut"),
      e("2024-06-01", 110_000, "Huile moteur 10W40 1L"),
      e("2025-01-01", 120_000, "Huile moteur 10W40 Fut"),
    ]);
    expect(r.regressions).toHaveLength(2);      // two occurrences
    expect(r.uniqueGrades).toEqual(["5W30", "10W40"]); // one distinct grade after
  });

  it("cannot disagree with the chronological detail — same source, both places", () => {
    const r = checkOilGrade([
      e("2024-10-08", 20_469, "Huile moteur 5W30 Fut"),
      e("2024-12-24", 30_427, "Huile moteur 5W40 FUT"),
      e("2026-02-05", 82_171, "Huile moteur 0W20 5L"),
      e("2026-05-22", 93_842, "Huile moteur 0W30 5L"),
    ]);
    // Every grade named in the detail must appear in the summary set...
    const cited = new Set([r.establishedAt!.grade, ...r.regressions.map((x) => x.grade)]);
    expect(new Set(r.uniqueGrades)).toEqual(cited);
    // ...and the set must carry nothing the detail does not cite.
    expect(r.uniqueGrades.length).toBe(cited.size);
  });

  it("excludes pre-switchover grades — the fleet migration stays out of the count", () => {
    // 10W40 before the move to 5W30 is the fleet's own migration, not a finding.
    const r = checkOilGrade([
      e("2022-01-04", 22_806, "Huile moteur 10W40 FUT"),
      e("2024-03-13", 121_956, "Huile moteur 5W30 Fut"),
      e("2025-03-17", 211_925, "Huile moteur 5W40 FUT"),
    ]);
    expect(r.uniqueGrades).toEqual(["5W30", "5W40"]);
    expect(r.uniqueGrades).not.toContain("10W40");
  });

  it("is empty for every non-firing status", () => {
    for (const entries of [
      [e("2022-01-04", 22_806, "Huile moteur 10W40 FUT")],            // not_applicable
      [e("2025-01-01", 1000, "Vidange 1:Huile+Filtre H+MO")],          // unknown
      [e("2024-01-01", 100_000, "Huile moteur 5W30 Fut")],             // ok
    ]) {
      expect(checkOilGrade(entries).uniqueGrades).toEqual([]);
    }
  });
});

describe("formatOilGradeCheck — leads with the unique set", () => {
  const r = checkOilGrade([
    e("2024-10-08", 20_469, "Huile moteur 5W30 Fut"),
    e("2024-12-24", 30_427, "Huile moteur 5W40 FUT"),
    e("2026-02-05", 82_171, "Huile moteur 0W20 5L"),
    e("2026-05-22", 93_842, "Huile moteur 0W30 5L"),
  ]);
  const [line] = formatOilGradeCheck(r);

  it("states the distinct grades and their count before any date", () => {
    expect(line).toContain("Grades utilisés : 5W30, 5W40, 0W20, 0W30 (4 grades différents)");
    expect(line.indexOf("Grades utilisés")).toBeLessThan(line.indexOf("2024-10-08"));
  });

  it("keeps the chronological detail as supporting evidence, not a replacement", () => {
    expect(line).toContain("2024-12-24");
    expect(line).toContain("2026-05-22");
    expect(line).toMatch(/93\s842/);
  });

  it("the count in the lead matches the grades actually listed after it", () => {
    const n = Number(line.match(/\((\d+) grades différents\)/)![1]);
    expect(n).toBe(r.uniqueGrades.length);
    for (const g of r.uniqueGrades) expect(line).toContain(g);
  });
});
