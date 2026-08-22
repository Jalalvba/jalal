// Resolving a vehicle's contract end date, server-side, from whatever source
// actually knows it.
//
// This exists because "Date de fin de contrat indisponible" was appearing on
// vehicles whose contract end we hold. Two independent reasons, both fixed
// here rather than at each call site:
//
//   1. The zone/BDD cards (AnalyseAndSaveButton) know a plate and nothing
//      else, so they sent contractEnd: null by construction — even for a
//      vehicle whose BDD row says "01/05/2028" two lines further up the same
//      card.
//   2. `cp` does not cover every vehicle. 71374-B-7 has a BDD row with a
//      contract end and NO cp document at all, so even DS History — which does
//      pass what cp gave it — had nothing to pass.
//
// Order: whatever the client sent (DS History already resolved it from the
// vehicle identity) > cp > the BDD sheet. Never invented: if no source has it,
// it stays null and the prompt's "indisponible" branch is the honest answer.

import { getCollection } from "@/lib/mongo/client";
import { getSheetRows } from "@/lib/sheets/googleSheetsBdd";
import { log } from "@/lib/http/logger";

/**
 * Parses the BDD sheet's dd/mm/yyyy into an ISO string.
 *
 * NOT `new Date(value)`: that reads "01/05/2028" as 5 January in a US locale
 * and 1 May in others, so the contract flag would silently shift by months
 * depending on where the code ran. Explicit or nothing.
 */
export function parseSheetDate(value: unknown): string | null {
  const s = String(value ?? "").trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * The contract end for one plate, or null when no source has one.
 *
 * Never throws: a lookup failure must not sink an analysis the user is waiting
 * on — it degrades to the same "indisponible" the data itself would produce.
 */
export async function resolveContractEnd(imm: string, fromClient: string | null): Promise<string | null> {
  if (fromClient) return fromClient;
  const plate = imm.trim();
  if (!plate) return null;

  try {
    const cp = await getCollection("cp");
    // `imm`, NOT `immatriculation`. cp is the one collection that names the
    // plate field differently — ds and parc use `immatriculation`, and
    // src/app/api/cp/route.ts has always matched on `imm`. Querying it with
    // the other spelling returns nothing, silently, for every vehicle: the
    // first version of this file did exactly that and the fallback looked like
    // "cp simply has no contract for these plates".
    const doc = await cp.findOne(
      { imm: plate, date_fin_contrat: { $ne: null } },
      { projection: { date_fin_contrat: 1 }, sort: { date_fin_contrat: -1 } }
    );
    const cpDate = doc?.date_fin_contrat;
    if (cpDate) return cpDate instanceof Date ? cpDate.toISOString() : String(cpDate);
  } catch (e) {
    log("warn", "contract-end", "cp lookup failed", { imm: plate, error: String(e) });
  }

  try {
    // The sheet read is cached like every other (60s), so this is not an extra
    // Sheets call per analysis in practice.
    const rows = await getSheetRows(plate);
    for (const row of rows) {
      const iso = parseSheetDate((row as Record<string, unknown>).date_fin_contrat);
      if (iso) return iso;
    }
  } catch (e) {
    log("warn", "contract-end", "BDD lookup failed", { imm: plate, error: String(e) });
  }

  return null;
}

/**
 * The vehicle's contract `statut` in cp — "Livré", "Arret facturation" or
 * "Restitué" (the only three values live, 5 673 / 4 546 / 11).
 *
 * Read for the Parking work order, where it decides whether any work should be
 * ordered at all: a vehicle whose billing has stopped is not one the workshop
 * should be booking operations on.
 *
 * Same contract as resolveContractEnd(): `imm`, not `immatriculation`, and
 * never throws — an unknown status simply means the prompt is not told one.
 */
export async function resolveCpStatus(imm: string): Promise<string | null> {
  const plate = imm.trim();
  if (!plate) return null;
  try {
    const cp = await getCollection("cp");
    const doc = await cp.findOne(
      { imm: plate, statut: { $ne: null } },
      { projection: { statut: 1 }, sort: { date_fin_contrat: -1 } }
    );
    const statut = doc?.statut;
    return statut ? String(statut).trim() : null;
  } catch (e) {
    log("warn", "contract-end", "cp statut lookup failed", { imm: plate, error: String(e) });
    return null;
  }
}
