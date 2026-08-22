import { describe, expect, it } from "vitest";
import { sanitize, truncate, wrapText, wrapPreservingBreaks } from "@/lib/pdf/text";

// A stand-in for a pdf-lib font: 5pt per character at size 10.
const font = { widthOfTextAtSize: (t: string, size: number) => t.length * size * 0.5 };

describe("sanitize — what pdf-lib's WinAnsi fonts can actually encode", () => {
  it("replaces the C1 range, which looks Latin-1 but is not encodable", () => {
    // One of these, from a Windows-1252-mangled paste, crashed a whole export
    // with an opaque 500 — it sits inside \\x00-\\xff and passes a naive check.
    expect(sanitize("A\x93B")).toBe("A B");
  });

  it("folds typographic punctuation instead of dropping it", () => {
    expect(sanitize("l’huile — “ok”…")).toBe("l'huile -- \"ok\"...");
  });

  it("collapses newlines and tabs to spaces", () => {
    expect(sanitize("a\nb\tc")).toBe("a b c");
  });
});

describe("wrapPreservingBreaks — the work order keeps its shape", () => {
  it("keeps one operation per line", () => {
    // The whole point of the ACTION column: re-flowing it into a paragraph
    // would undo the only thing that makes it copy-pasteable.
    const lines = wrapPreservingBreaks("1. Vidange\n2. Filtre", font, 10, 200);
    expect(lines).toEqual(["1. Vidange", "2. Filtre"]);
  });

  it("still wraps a line too long for the column", () => {
    const lines = wrapPreservingBreaks("1. aaa bbb ccc ddd", font, 10, 50);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toContain("ddd");
  });

  it("survives empty input", () => {
    expect(wrapPreservingBreaks("", font, 10, 100)).toEqual([""]);
  });
});

describe("wrapText / truncate", () => {
  it("hard-breaks a single word wider than the column rather than losing it", () => {
    const lines = wrapText("x".repeat(40), font, 10, 50);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe("x".repeat(40));
  });

  it("ellipsises rather than overflowing", () => {
    const out = truncate("abcdefghijklmnop", font, 10, 40);
    expect(out.endsWith("...")).toBe(true);
    expect(font.widthOfTextAtSize(out, 10)).toBeLessThanOrEqual(40);
  });
});
