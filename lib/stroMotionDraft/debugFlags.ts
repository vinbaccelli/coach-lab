'use client';

/**
 * ONE switch for every developer diagnostic in the Motion Layer path.
 *
 * OFF BY DEFAULT — this is the pre-launch change. These diagnostics used to be
 * OPT-OUT (`!== false`), which meant a real coach on anglemotion.com got the
 * floating skeleton-zone debug panel appended to `document.body`, per-frame
 * diagnostic canvases drawn, and a console line for every frame. Fine while the
 * only user was the person building it; not fine for a paying user.
 *
 * Turn diagnostics back on from the console — no rebuild, no deploy:
 *
 *   window.__stroSkelDebug = true
 *
 * `window.__stroShowZone` remains an explicit per-session override in BOTH
 * directions (true forces on, false forces off) because the zone overlay is the
 * thing the architect toggles most.
 *
 * No imports, no state, no side effects — safe for any module to consult.
 */
export function stroDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  if (w.__stroShowZone !== undefined) return w.__stroShowZone === true;
  return w.__stroSkelDebug === true;
}
