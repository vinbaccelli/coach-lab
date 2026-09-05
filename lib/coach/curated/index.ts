import type { CuratedCoachProfile } from './types';
import { vinbaccelli } from './vinbaccelli';

/**
 * Registry of curated coach profiles, keyed by slug.
 *
 * A slug in here renders the rich block layout and its curated content wins over
 * the `coach_profiles` row for that slug. Every slug NOT in here keeps the
 * original database-driven path unchanged — see the precedence note in
 * components/coach/CoachPublicProfile.tsx.
 *
 * Phase 2 replaces this map with persisted per-coach blocks; the renderer reads
 * the same `CuratedCoachProfile` shape either way.
 */
export const CURATED_PROFILES: Record<string, CuratedCoachProfile> = {
  vinbaccelli,
};

export function getCuratedProfile(slug: string): CuratedCoachProfile | undefined {
  return CURATED_PROFILES[slug];
}

export type { CuratedCoachProfile } from './types';
