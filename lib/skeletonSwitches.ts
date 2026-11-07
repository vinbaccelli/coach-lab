/**
 * TEMPORARY test switches for the skeleton work, settable from a LINK (phones have no console).
 * They persist in localStorage until changed:
 *   ?legacy=1      previous skeleton behaviour everywhere (AI Track bake + live display, no look-ahead)
 *   ?legacy=0      back to the new behaviour
 *   ?lookahead=0   new behaviour but WITHOUT the look-ahead video
 *   ?lookahead=1   look-ahead on again
 * Remove once the skeleton work is accepted.
 */
export const LEGACY_KEY = 'anglemotion:skeleton-legacy';
export const LOOKAHEAD_OFF_KEY = 'anglemotion:lookahead-off';

/** Apply `?legacy=` / `?lookahead=` from the current URL to localStorage (idempotent, never throws). */
export function applyUrlSwitches(): void {
  if (typeof window === 'undefined') return;
  try {
    const q = new URLSearchParams(window.location.search);
    const ls = window.localStorage;
    const legacy = q.get('legacy');
    if (legacy === '1') ls.setItem(LEGACY_KEY, '1');
    else if (legacy === '0') ls.removeItem(LEGACY_KEY);
    const ahead = q.get('lookahead');
    if (ahead === '0') ls.setItem(LOOKAHEAD_OFF_KEY, '1');
    else if (ahead === '1') ls.removeItem(LOOKAHEAD_OFF_KEY);
  } catch { /* blocked storage: switches simply don't apply */ }
}

export function legacyOn(): boolean {
  applyUrlSwitches();
  try { return typeof window !== 'undefined' && (!!(window as unknown as { __skeletonLegacy?: boolean }).__skeletonLegacy || window.localStorage.getItem(LEGACY_KEY) === '1'); } catch { return false; }
}

export function lookAheadOffSwitch(): boolean {
  applyUrlSwitches();
  try { return typeof window !== 'undefined' && window.localStorage.getItem(LOOKAHEAD_OFF_KEY) === '1'; } catch { return false; }
}

/** One line for the ?debug=1 panel so a screenshot proves which mode ran. */
export function modeLabel(lookAheadActive: boolean): string {
  return legacyOn() ? 'mode: LEGACY (previous skeleton behaviour)' : `mode: NEW · look-ahead ${lookAheadActive ? 'ON' : 'OFF'}`;
}
