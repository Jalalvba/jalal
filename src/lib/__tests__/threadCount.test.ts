import { describe, it, expect } from "vitest";
import { estimateThreadCount } from "@/lib/anthropic/threadCount";

// estimateThreadCount only ever feeds the upload preview ("~3 fils détectés"),
// never the analysis itself — the real count comes back from the model in
// sourceSummary.threadsObserved. These tests pin the shapes a Gmail
// copy-paste actually produces in a French mailbox, not exhaustive parsing.
describe("estimateThreadCount", () => {
  it("returns 0 for empty or whitespace-only input", () => {
    expect(estimateThreadCount("")).toBe(0);
    expect(estimateThreadCount("   \n\n  ")).toBe(0);
  });

  it("returns at least 1 for text with no recognisable headers", () => {
    expect(estimateThreadCount("Le client se plaint du véhicule.")).toBe(1);
  });

  it("counts French 'De :' headers", () => {
    const text = ["De : client@example.com", "objet…", "De : autre@example.com", "objet…"].join(
      "\n"
    );
    expect(estimateThreadCount(text)).toBe(2);
  });

  it("counts English 'From:' headers and is case-insensitive", () => {
    expect(estimateThreadCount("From: a@b.com\ntext\nfrom: c@d.com\ntext")).toBe(2);
  });

  it("counts forwarded-message separators in both languages", () => {
    const text = [
      "---------- Message transféré ----------",
      "corps",
      "---------- Forwarded message ----------",
      "corps",
    ].join("\n");
    expect(estimateThreadCount(text)).toBe(2);
  });

  it("does not match 'de' or 'from' occurring mid-sentence", () => {
    // The anchor is a line start followed by a colon — prose mentioning
    // "de :" inside a sentence must not inflate the count.
    expect(estimateThreadCount("Le véhicule de : la société est en panne.")).toBe(1);
  });
});
