/**
 * Which tabs a client's share link shows. Every section the link MAY see gets its tab, in the profile's
 * order, even when nothing has been added yet (the page then says so): a link that showed only the tabs that
 * already had data looked broken to the coach ("it only has Timeline, Overview and Nutrition").
 * The Blueprint tab is on the link when the share response carries the player's Blueprint (read-only, with the Technical section).
 */
import type { SeeSection } from '@/lib/players/sharePermissions';

export type SharedTabId = 'timeline' | 'overview' | 'technical' | 'blueprint' | 'progress' | 'biometrics' | 'fitness' | 'nutrition';

export function sharedTabIds(see: Partial<Record<SeeSection, boolean>> | undefined, opts?: { blueprint?: boolean }): SharedTabId[] {
  const out: SharedTabId[] = ['overview'];
  if (see?.timeline ?? true) out.push('timeline');
  if (see?.technical ?? true) {
    out.push('technical');
    if (opts?.blueprint) out.push('blueprint');
  }
  if (see?.progress ?? true) out.push('progress');
  if (see?.biometrics ?? true) out.push('biometrics');
  if (see?.fitness ?? true) out.push('fitness');
  if (see?.nutrition) out.push('nutrition');
  return out;
}
