// Vehicle ownership, read from the spreadsheet's own `parc` tab.
//
// This is NOT the Mongo `parc` collection. The two are different exports of
// the fleet and they disagree on exactly the point that matters here: the
// sheet tab carries a **Société** column (LOCAFINANCE 2848, PLF 659, AVIS 424,
// PSD 35, Divers 33) which the Mongo import does not map at all, and Mongo's
// `locataire` is NOT a stand-in for it — the AVIS-owned plates read
// "Locafinance" there (checked plate by plate, e.g. 89869-E-1, 88369-E-1).
// Using locataire as a proxy would label AVIS's own vehicles as a leasing
// company's.
//
// Why it matters: an AVIS-owned vehicle (short-term rental fleet) is handled
// differently from a customer's leased one, and 766 of the tab's rows have an
// EMPTY Client with the owner recorded only in Société. The PARKING tab's own
// CLIENT column is an XLOOKUP into this tab's Client column, so those vehicles
// show up on the page with no client at all until this fallback runs.

import { getSheetsClient, withCache, ROWS_CACHE_TTL_MS } from "@/lib/sheets/googleSheetsClient";

const PARC_TAB = "parc";
const CACHE_KEY = "rows:parc-owners";

// Verified against the live header row: ID, Société, Client, Marque, Modèle,
// Immatriculation, ... Read by NAME below rather than by these positions —
// they are here to say what the range covers, not to be trusted.
//
// OPEN-ENDED on purpose. The first version capped this at row 5000 and the tab
// is bigger than that: 43 of the 83 Parking plates fell past the cut and came
// back with no owner at all, which read as "the fallback does not work". A row
// limit on a tab that grows is a bug with a timer on it.
const RANGE = `'${PARC_TAB}'!A:F`;

export type VehicleOwner = {
  /** The Client column — the customer, when there is one. */
  client: string;
  /** The Société column — who owns the vehicle. */
  societe: string;
  /**
   * The name to show: Client when set, otherwise Société. A vehicle with no
   * customer still has an owner, and showing an empty cell for 766 rows is
   * worse than showing the owner.
   */
  display: string;
  /**
   * AVIS's own fleet — short-term rental. Matched on either field because the
   * value appears as both "AVIS" (Société) and "Scal Avis" (Locataire), and a
   * vehicle is no less AVIS's for being recorded in the other column.
   */
  isAvis: boolean;
};

const AVIS_RE = /\b(avis|scal)\b/i;

export function classifyOwner(client: unknown, societe: unknown): VehicleOwner {
  const c = String(client ?? "").trim();
  const s = String(societe ?? "").trim();
  return {
    client: c,
    societe: s,
    display: c || s,
    isAvis: AVIS_RE.test(c) || AVIS_RE.test(s),
  };
}

/**
 * plate -> owner, for the whole tab. One read per cache window, shared by
 * every caller: this is ~4 000 rows and a per-plate lookup would be a Sheets
 * call per vehicle on a page rendering 84 of them.
 */
export async function getParcOwners(fresh = false): Promise<Map<string, VehicleOwner>> {
  return withCache(
    CACHE_KEY,
    ROWS_CACHE_TTL_MS,
    async () => {
      const sheets = getSheetsClient();
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.GOOGLE_SHEETS_ID!,
        range: RANGE,
      });
      const values = res.data.values ?? [];
      if (values.length === 0) return new Map<string, VehicleOwner>();

      const headers = values[0].map((h) => String(h ?? "").trim().toLowerCase());
      const idx = (name: string) => headers.findIndex((h) => h === name);
      const iSociete = idx("société");
      const iClient = idx("client");
      const iImm = idx("immatriculation");
      // Read by name, and refuse to guess: a renamed column must produce an
      // empty map (every vehicle simply unknown) rather than silently reading
      // whatever now sits in that position and attributing it to the wrong
      // field.
      if (iImm < 0 || (iSociete < 0 && iClient < 0)) return new Map<string, VehicleOwner>();

      const map = new Map<string, VehicleOwner>();
      for (let i = 1; i < values.length; i++) {
        const row = values[i];
        const imm = String(row[iImm] ?? "").trim().toUpperCase();
        if (!imm) continue;
        map.set(imm, classifyOwner(iClient >= 0 ? row[iClient] : "", iSociete >= 0 ? row[iSociete] : ""));
      }
      return map;
    },
    { bypass: fresh }
  );
}

/** One plate's owner, or null when the tab does not know it. */
export async function getVehicleOwner(imm: string): Promise<VehicleOwner | null> {
  const plate = imm.trim().toUpperCase();
  if (!plate) return null;
  return (await getParcOwners()).get(plate) ?? null;
}
