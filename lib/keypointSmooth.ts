/**
 * Lightweight temporal smoothing for pose keypoints (reduces jitter without heavy Kalman).
 */

export type SmoothPoint = { x: number; y: number; score?: number; name?: string };

export function smoothKeypointsEma(
  prev: SmoothPoint[] | null | undefined,
  next: SmoothPoint[],
  alpha: number,
): SmoothPoint[] {
  if (!prev || prev.length !== next.length) return next;
  const a = Math.max(0.05, Math.min(0.95, alpha));
  return next.map((p, i) => {
    const q = prev[i];
    if (!q || (p.score ?? 1) < 0.15 || (q.score ?? 1) < 0.15) return p;
    return {
      ...p,
      x: q.x * (1 - a) + p.x * a,
      y: q.y * (1 - a) + p.y * a,
    };
  });
}
