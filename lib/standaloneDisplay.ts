/**
 * True when the page runs as an installed app (iPhone "Add to Home Screen"): no browser bars, and with
 * viewport-fit=cover the page draws under the camera island (landscape) and the home indicator. In a
 * normal browser tab the browser already keeps the page out of those areas, so nothing is added there
 * (padding by the safe area in Chrome made the layout smaller: PR #206, closed).
 */
export function isStandaloneDisplay(
  win: { matchMedia?: (q: string) => { matches: boolean }; navigator?: { standalone?: boolean } } | undefined,
): boolean {
  if (!win) return false;
  try {
    if (win.matchMedia?.('(display-mode: standalone)').matches) return true;
  } catch { /* old browsers */ }
  return win.navigator?.standalone === true;
}
