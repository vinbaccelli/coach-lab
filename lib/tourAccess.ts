/**
 * Which tours a coach is offered. A tour about a Pro tool names its feature;
 * this adapter decides.
 *
 * For now it always returns true: the plan gating lives on
 * claude/pricing-launch (PR #65), and the tours must not depend on it. Once
 * #65 merges, this becomes `canUse(feature, entitlement)` from
 * lib/entitlements.ts (fed by lib/useEntitlement.ts), so a Light coach is not
 * walked through a tool that will show them the upgrade sheet.
 */
export function tourAccess(feature: string | undefined): boolean {
  void feature;
  return true;
}
