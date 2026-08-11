'use client';

/**
 * FLAGS for AUTO-RACKET detection (D-FINE → SAM-2).
 *
 * Separate from racketDetect.ts for the same reason samRacketKey.ts is separate
 * from samRacket.ts: proposeFrameMask has to decide whether the pass runs BEFORE
 * it is willing to import any of it, and a static import of the detector would
 * pull transformers.js into the mask bundle for a feature that must cost nothing
 * until it is actually used.
 *
 * No imports, no state, no side effects.
 */

/** Motion Layer object types that mean "the coach is working on an implement". */
const IMPLEMENT_MODES = new Set(['racket', 'custom']);

/**
 * Is auto-racket on for this frame?
 *
 * DEFAULT: ON in the implement modes ('racket' / 'custom'), OFF in 'player' and
 * 'ball'. The mode IS the opt-in — a coach who selected Racket has said the
 * implement is the point of this layer, and that is the consent the cost needs
 * (see the batch-cost note in racketDetect.ts). Nobody in Player mode pays for a
 * racket they never asked to segment.
 *
 * The localStorage key overrides the mode in BOTH directions so the architect can
 * A/B it against the exact current behaviour without changing modes:
 *
 *   localStorage.setItem('autoRacket', '1')   // force on, any mode
 *   localStorage.setItem('autoRacket', '0')   // force off, even in Racket mode
 *
 * `window.__autoRacket` does the same for a console-driven run.
 */
export function autoRacketEnabled(objectType: string): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  if (w.__autoRacket === true) return true;
  if (w.__autoRacket === false) return false;
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem('autoRacket');
  } catch {
    // Private mode / storage disabled — fall through to the mode default.
  }
  if (stored === '1') return true;
  if (stored === '0') return false;
  return IMPLEMENT_MODES.has(objectType);
}
