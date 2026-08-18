import { describe, expect, it } from "vitest";
import { escapeRegex } from "@/lib/utils/regex";

describe("escapeRegex", () => {
  it("escapes every regex metacharacter it targets", () => {
    // One of each character the implementation's own character class lists.
    expect(escapeRegex(".*+?^${}()|[]\\")).toBe(
      "\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\"
    );
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeRegex("12345-B-6")).toBe("12345-B-6");
    expect(escapeRegex("Marque Modele")).toBe("Marque Modele");
  });

  it("neutralizes a ReDoS-shaped quantifier input instead of leaving it live", () => {
    const malicious = "(a+)+$";
    const escaped = escapeRegex(malicious);
    // A regex built from the escaped output must match the malicious string
    // only as a literal, not interpret any of its quantifiers/anchors.
    expect(new RegExp(escaped).test(malicious)).toBe(true);
    expect(new RegExp(escaped).test("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!")).toBe(false);
  });

  it("prevents regex-injection: a crafted filter can't match unintended input", () => {
    // Without escaping, "." would match any character — with escaping it
    // must match only a literal ".".
    const userInput = ".";
    const pattern = new RegExp(escapeRegex(userInput));
    expect(pattern.test(".")).toBe(true);
    expect(pattern.test("x")).toBe(false);
  });
});
