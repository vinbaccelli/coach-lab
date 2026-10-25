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

// ── Landscape ───────────────────────────────────────────────────────────────
// In a phone's landscape the top-right slot-action row and the zoom stack are
// close together and the row's container rect does not describe where its
// buttons are, so the button is placed from the MEASURED rects of every
// element in the row and in the zoom stack, and kept at least
// LANDSCAPE_CLEARANCE_PX away from each of them. Portrait keeps reportButtonPosition().

export const LANDSCAPE_CLEARANCE_PX = 12;

export const isLandscape = (vp: Viewport): boolean => vp.width > vp.height;

/** Separation between two boxes along their best axis (negative = they overlap). */
export function boxGap(a: Box, b: Box): number {
  const dx = Math.max(a.left - (b.left + b.width), b.left - (a.left + a.width));
  const dy = Math.max(a.top - (b.top + b.height), b.top - (a.top + a.height));
  return Math.max(dx, dy);
}

/**
 * `row`: the bounding rects of the +B/trash row and every element in it;
 * `stack`: the zoom stack and every button in it (all from getBoundingClientRect).
 * Tries, in order: left of the row's leftmost button; on the right edge below the
 * zoom stack's last (home) button; below the row in the stack's column; left of
 * the stack. The first spot that is on screen and ≥ 12 px from every measured box
 * wins; if none is, the spot with the most clearance, clamped on screen.
 */
export function reportButtonPositionLandscape(
  vp: Viewport, insets: Insets, row: Box[], stack: Box[],
): { top: number; left: number } {
  const s = REPORT_BUTTON_SIZE_PX;
  const rects = [...row, ...stack].filter(usable);
  const rowBoxes = row.filter(usable);
  const stackBoxes = stack.filter(usable);
  const minTop = vp.offsetTop + insets.top + MARGIN_PX;
  const maxTop = vp.offsetTop + vp.height - insets.bottom - MARGIN_PX - s;
  const minLeft = vp.offsetLeft + insets.left + MARGIN_PX;
  const maxLeft = vp.offsetLeft + vp.width - insets.right - MARGIN_PX - s;
  const onScreen = (p: { top: number; left: number }) =>
    p.top >= minTop && p.top <= maxTop && p.left >= minLeft && p.left <= maxLeft;
  const clearance = (p: { top: number; left: number }) =>
    rects.reduce((m, r) => Math.min(m, boxGap({ top: p.top, left: p.left, width: s, height: s }, r)), Infinity);
  const clampTo = (p: { top: number; left: number }) => ({
    top: Math.min(Math.max(p.top, minTop), Math.max(minTop, maxTop)),
    left: Math.min(Math.max(p.left, minLeft), Math.max(minLeft, maxLeft)),
  });

  const candidates: Array<{ top: number; left: number }> = [];
  if (rowBoxes.length) {
    const rowTop = Math.min(...rowBoxes.map((b) => b.top));
    const rowBottom = Math.max(...rowBoxes.map((b) => b.top + b.height));
    const rowLeft = Math.min(...rowBoxes.map((b) => b.left));
    // Centred on the row, kept inside the top inset (the row sits 8 px from the top, the button is taller than it).
    candidates.push({ top: Math.min(Math.max(rowTop + (rowBottom - rowTop - s) / 2, minTop), Math.max(minTop, maxTop)), left: rowLeft - LANDSCAPE_CLEARANCE_PX - s });
  }
  if (stackBoxes.length) {
    const sTop = Math.min(...stackBoxes.map((b) => b.top));
    const sBottom = Math.max(...stackBoxes.map((b) => b.top + b.height));
    const sLeft = Math.min(...stackBoxes.map((b) => b.left));
    const sRight = Math.max(...stackBoxes.map((b) => b.left + b.width));
    const col = (sLeft + sRight) / 2 - s / 2;
    candidates.push({ top: sBottom + LANDSCAPE_CLEARANCE_PX, left: col });
    if (rowBoxes.length) {
      candidates.push({ top: Math.max(...rowBoxes.map((b) => b.top + b.height)) + LANDSCAPE_CLEARANCE_PX, left: col });
    }
    candidates.push({ top: sTop, left: sLeft - LANDSCAPE_CLEARANCE_PX - s });
  }
  if (!candidates.length) {
    return clampTo({ top: minTop, left: vp.offsetLeft + vp.width - STACK_RIGHT_PX - insets.right - s });
  }
  const good = candidates.find((c) => onScreen(c) && clearance(c) >= LANDSCAPE_CLEARANCE_PX);
  if (good) return good;
  // Nothing fits cleanly: the on-screen spot that is furthest from everything.
  return candidates
    .map(clampTo)
    .reduce((best, c) => (clearance(c) > clearance(best) ? c : best));
}
