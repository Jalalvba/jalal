/**
 * "Scal" — in any case, anywhere in the value ("Scal Casa", "SCAL AVIS") — is
 * AVIS's OWN in-house workshop entity, not an outside garage. Naming it means
 * the work is internal, which cannot be true at the same time as "external
 * provider".
 *
 * Extracted from src/lib/ai/dsAnalysis/workOrder.ts's fixedRoutingActions(),
 * which has decided routing this way since A0.0, so the work-order router and
 * the Commentaire reformulation cannot drift apart on what counts as in-house.
 */
export function isInHousePrestataire(prestataire: unknown): boolean {
  return /scal/i.test(String(prestataire ?? ""));
}
