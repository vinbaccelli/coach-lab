/**
 * Live skeleton angle rows (data column): pure computation.
 *
 * A joint angle that cannot be measured is `null` — never 0. (0° is a real,
 * fully-folded joint; showing it for "unknown" misleads coaches.)
 * Vertex indices are COCO-17 (the displayed pose): L/R elbow and knee.
 */
export interface AngleKp { x: number; y: number; score: number }
export interface SkeletonAngle { label: string; deg: number | null }

export const SKELETON_ANGLE_DEFS: ReadonlyArray<{ indices: readonly [number, number, number]; label: string }> = [
  { indices: [7, 5, 9], label: 'L Elbow' },
  { indices: [8, 6, 10], label: 'R Elbow' },
  { indices: [13, 11, 15], label: 'L Knee' },
  { indices: [14, 12, 16], label: 'R Knee' },
];
export const SKELETON_ANGLE_LABELS = SKELETON_ANGLE_DEFS.map((d) => d.label);
export const ANGLE_SCORE_MIN = 0.2;

/** Angle at `vertex` between rays to `a` and `b`, in whole degrees; null if any point is missing/low-confidence/non-finite or the rays are degenerate. */
export function angleAtVertex(
  vertex: AngleKp | undefined | null,
  a: AngleKp | undefined | null,
  b: AngleKp | undefined | null,
  scoreMin = ANGLE_SCORE_MIN,
): number | null {
  if (!vertex || !a || !b) return null;
  if (!(vertex.score >= scoreMin) || !(a.score >= scoreMin) || !(b.score >= scoreMin)) return null;
  const v1x = a.x - vertex.x, v1y = a.y - vertex.y;
  const v2x = b.x - vertex.x, v2y = b.y - vertex.y;
  const mag = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (!Number.isFinite(mag) || mag < 1) return null;
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / mag));
  return Math.round((Math.acos(cos) * 180) / Math.PI);
}

/** Always returns the four labels, in order; unmeasurable ones are null. */
export function computeSkeletonAngles(kps: ReadonlyArray<AngleKp | undefined | null> | null | undefined): SkeletonAngle[] {
  return SKELETON_ANGLE_DEFS.map(({ indices: [vi, ai, bi], label }) => ({
    label,
    deg: kps ? angleAtVertex(kps[vi], kps[ai], kps[bi]) : null,
  }));
}

export const hasAnyAngle = (angles: ReadonlyArray<SkeletonAngle>) => angles.some((a) => a.deg != null);

/** Text for a data-column row: dash when unknown. */
export const formatAngleValue = (deg: number | null | undefined, unit = '°') => (deg == null ? '–' : `${deg}${unit}`);

/**
 * Rows that may be persisted (snapshots, stored analysis, exports): live
 * `skeleton-angle` rows are LIVE-mode only and never stored, and a row without
 * a numeric value can't be stored either. Narrows `value` to number.
 */
export function persistableRows<T extends { type: string; value: number | null }>(col: readonly T[]): Array<T & { value: number }> {
  return col.filter((m): m is T & { value: number } => m.type !== 'skeleton-angle' && m.value != null);
}
