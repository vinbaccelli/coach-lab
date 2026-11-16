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

import { LEGACY_KEY, legacyOn } from './skeletonSwitches';

export const LEGACY_SKELETON_KEY = LEGACY_KEY;

/** True ⇒ previous skeleton behaviour (URL `?legacy=1`, localStorage, or window flag). */
export const isLegacySkeleton = legacyOn;

export function refineBakedTrack(samples: TrackSample[], legacy: boolean = isLegacySkeleton()): TrackSample[] {
  if (legacy) return smoothBakedTrack(samples);
  const v = validateTrack(samples);
  const kept = v.report.droppedFrames ? v.samples.filter((_, i) => !v.dropped[i]) : v.samples;
  const r = v.report;
  poseDbg.event(`bake: ${r.samples} frames · swaps fixed ${r.swapsFixed} · frames dropped ${r.droppedFrames} · joints hidden ${r.invalidLowScore + r.invalidOutlier + r.invalidBone} (low-score ${r.invalidLowScore} / outlier ${r.invalidOutlier} / bone ${r.invalidBone})`); // TEMP-DEBUG-POSE
  return smoothBakedTrack(kept);
}
