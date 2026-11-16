/**
 * The still-hold test behind the 2-second precision gesture, shared by every precision surface.
 *
 * components/Canvas.tsx fixed a real-phone bug here: the hold used to be measured from the press ORIGIN
 * and never re-anchored, but a finger settling on glass slides several millimetres before it rests, so a
 * 12 px settle over 600 ms killed a hold that was perfectly still for the remaining 1.4 s (it passed every
 * synthetic test and failed on a phone). The fix, kept here as the one definition:
 *   - the per-MOVE step is compared with PRECISION_HOLD_SLOP_PX and the reference is re-anchored on every
 *     accepted move, so a slow settle never accumulates into a false cancel;
 *   - the TOTAL travel from the press origin is capped at PRECISION_HOLD_MAX_TRAVEL_PX so an arbitrarily
 *     slow deliberate drag cannot arm precision mid-stroke.
 * hooks/usePrecisionTouch.ts (Motion Layer editor, ruler) still had the old origin-only rule.
 */

/** Still-hold duration (ms) that activates precision mode without the toolbar. */
export const PRECISION_HOLD_MS = 2000;
/** Travel between two consecutive move samples (px) that means "stroking, not holding". */
export const PRECISION_HOLD_SLOP_PX = 10;
/** Total travel from the press origin (px) that cancels the hold however slowly it accumulated. */
export const PRECISION_HOLD_MAX_TRAVEL_PX = 44;

export interface HoldPoints {
  /** Press origin. */
  clientX: number;
  clientY: number;
  /** Last accepted move sample (re-anchored on every accepted move). */
  lastX: number;
  lastY: number;
}

export type HoldVerdict =
  | { keep: true }
  | { keep: false; reason: string };

/** Judge one pointer move against a pending hold and, when it is kept, re-anchor `hold` to this sample. */
export function judgeHoldMove(hold: HoldPoints, x: number, y: number): HoldVerdict {
  const step = Math.hypot(x - hold.lastX, y - hold.lastY);
  const travel = Math.hypot(x - hold.clientX, y - hold.clientY);
  if (step > PRECISION_HOLD_SLOP_PX) return { keep: false, reason: `moved ${Math.round(step)} px in one step (limit ${PRECISION_HOLD_SLOP_PX})` };
  if (travel > PRECISION_HOLD_MAX_TRAVEL_PX) return { keep: false, reason: `drifted ${Math.round(travel)} px from the press (limit ${PRECISION_HOLD_MAX_TRAVEL_PX})` };
  hold.lastX = x;
  hold.lastY = y;
  return { keep: true };
}

/**
 * How far above the finger the crosshair sits (px). A fraction of the canvas height works for the main video, but a
 * small canvas (the Motion Layer mask editor on a phone is only a couple of hundred px tall) puts it almost under the
 * fingertip, so callers can set a floor. `minPx` 0 keeps the old behaviour.
 */
export function precisionCursorOffsetPx(canvasHeightPx: number, ratio: number, minPx = 0): number {
  return Math.max(canvasHeightPx * ratio, minPx);
}

/** A press shorter than this (ms) and moving less than TAP_MAX_TRAVEL_PX counts as a tap. */
export const DOUBLE_TAP_TAP_MS = 320;
export const DOUBLE_TAP_TAP_MAX_TRAVEL_PX = 24;
/** Max gap (ms) between the first lift and the second press, and max distance (px) between the two taps. */
export const DOUBLE_TAP_GAP_MS = 450;
export const DOUBLE_TAP_MAX_DISTANCE_PX = 40;

/**
 * One-finger double-tap detector: the gesture that turns precision mode OFF. Pure (callers pass timestamps) so it is
 * unit-testable. A press that the hold armed (a long press) is never a tap; a second finger or pointercancel calls cancel().
 * Usage: press(t,x,y) on pointerdown, move(x,y) on pointermove, lift(t,x,y) on pointerup → true when the second tap completes.
 */
export class DoubleTapDetector {
  private down: { t: number; x: number; y: number; travel: number } | null = null;
  private firstTap: { t: number; x: number; y: number } | null = null;

  press(t: number, x: number, y: number): void {
    // A press that begins too long after the first tap, or far from it, restarts the sequence.
    if (this.firstTap && (t - this.firstTap.t > DOUBLE_TAP_GAP_MS ||
        Math.hypot(x - this.firstTap.x, y - this.firstTap.y) > DOUBLE_TAP_MAX_DISTANCE_PX)) this.firstTap = null;
    this.down = { t, x, y, travel: 0 };
  }

  move(x: number, y: number): void {
    if (this.down) this.down.travel = Math.max(this.down.travel, Math.hypot(x - this.down.x, y - this.down.y));
  }

  /** Returns true when this lift completes a double-tap (the detector then resets). */
  lift(t: number, x: number, y: number): boolean {
    const d = this.down;
    this.down = null;
    if (!d) return false;
    const travel = Math.max(d.travel, Math.hypot(x - d.x, y - d.y));
    if (t - d.t > DOUBLE_TAP_TAP_MS || travel > DOUBLE_TAP_TAP_MAX_TRAVEL_PX) { this.firstTap = null; return false; }
    if (this.firstTap) { this.firstTap = null; return true; }
    this.firstTap = { t, x, y };
    return false;
  }

  cancel(): void { this.down = null; this.firstTap = null; }
}
