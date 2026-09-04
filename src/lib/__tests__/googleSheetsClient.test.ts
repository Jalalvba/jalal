import { describe, expect, it } from "vitest";
import type { sheets_v4 } from "googleapis";
import { verifyRowIdentity, RowIdentityError, isFormulaTriggerToken, isoDateToSerial } from "@/lib/sheets/googleSheetsClient";

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

describe("isoDateToSerial", () => {
  it("parses a real, in-range date to its correct serial", () => {
    // 2026-09-15 is the value already used as a worked example elsewhere in
    // this codebase's comments (serialToUTCDate's header).
    expect(isoDateToSerial("2026-09-15")).toBe(46280);
  });

  it.each([
    ["2026-02-31", "day 31 does not exist in February"],
    ["2026-13-45", "month 13 and day 45 both out of range"],
    ["2026-00-00", "month 0 and day 0 both out of range"],
    ["0001-01-01", "year outside the 1900-2200 window"],
  ])("rejects %s (%s) instead of rolling it over to a different date", (input) => {
    expect(isoDateToSerial(input)).toBeNull();
  });

  it("rejects a value that doesn't match the yyyy-mm-dd shape at all", () => {
    expect(isoDateToSerial("not-a-date")).toBeNull();
    expect(isoDateToSerial("15/09/2026")).toBeNull();
  });
});
