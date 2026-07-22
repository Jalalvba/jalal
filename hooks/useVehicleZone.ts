"use client";

import { useMemo } from "react";
import { useParkingRows } from "@/hooks/useParkingRows";
import { useAtelierRows } from "@/hooks/useAtelierRows";
import { buildPlateVariants } from "@/lib/plateVariants";

export type VehicleZone = { inParking: boolean; inAtelier: boolean };

/**
 * Whether `imm` currently exists as a live row in Parking and/or Atelier.
 * Both are independent tabs, so both can be true at once (a real data
 * inconsistency worth surfacing, not hiding).
 *
 * Reuses the same useParkingRows()/useAtelierRows() react-query cache the
 * /parking and /atelier pages already populate — free if either was
 * visited recently, otherwise triggers one fetch of each on first mount.
 * A dedicated "does IMM X exist" endpoint wouldn't reduce cost here: the
 * Sheets API has no server-side row filter, so getParkingRows()/
 * getAtelierRows() already read the full range regardless of caller.
 */
export function useVehicleZone(imm: string): VehicleZone {
  const parkingRowsQuery = useParkingRows();
  const atelierRowsQuery = useAtelierRows();

  return useMemo(() => {
    const variants = new Set(buildPlateVariants(imm));
    return {
      inParking: !!parkingRowsQuery.data?.some((r) => variants.has(r.imm)),
      inAtelier: !!atelierRowsQuery.data?.some((r) => variants.has(r.imm)),
    };
  }, [imm, parkingRowsQuery.data, atelierRowsQuery.data]);
}
