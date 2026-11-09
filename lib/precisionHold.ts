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
