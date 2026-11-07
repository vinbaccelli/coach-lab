/**
 * TEMPORARY test switches for the skeleton work, settable from a LINK (phones have no console).
 * They persist in localStorage until changed:
 *   ?legacy=1      previous skeleton behaviour everywhere (AI Track bake + live display, no look-ahead)
 *   ?legacy=0      back to the new behaviour
 *   ?lookahead=1   EXPERIMENTAL look-ahead video ON (default OFF: on an iPhone a second playing video stalled the main one)
 *   ?lookahead=0   look-ahead OFF again (the default)
 *   ?lookahead=decode  FEASIBILITY PROBE: the hidden video plays (same decoder load) but detection stays on the main video and the
 *                      display stays on the live path — isolates what a second decoder costs the main video
 *   ?la_lead=2.5   look-ahead target lead in VIDEO seconds (0.04–3); ?la_lead=auto back to one measured round trip
 * Remove once the skeleton work is accepted.
 */
export const LEGACY_KEY = 'anglemotion:skeleton-legacy';
export const LOOKAHEAD_ON_KEY = 'anglemotion:lookahead-on';
export const LOOKAHEAD_LEAD_KEY = 'anglemotion:lookahead-lead';

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
    if (ahead === '1' || ahead === 'decode') ls.setItem(LOOKAHEAD_ON_KEY, ahead);
    else if (ahead === '0') ls.removeItem(LOOKAHEAD_ON_KEY);
    const lead = q.get('la_lead');
    if (lead !== null) {
      const n = Number(lead);
      if (Number.isFinite(n) && n >= 0.04 && n <= 3) ls.setItem(LOOKAHEAD_LEAD_KEY, String(n));
      else ls.removeItem(LOOKAHEAD_LEAD_KEY);
    }
  } catch { /* blocked storage: switches simply don't apply */ }
}

export function legacyOn(): boolean {
  applyUrlSwitches();
  try { return typeof window !== 'undefined' && (!!(window as unknown as { __skeletonLegacy?: boolean }).__skeletonLegacy || window.localStorage.getItem(LEGACY_KEY) === '1'); } catch { return false; }
}

/** The experimental look-ahead is OFF unless explicitly switched on. */
export function lookAheadOnSwitch(): boolean {
  applyUrlSwitches();
  try { if (typeof window === 'undefined') return false; const v = window.localStorage.getItem(LOOKAHEAD_ON_KEY); return v === '1' || v === 'decode'; } catch { return false; }
}

/** Feasibility probe: hidden video decodes, but nothing is detected on it and the display stays on the live path. */
export function lookAheadDecodeOnly(): boolean {
  applyUrlSwitches();
  try { return typeof window !== 'undefined' && window.localStorage.getItem(LOOKAHEAD_ON_KEY) === 'decode'; } catch { return false; }
}

/** Target look-ahead lead in video seconds from `?la_lead=`, or null ⇒ one measured round trip (the default). */
export function lookAheadLeadOverride(): number | null {
  applyUrlSwitches();
  try {
    if (typeof window === 'undefined') return null;
    const n = Number(window.localStorage.getItem(LOOKAHEAD_LEAD_KEY));
    return Number.isFinite(n) && n >= 0.04 && n <= 3 ? n : null;
  } catch { return null; }
}

/** One line for the ?debug=1 panel so a screenshot proves which mode ran. */
export function modeLabel(lookAheadActive: boolean): string {
  return legacyOn() ? 'mode: LEGACY (previous skeleton behaviour)' : `mode: NEW · look-ahead ${lookAheadActive ? `ON (experimental)${lookAheadDecodeOnly() ? ' · DECODE-ONLY probe' : ''} · lead ${lookAheadLeadOverride() ?? 'auto'}` : 'OFF (default)'}`;
}
