/**
 * Where the round "Report a problem" icon button sits (components/ReportProblemButton.tsx).
 * Right edge, in the column of the zoom stack, directly BELOW the top-right
 * slot-action row (recording / remove / +B) and above the zoom stack. That gap
 * is free in portrait and in a phone's landscape; if the screen is too short
 * for it, the button moves to the left of the zoom stack instead, so it is
 * always on screen and never over the left toolbar, the zoom/help buttons, the
 * +B/trash row or the timeline. All numbers are in layout-viewport px (what
 * getBoundingClientRect and `position: fixed` use).
 */

export const REPORT_BUTTON_SIZE_PX = 34;
const MARGIN_PX = 8;
const GAP_PX = 6;
/** The zoom stack sits this far from the right edge (Canvas.tsx, tour-zoom). */
const STACK_RIGHT_PX = 12;

export type Box = { top: number; left: number; width: number; height: number };
/** The visual viewport, in layout-viewport coordinates (pinch-zoom and the browser bar move it). */
export type Viewport = { offsetTop: number; offsetLeft: number; width: number; height: number };
export type Insets = { top: number; right: number; bottom: number; left: number };

const usable = (b: Box | null): b is Box =>
  !!b && b.width > 0 && b.height > 0 && [b.top, b.left, b.width, b.height].every(Number.isFinite);

/** `top` / `left` for the button. `row` = the top-right action row, `stack` = the zoom stack (either may be absent). */
export function reportButtonPosition(
  vp: Viewport, insets: Insets, row: Box | null, stack: Box | null,
): { top: number; left: number } {
  const s = REPORT_BUTTON_SIZE_PX;
  const minTop = vp.offsetTop + insets.top + MARGIN_PX;
  const maxTop = vp.offsetTop + vp.height - insets.bottom - MARGIN_PX - s;
  const minLeft = vp.offsetLeft + insets.left + MARGIN_PX;
  const maxLeft = vp.offsetLeft + vp.width - insets.right - MARGIN_PX - s;
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

  // Column: right-aligned with the zoom stack when there is one, else at the right edge.
  const col = usable(stack)
    ? stack.left + stack.width / 2 - s / 2
    : vp.offsetLeft + vp.width - STACK_RIGHT_PX - insets.right - s;
  const top = usable(row) ? row.top + row.height + GAP_PX : minTop;

  if (usable(stack) && top + s + GAP_PX > stack.top) {
    // No room between the row and the stack: beside the stack (left of it), at its top.
    return {
      top: clamp(stack.top, minTop, maxTop),
      left: clamp(stack.left - GAP_PX - s, minLeft, maxLeft),
    };
  }
  return { top: clamp(top, minTop, maxTop), left: clamp(col, minLeft, maxLeft) };
}
