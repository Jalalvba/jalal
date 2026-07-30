import { describe, expect, it } from "vitest";
import type { sheets_v4 } from "googleapis";
import { verifyRowIdentity, RowIdentityError } from "@/lib/googleSheetsClient";

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
