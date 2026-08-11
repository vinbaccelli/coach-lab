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

/**
 * Is auto-racket on for this frame?
 *
 * DEFAULT OFF, unconditionally — no mode-based fallback.
 *
 * A mode-based default (on in 'racket'/'custom') was tried and is exactly the
 * bug this replaced: `useStroMotion`'s `objectType` state defaults to 'racket'
 * ({@link file://./../../hooks/useStroMotion.ts} `useState<StroMotionObjectType>('racket')`),
 * so "remove the flag to turn it off" silently fell through to that default and
 * kept firing — `[autoRacket]` logs kept appearing with no `autoRacket` key set
 * at all. A flag that can be defeated by deleting itself is not a flag. The ONLY
 * way this returns true now is an explicit opt-in:
 *
 *   localStorage.setItem('autoRacket', '1')   // force on
 *   localStorage.setItem('autoRacket', '0')   // force off (same as unset)
 *   window.__autoRacket = true                // console override, either direction
 *
 * `objectType` is still accepted (and still required by callers, since the mode
 * is genuine context worth logging) but no longer participates in the decision.
 */
export function autoRacketEnabled(_objectType: string): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  if (w.__autoRacket === true) return true;
  if (w.__autoRacket === false) return false;
  try {
    return window.localStorage.getItem('autoRacket') === '1';
  } catch {
    // Private mode / storage disabled — stay off, the safe default.
    return false;
  }
}
