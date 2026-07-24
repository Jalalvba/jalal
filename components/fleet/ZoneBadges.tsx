import { Badge } from "@/components/ui/badge";
import type { VehicleZone } from "@/hooks/useVehicleZone";

// Colors deliberately distinct from ÉTAT (amber/blue) and FLAG_STYLE's
// palette (lib/types.ts) so this can't be confused with either at a glance.
// `inRdv` is optional (not just possibly-false) so app/rdv/page.tsx — whose
// own rows are trivially always "in RDV" — can omit it entirely rather than
// render a useless always-on badge for itself.
export function ZoneBadges({ inParking, inAtelier, inRdv }: Partial<VehicleZone>) {
  if (!inParking && !inAtelier && !inRdv) return null;
  return (
    <>
      {inParking && (
        <Badge className="bg-sky-500/10 text-sky-400 border-sky-500/20">Parking</Badge>
      )}
      {inAtelier && (
        <Badge className="bg-violet-500/10 text-violet-400 border-violet-500/20">Atelier</Badge>
      )}
      {inRdv && (
        <Badge className="bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/20">RDV</Badge>
      )}
    </>
  );
}
