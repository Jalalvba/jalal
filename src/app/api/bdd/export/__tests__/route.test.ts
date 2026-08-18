import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rateLimit", () => ({
  rateLimitOrNull: vi.fn().mockResolvedValue(null),
}));

import { POST } from "@/app/api/bdd/export/route";

function req(body: unknown): Request {
  return new Request("http://localhost/api/bdd/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validRow = { IMM: "12345-B-6", client: "Acme", modele: "208", Emplacement: "PARKING", commentaire: "RAS" };

describe("POST /api/bdd/export — validation", () => {
  it("rejects a row with a numeric modele — the whole batch fails, not a silent partial export", async () => {
    const res = await POST(req({ rows: [validRow, { ...validRow, IMM: "99999-B-6", modele: 208 }] }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("rejects an empty rows array", async () => {
    const res = await POST(req({ rows: [] }));
    expect(res.status).toBe(400);
  });

  it("rejects a payload with no 'rows' key at all", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it("rejects more rows than the defensive MAX_ROWS upper bound", async () => {
    const rows = Array.from({ length: 2001 }, (_, i) => ({ ...validRow, IMM: `PLATE-${i}` }));
    const res = await POST(req({ rows }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Too many rows/);
  });

  it("rejects invalid JSON body", async () => {
    const res = await POST(
      new Request("http://localhost/api/bdd/export", { method: "POST", body: "not json" })
    );
    expect(res.status).toBe(400);
  });

  it("rejects malformed activeFilters", async () => {
    const res = await POST(req({ rows: [validRow], activeFilters: [{ label: "Flotte" }] }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/bdd/export — happy path", () => {
  it("a valid single-row payload returns a real PDF", async () => {
    const res = await POST(req({ rows: [validRow], activeFilters: [] }));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");

    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
    // %PDF magic bytes
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("%PDF");
  });

  it("a row with a numeric-looking but already-string modele (the fixed client-side coercion shape) is accepted", async () => {
    const res = await POST(req({ rows: [{ ...validRow, modele: "208" }] }));
    expect(res.status).toBe(200);
  });

  it("accepts active filters and a search term without erroring", async () => {
    const res = await POST(
      req({
        rows: [validRow],
        activeFilters: [{ label: "Flotte", value: "TOUS" }],
        searchTerm: "12345",
      })
    );
    expect(res.status).toBe(200);
  });

  // Regression guard for the C1-range crash found in the audit (I1): pdf-lib's
  // WinAnsi StandardFonts can't encode U+0080-U+009F, and sanitize()'s
  // previous control-char strip only covered \x00-\x1f/\x7f, missing this
  // range entirely — a Windows-1252-mangled paste containing one of these
  // characters crashed the whole export with an opaque 500. Covers all three
  // text paths that call into pdf-lib's width/draw calls: wrapText
  // (commentaire), and truncate (IMM, and the header line via searchTerm).
  it("a C1 control character (U+0081) in commentaire no longer crashes the export", async () => {
    const res = await POST(req({ rows: [{ ...validRow, commentaire: `avant${String.fromCharCode(0x81)}apres` }] }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
  });

  it("a C1 control character (U+0090) in IMM no longer crashes the export", async () => {
    const res = await POST(req({ rows: [{ ...validRow, IMM: `12345${String.fromCharCode(0x90)}B` }] }));
    expect(res.status).toBe(200);
  });

  it("a C1 control character (U+008D) in searchTerm (rendered in the header line) no longer crashes the export", async () => {
    const res = await POST(req({ rows: [validRow], searchTerm: `x${String.fromCharCode(0x8d)}y` }));
    expect(res.status).toBe(200);
  });

  it("the full C1 range (U+0080-U+009F) is handled without crashing, one character at a time", async () => {
    for (let code = 0x80; code <= 0x9f; code++) {
      const res = await POST(req({ rows: [{ ...validRow, commentaire: `x${String.fromCharCode(code)}y` }] }));
      expect(res.status, `code 0x${code.toString(16)} should not crash the export`).toBe(200);
    }
  });
});
