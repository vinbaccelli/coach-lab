/**
 * Baked-track post-processing entry point: validate joints, then smooth.
 *
 * TEMPORARY rollback/compare switch: set `localStorage['anglemotion:skeleton-legacy'] = '1'`
 * (or `window.__skeletonLegacy = true`) to run the previous smoothing-only path
 * on the next bake. Remove once the new path is accepted.
 */
import { smoothBakedTrack, type TrackSample } from './trackSmoothing';
import { validateTrack } from './skeletonValidate';
import { poseDbg } from './tempDebugPose'; // TEMP-DEBUG-POSE: shows the bake report in the ?debug=1 panel

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
  const v = validateTrack(samples);
  const kept = v.report.droppedFrames ? v.samples.filter((_, i) => !v.dropped[i]) : v.samples;
  const r = v.report;
  poseDbg.event(`bake: ${r.samples} frames · swaps fixed ${r.swapsFixed} · frames dropped ${r.droppedFrames} · joints hidden ${r.invalidLowScore + r.invalidOutlier + r.invalidBone}`); // TEMP-DEBUG-POSE
  return smoothBakedTrack(kept);
}
