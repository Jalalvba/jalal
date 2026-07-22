import { Badge } from "@/components/ui/badge";
import type { VehicleZone } from "@/hooks/useVehicleZone";

// Colors deliberately distinct from ÉTAT (amber/blue) and FLAG_STYLE's
// palette (lib/types.ts) so this can't be confused with either at a glance.
export function ZoneBadges({ inParking, inAtelier }: VehicleZone) {
  if (!inParking && !inAtelier) return null;
  return (
    <>
      {inParking && (
        <Badge className="bg-sky-500/10 text-sky-400 border-sky-500/20">Parking</Badge>
      )}
      {inAtelier && (
        <Badge className="bg-violet-500/10 text-violet-400 border-violet-500/20">Atelier</Badge>
      )}
    </>
  );
}
