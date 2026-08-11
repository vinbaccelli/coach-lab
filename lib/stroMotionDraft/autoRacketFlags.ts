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
 * DEFAULT ON in the implement modes ('racket' / 'custom'), OFF in 'player' and
 * 'ball' — so testers get the feature without setting anything, which is the
 * point of turning it on for the launch build. A coach who selected Racket has
 * said the implement is what this layer is about, and that is the consent the
 * per-frame cost needs.
 *
 * TURNING IT OFF IS EXPLICIT, and this is the part worth remembering: because the
 * default is mode-based, DELETING the key does not disable the feature — it falls
 * back to the mode. That behaviour was mistaken for a bug once. To actually turn
 * it off you must say so:
 *
 *   localStorage.setItem('autoRacket', '0')   // OFF, even in Racket mode
 *   localStorage.setItem('autoRacket', '1')   // ON, in any mode
 *   localStorage.removeItem('autoRacket')     // back to the mode default (ON in Racket)
 *   window.__autoRacket = true | false        // console override, either direction
 *
 * `useStroMotion`'s `objectType` defaults to 'racket', so a fresh session lands in
 * an implement mode and auto-racket is live.
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
