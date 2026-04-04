/**
 * Ball trail module for Coach Lab.
 *
 * Trail points are stored in normalized coordinates (0–1) with a video timestamp.
 * The visible trail is determined by `currentTime` — only points within the last
 * `trailDuration` seconds are rendered, with older points fading out.
 *
 * Usage:
 *   const state = createBallTrailState();
 *   enableBallTrail(state);
 *   // on user click:
 *   addBallPoint(state, nx, ny, video.currentTime);
 *   // in rAF loop:
 *   drawBallTrail(ctx, state, video.currentTime, canvasWidth, canvasHeight);
 */

export interface TrailPoint {
  /** Normalized x position (0 = left, 1 = right) */
  nx: number;
  /** Normalized y position (0 = top, 1 = bottom) */
  ny: number;
  /** Video timestamp (seconds) when this point was recorded */
  time: number;
}

export interface BallTrailState {
  points: TrailPoint[];
  enabled: boolean;
  /** Maximum number of stored points (oldest are dropped) */
  maxPoints: number;
  /** How many seconds of trail history to display */
  trailDuration: number;
}

export function createBallTrailState(): BallTrailState {
  return {
    points: [],
    enabled: false,
    maxPoints: 150,
    trailDuration: 1.5,
  };
}

export function enableBallTrail(state: BallTrailState): void {
  state.enabled = true;
}

export function disableBallTrail(state: BallTrailState): void {
  state.enabled = false;
}

/** Clear all recorded trail points but keep the trail enabled. */
export function resetBallTrail(state: BallTrailState): void {
  state.points = [];
}

/**
 * Record a ball position at a given video timestamp.
 * Oldest points are automatically dropped when `maxPoints` is exceeded.
 */
export function addBallPoint(
  state: BallTrailState,
  nx: number,
  ny: number,
  time: number,
): void {
  state.points.push({ nx, ny, time });
  if (state.points.length > state.maxPoints) {
    state.points.shift();
  }
}

/**
 * Render the ball trail onto a 2D canvas context.
 *
 * Segments age based on how far in the past they are relative to `currentTime`.
 * Color shifts from bright yellow (fresh) to orange (older), fading to transparent.
 *
 * @param ctx         The 2D rendering context of the overlay canvas.
 * @param state       Current ball trail state.
 * @param currentTime Current video playback time in seconds.
 * @param width       Pixel width of the canvas.
 * @param height      Pixel height of the canvas.
 */
export function drawBallTrail(
  ctx: CanvasRenderingContext2D,
  state: BallTrailState,
  currentTime: number,
  width: number,
  height: number,
): void {
  if (!state.enabled || state.points.length === 0) return;

  // Show ALL recorded points permanently (no time-gate).
  // Points near the current video time are shown fully opaque; older ones fade
  // gently but never disappear entirely so the full trajectory stays visible.
  const visible = state.points;

  if (visible.length < 2) {
    if (visible.length === 1) {
      const p = visible[0];
      ctx.save();
      ctx.fillStyle = 'rgba(255, 220, 50, 0.9)';
      ctx.shadowColor = 'rgba(255, 200, 0, 0.8)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.nx * width, p.ny * height, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    return;
  }

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Draw each trail segment; recent segments (near currentTime) appear brighter
  for (let i = 1; i < visible.length; i++) {
    const prev = visible[i - 1];
    const curr = visible[i];

    const age = Math.abs(currentTime - curr.time);
    // Min alpha 0.35 so old points are still clearly visible
    const alpha = Math.max(0.35, 1 - age / Math.max(state.trailDuration, 5));

    const green = Math.round(220 * alpha + 80 * (1 - alpha));
    ctx.strokeStyle = `rgba(255, ${green}, 0, ${alpha})`;
    ctx.lineWidth = Math.max(2, 5 * alpha);
    ctx.shadowColor = `rgba(255, ${green}, 0, ${alpha * 0.6})`;
    ctx.shadowBlur = 4 * alpha;

    ctx.beginPath();
    ctx.moveTo(prev.nx * width, prev.ny * height);
    ctx.lineTo(curr.nx * width, curr.ny * height);
    ctx.stroke();
  }

  // Draw glowing dot at every point, and a bigger one at the most recent
  for (const p of visible) {
    const age = Math.abs(currentTime - p.time);
    const alpha = Math.max(0.35, 1 - age / Math.max(state.trailDuration, 5));
    ctx.shadowColor = 'rgba(255, 200, 0, 0.9)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = `rgba(255, 220, 50, ${alpha * 0.85})`;
    ctx.beginPath();
    ctx.arc(p.nx * width, p.ny * height, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Highlight the latest point with a larger glowing dot
  const latest = visible[visible.length - 1];
  if (latest) {
    ctx.shadowColor = 'rgba(255, 200, 0, 0.9)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = 'rgba(255, 220, 50, 0.95)';
    ctx.beginPath();
    ctx.arc(latest.nx * width, latest.ny * height, 8, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
