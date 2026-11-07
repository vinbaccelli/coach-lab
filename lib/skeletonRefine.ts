/**
 * Baked-track post-processing entry point: validate joints, then smooth.
 *
 * TEMPORARY rollback/compare switch: set `localStorage['anglemotion:skeleton-legacy'] = '1'`
 * (or `window.__skeletonLegacy = true`) to run the previous smoothing-only path
 * on the next bake. Remove once the new path is accepted.
 */
import { smoothBakedTrack, type TrackSample } from './trackSmoothing';
import { validateTrack } from './skeletonValidate';

export const LEGACY_SKELETON_KEY = 'anglemotion:skeleton-legacy';

export function isLegacySkeleton(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if ((window as unknown as { __skeletonLegacy?: boolean }).__skeletonLegacy) return true;
    return window.localStorage.getItem(LEGACY_SKELETON_KEY) === '1';
  } catch { return false; }
}

export function refineBakedTrack(samples: TrackSample[], legacy: boolean = isLegacySkeleton()): TrackSample[] {
  if (legacy) return smoothBakedTrack(samples);
  return smoothBakedTrack(validateTrack(samples).samples);
}
