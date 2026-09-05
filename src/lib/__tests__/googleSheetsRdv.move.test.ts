import { describe, expect, it, vi, beforeEach } from "vitest";

// Same pattern as googleSheetsBdd.test.ts / googleSheetsRdvMonthly.test.ts:
// withCache mocked to a passthrough (no Next runtime here), getSheetsClient
// mocked so the flat-tab half of moveRdvRow() can be driven directly.
vi.mock("@/lib/sheets/googleSheetsClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sheets/googleSheetsClient")>("@/lib/sheets/googleSheetsClient");
  return {
    ...actual,
    getSheetsClient: vi.fn(),
    withCache: (_key: string, _ttlMs: number, fn: () => unknown) => fn(),
    invalidateCache: vi.fn(),
  };
});

// The monthly-tab move itself is covered directly (composition, ordering,
// duplicate case) in googleSheetsRdvMonthly.test.ts — mocked here so this
// file can test moveRdvRow()'s OWN job in isolation: what it does with
// moveAppointment()'s result, and the flat-mirror dual-write on top of it.
vi.mock("@/lib/sheets/googleSheetsRdvMonthly", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sheets/googleSheetsRdvMonthly")>("@/lib/sheets/googleSheetsRdvMonthly");
  return {
    ...actual,
    moveAppointment: vi.fn(),
  };
});

import { getSheetsClient, isoDateToSerial } from "@/lib/sheets/googleSheetsClient";
import { moveAppointment } from "@/lib/sheets/googleSheetsRdvMonthly";
import { moveRdvRow } from "@/lib/sheets/googleSheetsRdv";
import type { RdvAddInput, MonthlyMoveResult } from "@/types";

const mockedGetSheetsClient = vi.mocked(getSheetsClient);
const mockedMoveAppointment = vi.mocked(moveAppointment);

const IDENTITY: RdvAddInput = {
  date: "2026-07-10",
  heure: "10h",
  clients: "Client Test",
  vehicule: "Clio",
  matricule: "12345-B-6",
  intervention: "Révision",
  contact: "0600000000",
  convoyeur: "Ahmed",
};

const NEW_DATE = "2026-07-20";
const HEADER_ROW = ["Date", "Heure", "Clients", "Véhicule", "Matricule", "Intervention", "Contact", "CONVOYEUR"];

/** Flat "RDV" tab: header + one data row whose content matches IDENTITY (still at the OLD date, since the flat mirror hasn't been updated yet at the point moveRdvRow reads it). */
function buildFlatTabValues(): unknown[][] {
  const oldSerial = isoDateToSerial(IDENTITY.date)!;
  return [
    HEADER_ROW,
    [oldSerial, IDENTITY.heure, IDENTITY.clients, IDENTITY.vehicule, IDENTITY.matricule, IDENTITY.intervention, IDENTITY.contact, IDENTITY.convoyeur],
  ];
}

function fakeFlatSheets(values: unknown[][], updateImpl?: (args: { requestBody: { values: (string | number)[][] } }) => Promise<unknown>) {
  const valuesGet = vi.fn().mockImplementation(({ range }: { range: string }) => {
    if (range.includes("A1:H1")) return Promise.resolve({ data: { values: [HEADER_ROW] } });
    return Promise.resolve({ data: { values: values.slice(1) } }); // A2:H — data rows only
  });
  const valuesUpdate = vi.fn(updateImpl ?? (() => Promise.resolve({})));
  const sheets = {
    spreadsheets: {
      get: vi.fn().mockResolvedValue({ data: { sheets: [{ properties: { title: "RDV", sheetId: 1, gridProperties: { rowCount: values.length } } }] } }),
      values: { get: valuesGet, update: valuesUpdate },
    },
  };
  return { sheets, valuesGet, valuesUpdate };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("moveRdvRow — orchestration on top of moveAppointment", () => {
  it("aborts before touching the flat mirror when the monthly-tab move fails", async () => {
    const failure: MonthlyMoveResult = { moved: false, error: "Aucun bloc trouvé pour cette date." };
    mockedMoveAppointment.mockResolvedValue(failure);

    const result = await moveRdvRow(IDENTITY, NEW_DATE);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(failure.error);
      expect(result.duplicate).toBeUndefined();
    }
    expect(mockedGetSheetsClient).not.toHaveBeenCalled();
  });

  it("propagates the duplicate flag when the monthly-tab move reports one, without touching the flat mirror", async () => {
    const duplicate: MonthlyMoveResult = {
      moved: false,
      duplicate: true,
      error: 'Le rendez-vous a été copié vers "Juillet 2026" (ligne 5) mais l\'ancien créneau à "Juillet 2026" ligne 2 n\'a pas pu être effacé — il existe maintenant à deux endroits.',
    };
    mockedMoveAppointment.mockResolvedValue(duplicate);

    const result = await moveRdvRow(IDENTITY, NEW_DATE);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.duplicate).toBe(true);
      expect(result.error).toContain("Juillet 2026");
      expect(result.error).toContain("ligne 5");
      expect(result.error).toContain("ligne 2");
    }
    // The duplicate is a monthly-tab-level partial failure — moveRdvRow must
    // not compound it by touching the flat mirror on top of it.
    expect(mockedGetSheetsClient).not.toHaveBeenCalled();
  });

  it("updates the flat mirror's Date cell after a successful monthly-tab move", async () => {
    mockedMoveAppointment.mockResolvedValue({ moved: true, tab: "Juillet 2026", row: 5 });
    const { sheets, valuesUpdate } = fakeFlatSheets(buildFlatTabValues());
    mockedGetSheetsClient.mockReturnValue(sheets as never);

    const result = await moveRdvRow(IDENTITY, NEW_DATE);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.flatTab.written).toBe(true);
      expect(result.warning).toBeUndefined();
    }
    expect(valuesUpdate).toHaveBeenCalledTimes(1);
    const call = valuesUpdate.mock.calls[0][0];
    expect(call.requestBody.values[0][0]).toBe(isoDateToSerial(NEW_DATE));
  });

  it("degrades to a warning (not a hard failure) when the flat mirror update fails twice", async () => {
    mockedMoveAppointment.mockResolvedValue({ moved: true, tab: "Juillet 2026", row: 5 });
    const { sheets, valuesUpdate } = fakeFlatSheets(buildFlatTabValues(), () => Promise.reject(new Error("Sheets API down")));
    mockedGetSheetsClient.mockReturnValue(sheets as never);

    const result = await moveRdvRow(IDENTITY, NEW_DATE);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.flatTab.written).toBe(false);
      expect(result.warning).toMatch(/mise à jour du miroir/i);
    }
    // Retried once — two attempts, not more, not fewer.
    expect(valuesUpdate).toHaveBeenCalledTimes(2);
  });
});
