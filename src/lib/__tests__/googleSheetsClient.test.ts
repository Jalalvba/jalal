import { describe, expect, it } from "vitest";
import type { sheets_v4 } from "googleapis";
import { verifyRowIdentity, RowIdentityError, isFormulaTriggerToken } from "@/lib/sheets/googleSheetsClient";

/** Minimal fake of the one Sheets client method verifyRowIdentity calls. */
function fakeSheets(cellValue: unknown): sheets_v4.Sheets {
  return {
    spreadsheets: {
      values: {
        get: async () => ({ data: { values: [[cellValue]] } }),
      },
    },
  } as unknown as sheets_v4.Sheets;
}

describe("verifyRowIdentity", () => {
  it("throws RowIdentityError when the live cell no longer matches the expected value", async () => {
    const sheets = fakeSheets("OTHER-PLATE");

    await expect(
      verifyRowIdentity(sheets, "sheet-id", "PARKING!A5", "12345-B-6")
    ).rejects.toBeInstanceOf(RowIdentityError);
  });

  it("RowIdentityError carries a 409 status, since it's a stale-state conflict, not a bad request", async () => {
    const sheets = fakeSheets("OTHER-PLATE");

    try {
      await verifyRowIdentity(sheets, "sheet-id", "PARKING!A5", "12345-B-6");
      throw new Error("expected verifyRowIdentity to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(RowIdentityError);
      expect((e as RowIdentityError).status).toBe(409);
    }
  });

  it("does not throw when the live cell still matches, case/whitespace-insensitively", async () => {
    const sheets = fakeSheets(" 12345-b-6 ");

    await expect(
      verifyRowIdentity(sheets, "sheet-id", "PARKING!A5", "12345-B-6")
    ).resolves.toBeUndefined();
  });

  it("throws when the expected value passed in is empty/whitespace-only", async () => {
    const sheets = fakeSheets("12345-B-6");

    await expect(
      verifyRowIdentity(sheets, "sheet-id", "PARKING!A5", "   ")
    ).rejects.toBeInstanceOf(RowIdentityError);
  });
});

describe("isFormulaTriggerToken", () => {
  it.each(["=SUM(A1:A2)", "+1234", "-1234", "@SUM(A1)", "'plain text"])(
    "flags %s as a formula-trigger token",
    (value) => {
      expect(isFormulaTriggerToken(value)).toBe(true);
    }
  );

  it.each(["12345-B-6", "", "   ", "ABC123"])(
    "does not flag %s",
    (value) => {
      expect(isFormulaTriggerToken(value)).toBe(false);
    }
  );

  it("checks only the first non-whitespace character, not the whole string", () => {
    expect(isFormulaTriggerToken("  =SUM(A1:A2)")).toBe(true);
    expect(isFormulaTriggerToken("A=B")).toBe(false);
  });
});
