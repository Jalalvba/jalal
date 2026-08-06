import { describe, expect, it } from "vitest";
import { isValidRow } from "@/app/api/bdd/export/route";

// Regression guard for the real bug found this session: some live BDD rows'
// `modele` is a raw Sheets NUMBER (Peugeot 208/508/2008/3008 etc. — the
// sheet stores digit-only model names as numbers, not text), which the
// client now coerces to a string before ever POSTing here (App fix:
// String(r.modele ?? "")). isValidRow is the server-side backstop: if that
// client-side coercion is ever removed or weakened, this must still reject
// the payload with a clear 400 instead of letting a non-string field reach
// buildPdf(), where row.commentaire.trim() etc. would throw on a non-string.
describe("isValidRow", () => {
  it("accepts a row where every field is a string", () => {
    expect(isValidRow({ IMM: "12345-B-6", client: "Acme", modele: "208", commentaire: "" })).toBe(true);
  });

  it("rejects a row whose modele is a raw number — the exact Peugeot 208/508/2008/3008 bug", () => {
    expect(isValidRow({ IMM: "12345-B-6", client: "Acme", modele: 208, commentaire: "" })).toBe(false);
  });

  it("rejects a row whose IMM is a number", () => {
    expect(isValidRow({ IMM: 12345, client: "Acme", modele: "208", commentaire: "" })).toBe(false);
  });

  it("rejects a row missing a required field entirely", () => {
    expect(isValidRow({ IMM: "12345-B-6", client: "Acme", modele: "208" })).toBe(false);
  });

  it("rejects null and non-object values without throwing", () => {
    expect(isValidRow(null)).toBe(false);
    expect(isValidRow(undefined)).toBe(false);
    expect(isValidRow("a string")).toBe(false);
    expect(isValidRow(42)).toBe(false);
  });

  it("rejects a field that is null (not just absent or wrong-typed)", () => {
    expect(isValidRow({ IMM: "12345-B-6", client: null, modele: "208", commentaire: "" })).toBe(false);
  });
});
