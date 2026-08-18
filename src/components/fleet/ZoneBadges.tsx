import { Badge } from "@/components/ui/badge";
import type { VehicleZone } from "@/hooks/useVehicleZone";
import { ZONE_COLORS } from "@/config/zones";

// Colors come from src/config/zones.ts, the single source of truth shared
// with each zone's own page accent and Home's NavCard. Deliberately distinct
// from ÉTAT (green/yellow/red/gray) and FLAG_STYLE's palette (src/types/index.ts)
// so this can't be confused with either at a glance.
// `inRdv`/`inDepot` are optional (not just possibly-false) so a caller whose
// own rows are trivially always "in" that zone — as the now-removed
// standalone RDV page's cards were — can omit it entirely rather than
// render a useless always-on badge for itself.
export function ZoneBadges({ inParking, inAtelier, inRdv, inDepot }: Partial<VehicleZone>) {
  if (!inParking && !inAtelier && !inRdv && !inDepot) return null;
  return (
    <>
      {inParking && <Badge className={ZONE_COLORS.parking.badge}>Parking</Badge>}
      {inAtelier && <Badge className={ZONE_COLORS.atelier.badge}>Atelier</Badge>}
      {inRdv && <Badge className={ZONE_COLORS.rdv.badge}>RDV</Badge>}
      {inDepot && <Badge className={ZONE_COLORS.depot.badge}>Dépôt</Badge>}
    </>
  );
}
