import type { Entitlement } from '@/lib/entitlements';

/** Players a coach may have. Light = one (the player's own profile); trial, admin, Pro, Academy = no limit. */
export const LIGHT_PLAYER_LIMIT = 1;

export function playerLimit(ent: Pick<Entitlement, 'plan' | 'admin' | 'trial'>): number {
  if (ent.admin || ent.trial) return Infinity;
  return ent.plan === 'light' ? LIGHT_PLAYER_LIMIT : Infinity;
}

export const PLAYER_LIMIT_MESSAGE =
  'The Light plan includes one player profile. Upgrade to Pro to add more players.';
