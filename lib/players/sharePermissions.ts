/**
 * What a share link lets the player SEE and ADD, section by section. Enforced on the server by
 * every share route; the page only hides what the server would refuse anyway.
 *
 * Stored in player_shares.permissions (jsonb). When it is absent (old links, or before the column
 * exists) the link's mode decides: "view" = see the usual sections, add nothing; "edit" = see and
 * add everywhere except the sensitive Mental section, which is always off until the coach turns it on.
 */
import type { ShareMode } from '@/lib/players/share';

export const SEE_SECTIONS = ['technical', 'progress', 'biometrics', 'fitness', 'nutrition', 'workouts', 'mental', 'timeline'] as const;
export const ADD_KINDS = ['comments', 'pictures', 'videos', 'progress', 'biometrics', 'fitness', 'meals', 'workouts', 'questionnaires'] as const;
export type SeeSection = (typeof SEE_SECTIONS)[number];
export type AddKind = (typeof ADD_KINDS)[number];

export interface SharePermissions {
  see: Record<SeeSection, boolean>;
  add: Record<AddKind, boolean>;
}

export const SEE_LABELS: Record<SeeSection, string> = {
  technical: 'Technical sheet', progress: 'Progress', biometrics: 'Biometrics', fitness: 'Fitness',
  nutrition: 'Nutrition', workouts: 'Workouts', mental: 'Mental (private by default)', timeline: 'Timeline',
};
export const ADD_LABELS: Record<AddKind, string> = {
  comments: 'Comments', pictures: 'Pictures', videos: 'Videos', progress: 'Progress entries',
  biometrics: 'Biometrics (weight, height…)', fitness: 'Fitness entries', meals: 'Meals',
  workouts: 'Completed workouts', questionnaires: 'Questionnaire answers',
};

/** The section a kind of addition is shown in: adding into a hidden section makes no sense. */
export const ADD_SECTION: Partial<Record<AddKind, SeeSection>> = {
  comments: 'timeline', pictures: 'timeline', videos: 'timeline',
  progress: 'progress', biometrics: 'biometrics', fitness: 'fitness', meals: 'nutrition', workouts: 'workouts',
};

export function defaultPermissions(mode: ShareMode): SharePermissions {
  const see = Object.fromEntries(SEE_SECTIONS.map((s) => [s, s !== 'mental'])) as Record<SeeSection, boolean>;
  const add = Object.fromEntries(ADD_KINDS.map((k) => [k, mode === 'edit'])) as Record<AddKind, boolean>;
  return { see, add };
}

/**
 * The permissions in force: stored values over the mode's defaults, unknown keys ignored, nothing
 * addable on a view link, and nothing addable into a section the player cannot see.
 */
export function resolvePermissions(mode: ShareMode, stored: unknown): SharePermissions {
  const out = defaultPermissions(mode);
  const raw = (stored && typeof stored === 'object' ? stored : {}) as { see?: Record<string, unknown>; add?: Record<string, unknown> };
  for (const s of SEE_SECTIONS) if (typeof raw.see?.[s] === 'boolean') out.see[s] = raw.see[s] as boolean;
  for (const k of ADD_KINDS) if (typeof raw.add?.[k] === 'boolean') out.add[k] = raw.add[k] as boolean;
  for (const k of ADD_KINDS) {
    if (mode !== 'edit') out.add[k] = false;
    const section = ADD_SECTION[k];
    if (section && !out.see[section]) out.add[k] = false;
  }
  return out;
}

/** Clean a permissions object from a request body (only known keys, only booleans). */
export function cleanPermissionsInput(raw: unknown): { see: Partial<Record<SeeSection, boolean>>; add: Partial<Record<AddKind, boolean>> } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { see?: Record<string, unknown>; add?: Record<string, unknown> };
  const see: Partial<Record<SeeSection, boolean>> = {};
  const add: Partial<Record<AddKind, boolean>> = {};
  for (const s of SEE_SECTIONS) if (typeof r.see?.[s] === 'boolean') see[s] = r.see[s] as boolean;
  for (const k of ADD_KINDS) if (typeof r.add?.[k] === 'boolean') add[k] = r.add[k] as boolean;
  return { see, add };
}

/** Which "add" permission a tracker category needs. */
export function addKindForCategory(category: string): AddKind | null {
  if (category === 'progress' || category === 'other') return 'progress';
  if (category === 'biometrics') return 'biometrics';
  if (category === 'fitness') return 'fitness';
  return null;
}
export function seeSectionForCategory(category: string): SeeSection | null {
  if (category === 'progress' || category === 'other') return 'progress';
  if (category === 'biometrics' || category === 'fitness' || category === 'technical' || category === 'nutrition' || category === 'mental') return category;
  return null;
}
