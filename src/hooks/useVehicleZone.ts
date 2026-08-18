"use client";

import { useMemo } from "react";
import { useParkingRows } from "@/hooks/useParkingRows";
import { useAtelierRows } from "@/hooks/useAtelierRows";
import { useRdvRows } from "@/hooks/useRdvRows";
import { useDepotRows } from "@/hooks/useDepotRows";
import { buildPlateVariants } from "@/lib/plateVariants";

export type VehicleZone = { inParking: boolean; inAtelier: boolean; inRdv: boolean; inDepot: boolean };

/**
 * Whether `imm` currently exists as a live row in Parking, Atelier, RDV,
 * and/or DEPOT. All four are independent tabs, so any combination can be
 * true at once (a real data inconsistency worth surfacing, not hiding).
 *
 * Reuses the same useParkingRows()/useAtelierRows()/useRdvRows()/
 * useDepotRows() react-query cache other pages already populate — free if
 * any was visited recently, otherwise triggers one fetch of each on first
 * mount. A dedicated "does IMM X exist" endpoint wouldn't reduce cost here:
 * the Sheets API has no server-side row filter, so getParkingRows()/
 * getAtelierRows()/getRdvRows()/getDepotRows() already read the full range
 * regardless of caller. (DEPOT used to have its own lightweight
 * plates-only read before it got a full page — now that getDepotRows()
 * covers the same column anyway, this checks that instead of keeping two
 * separate reads of the same tab.)
 */
export function useVehicleZone(imm: string): VehicleZone {
  const parkingRowsQuery = useParkingRows();
  const atelierRowsQuery = useAtelierRows();
  const rdvRowsQuery = useRdvRows();
  const depotRowsQuery = useDepotRows();

  return useMemo(() => {
    const variants = new Set(buildPlateVariants(imm));
    return {
      inParking: !!parkingRowsQuery.data?.some((r) => variants.has(r.imm)),
      inAtelier: !!atelierRowsQuery.data?.some((r) => variants.has(r.imm)),
      inRdv: !!rdvRowsQuery.data?.some((r) => variants.has(r.matricule)),
      inDepot: !!depotRowsQuery.data?.some((r) => variants.has(r.imm)),
    };
  }, [imm, parkingRowsQuery.data, atelierRowsQuery.data, rdvRowsQuery.data, depotRowsQuery.data]);
}
