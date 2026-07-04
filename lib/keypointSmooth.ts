/**
 * Temporal smoothing for pose keypoints.
 *
 * One Euro filter (Casiez et al.) — the standard for realtime pose tracking:
 * speed-adaptive cutoff means heavy smoothing when a joint is nearly still
 * (no jitter) and almost no smoothing when it moves fast (no lag on a swing).
 * Fixed-alpha EMA is kept for callers that want it, but the live skeleton
 * uses the One Euro smoother.
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

// ── One Euro filter ─────────────────────────────────────────────────────────

interface OneEuroChannel {
  xPrev: number;
  dxPrev: number;
  initialized: boolean;
}

function lowpassAlpha(cutoff: number, dtSec: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dtSec);
}

export interface OneEuroParams {
  /** Baseline cutoff (Hz). Lower = smoother at rest. */
  minCutoff: number;
  /** Speed coefficient. Higher = follows fast motion more tightly. */
  beta: number;
  /** Derivative low-pass cutoff (Hz). */
  dCutoff: number;
}

/** Tuned for sport video: steady at rest, minimal lag on racket-speed motion. */
export const SPORT_ONE_EURO: OneEuroParams = { minCutoff: 1.2, beta: 0.7, dCutoff: 1.0 };

/**
 * Stateful per-keypoint One Euro smoother for a fixed keypoint layout
 * (e.g. MoveNet's 17). Call `apply` with each new sample + timestamp; call
 * `reset` when the video seeks or the subject changes so the pose snaps.
 */
export class OneEuroKeypointSmoother {
  private channels = new Map<string, { x: OneEuroChannel; y: OneEuroChannel }>();
  private lastTs: number | null = null;
  private params: OneEuroParams;

  constructor(params: OneEuroParams = SPORT_ONE_EURO) {
    this.params = params;
  }

  reset() {
    this.channels.clear();
    this.lastTs = null;
  }

  apply(points: SmoothPoint[], tsMs: number): SmoothPoint[] {
    const dtSec = this.lastTs != null ? Math.max(1e-3, (tsMs - this.lastTs) / 1000) : 1 / 30;
    this.lastTs = tsMs;
    // A long gap (pause, seek, tab switch) means the old state is stale — snap.
    if (dtSec > 0.5) {
      this.channels.clear();
      return points;
    }

    return points.map((p, i) => {
      if ((p.score ?? 1) < 0.15) return p;
      const key = p.name || String(i);
      let ch = this.channels.get(key);
      if (!ch) {
        ch = {
          x: { xPrev: p.x, dxPrev: 0, initialized: true },
          y: { xPrev: p.y, dxPrev: 0, initialized: true },
        };
        this.channels.set(key, ch);
        return p;
      }
      return {
        ...p,
        x: this.filterChannel(ch.x, p.x, dtSec),
        y: this.filterChannel(ch.y, p.y, dtSec),
      };
    });
  }

  private filterChannel(ch: OneEuroChannel, value: number, dtSec: number): number {
    const { minCutoff, beta, dCutoff } = this.params;
    const dx = (value - ch.xPrev) / dtSec;
    const aD = lowpassAlpha(dCutoff, dtSec);
    const dxHat = ch.dxPrev + aD * (dx - ch.dxPrev);
    const cutoff = minCutoff + beta * Math.abs(dxHat);
    const a = lowpassAlpha(cutoff, dtSec);
    const xHat = ch.xPrev + a * (value - ch.xPrev);
    ch.xPrev = xHat;
    ch.dxPrev = dxHat;
    return xHat;
  }
}
