/**
 * Which drag a press on the timeline starts when a Motion Layer frame stop sits
 * under the playhead ball (pure; used by components/PreciseTimeline.tsx).
 *
 * The playhead ball takes no pointer events and the 14 px frame-stop ball is
 * drawn on top of it, so whenever the playhead rests on a frame stop — a fresh
 * Motion Layer (playhead at 0 on Frame stop 1), or right after tapping a frame
 * stop — a press on "the big ball" used to grab the frame stop: the drag moved
 * the frame stop (clamped to the selection, pushing its neighbours) and the
 * video only followed it, so the ball could not be dropped where the coach let
 * go.
 *
 * Now a press on the ball that MOVES straight away scrubs the playhead. Holding
 * still for HOLD_TO_GRAB_MS first grabs the frame stop under it (the old
 * "drag to adjust"); a press that never moves is a tap on the frame stop, as
 * before. A frame stop that is NOT under the ball drags at once, unchanged.
 * Mouse and touch follow the same rules.
 */
export const HOLD_TO_GRAB_MS = 400;
/** Movement (px) that turns a press on the ball into a playhead scrub. */
export const PRESS_SLOP_PX = 6;

/** True when a press at `clientX` lands on the playhead ball drawn at `ballCenterX`. */
export function pressOnPlayheadBall(clientX: number, ballCenterX: number, ballSizePx: number): boolean {
  return Math.abs(clientX - ballCenterX) <= ballSizePx / 2;
}

export type BallPressPhase = 'pending' | 'scrub' | 'frame-stop';
export interface BallPress {
  x0: number;
  t0: number;
  phase: BallPressPhase;
}

export function startBallPress(clientX: number, nowMs: number): BallPress {
  return { x0: clientX, t0: nowMs, phase: 'pending' };
}

/** The hold timer fired (or time passed): a still press becomes a frame-stop grab. */
export function ballPressHold(p: BallPress, nowMs: number): BallPress {
  if (p.phase !== 'pending' || nowMs - p.t0 < HOLD_TO_GRAB_MS) return p;
  return { ...p, phase: 'frame-stop' };
}

/** A move while pressed: past the slop before the hold, it is the playhead's drag. */
export function ballPressMove(p: BallPress, clientX: number, nowMs: number): BallPress {
  const held = ballPressHold(p, nowMs);
  if (held.phase !== 'pending') return held;
  return Math.abs(clientX - p.x0) > PRESS_SLOP_PX ? { ...p, phase: 'scrub' } : p;
}
