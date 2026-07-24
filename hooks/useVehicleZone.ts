"use client";

import { useMemo } from "react";
import { useParkingRows } from "@/hooks/useParkingRows";
import { useAtelierRows } from "@/hooks/useAtelierRows";
import { useRdvRows } from "@/hooks/useRdvRows";
import { buildPlateVariants } from "@/lib/plateVariants";

export type VehicleZone = { inParking: boolean; inAtelier: boolean; inRdv: boolean };

/**
 * Whether `imm` currently exists as a live row in Parking, Atelier, and/or
 * RDV. All three are independent tabs, so any combination can be true at
 * once (a real data inconsistency worth surfacing, not hiding).
 *
 * Reuses the same useParkingRows()/useAtelierRows()/useRdvRows() react-query
 * cache the /parking, /atelier and /rdv pages already populate — free if any
 * was visited recently, otherwise triggers one fetch of each on first mount.
 * A dedicated "does IMM X exist" endpoint wouldn't reduce cost here: the
 * Sheets API has no server-side row filter, so getParkingRows()/
 * getAtelierRows()/getRdvRows() already read the full range regardless of
 * caller.
 */
export function useVehicleZone(imm: string): VehicleZone {
  const parkingRowsQuery = useParkingRows();
  const atelierRowsQuery = useAtelierRows();
  const rdvRowsQuery = useRdvRows();

  return useMemo(() => {
    const variants = new Set(buildPlateVariants(imm));
    return {
      inParking: !!parkingRowsQuery.data?.some((r) => variants.has(r.imm)),
      inAtelier: !!atelierRowsQuery.data?.some((r) => variants.has(r.imm)),
      inRdv: !!rdvRowsQuery.data?.some((r) => variants.has(r.matricule)),
    };
  }, [imm, parkingRowsQuery.data, atelierRowsQuery.data, rdvRowsQuery.data]);
}
