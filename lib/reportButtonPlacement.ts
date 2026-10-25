/**
 * Where the "Report a problem" button sits (components/ReportProblemButton.tsx).
 * Bottom-right, directly above the zoom +/- / help stack that /analysis puts
 * there (above the timeline controls), so it never covers the left toolbar, the
 * zoom buttons or the timeline. On a page without that stack it sits near the
 * bottom edge, above the dock clearance the analysis page publishes.
 */

/** Gap between the button and what is under it. */
export const REPORT_BUTTON_GAP_PX = 8;

/**
 * The button's `bottom` in px, from the zoom stack's top edge, or null when
 * there is no (visible) stack. `viewportHeight` is the layout viewport height
 * (window.innerHeight): a fixed element's bottom is measured from it.
 */
export function reportButtonBottomPx(
  viewportHeight: number,
  stack: { top: number; width: number; height: number } | null,
): number | null {
  if (!stack || !(stack.width > 0) || !(stack.height > 0)) return null;
  if (!Number.isFinite(stack.top) || !(viewportHeight > 0)) return null;
  // A stack scrolled off the bottom must not push the button off screen: keep it on screen.
  return Math.max(REPORT_BUTTON_GAP_PX, Math.round(viewportHeight - stack.top + REPORT_BUTTON_GAP_PX));
}

/** CSS `bottom` when there is no zoom stack: above the dock clearance (0 on pages that publish none). */
export const REPORT_BUTTON_FALLBACK_BOTTOM =
  'calc(var(--anglemotion-banner-bottom, 0px) + 8px + env(safe-area-inset-bottom, 0px))';
