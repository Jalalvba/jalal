/**
 * Single source of truth for each zone's accent color — consumed by
 * ZoneBadges, each list page's ListPageHeader accent/count classes, Home's
 * NavCard, and Suivi RL's own card. One color per zone, reused (not
 * duplicated) everywhere that zone is represented, so the three can't drift
 * out of sync the way Atelier's ZoneBadges entry and BDD's Home nav card
 * previously did.
 *
 * Class strings are kept fully literal (no template-string hue
 * interpolation) so Tailwind's content scanner can find them statically.
 */
export const ZONE_COLORS = {
  parking: {
    accentText: "text-sky-400",
    count: "border-sky-500/20 bg-sky-500/10 text-sky-400",
    badge: "bg-sky-500/10 text-sky-400 border-sky-500/20",
    navDot: "bg-sky-500",
  },
  atelier: {
    accentText: "text-amber-400",
    count: "border-amber-500/20 bg-amber-500/10 text-amber-400",
    badge: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    navDot: "bg-amber-400",
  },
  depot: {
    accentText: "text-lime-400",
    count: "border-lime-500/20 bg-lime-500/10 text-lime-400",
    badge: "bg-lime-500/10 text-lime-400 border-lime-500/20",
    navDot: "bg-lime-500",
  },
  bdd: {
    accentText: "text-violet-400",
    count: "border-violet-500/20 bg-violet-500/10 text-violet-400",
    badge: "bg-violet-500/10 text-violet-400 border-violet-500/20",
    navDot: "bg-violet-500",
  },
  rdv: {
    accentText: "text-fuchsia-400",
    count: "border-fuchsia-500/20 bg-fuchsia-500/10 text-fuchsia-400",
    badge: "bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/20",
    navDot: "bg-fuchsia-500",
  },
} as const;
