/**
 * "Scal" — in any case, as its own WORD anywhere in the value ("Scal Casa",
 * "SCAL AVIS") — is AVIS's OWN in-house workshop entity, not an outside
 * garage. Naming it means the work is internal, which cannot be true at the
 * same time as "external provider".
 *
 * Word-bounded, not a bare substring match: a plain /scal/i also matches
 * "Garage Pascal", "PASCAL AUTO", "Escale Auto", "GARAGE L'ESCALE" and
 * "Fiscal Services" — all real-shaped external garage names — and would
 * route them to ATELIER while telling the model the work is in-house.
 *
 * Extracted from src/lib/ai/dsAnalysis/workOrder.ts's fixedRoutingActions(),
 * which has decided routing this way since A0.0, so the work-order router and
 * the Commentaire reformulation cannot drift apart on what counts as in-house.
 */
export function isInHousePrestataire(prestataire: unknown): boolean {
  return /(?:^|[^A-Za-z0-9])scal(?:[^A-Za-z0-9]|$)/i.test(String(prestataire ?? ""));
}
