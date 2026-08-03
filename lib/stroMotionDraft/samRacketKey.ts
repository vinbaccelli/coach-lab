'use client';

/**
 * The two SAM-racket helpers that are safe to import EAGERLY.
 *
 * They live apart from samRacket.ts on purpose. app/analysis/page.tsx needs the
 * flag and the cache key at render time to decide whether to offer the Racket
 * tool, and a static import of samRacket.ts would pull the whole session,
 * encoder, decoder and union code into the analysis route's bundle — for a
 * feature that is off by default and must cost nothing until it is used.
 *
 * This file has NO imports, no state and no side effects. samRacket.ts
 * re-exports both so the key format has exactly one definition.
 */

/**
 * OFF by default, so the racket tool is A/B-able on real footage against the
 * exact current behaviour:
 *
 *   localStorage.setItem('samRacket', '1')   // or window.__samRacket = true
 */
export function samRacketEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  if (w.__samRacket === true) return true;
  if (w.__samRacket === false) return false;
  try {
    return window.localStorage.getItem('samRacket') === '1';
  } catch {
    return false;
  }
}

/**
 * The embedding-cache key for a draft frame. Includes timeSec so that
 * re-capturing a frame at a different time invalidates its embedding instead of
 * silently decoding clicks against the pixels of a frame that no longer exists.
 */
export function racketFrameKey(frameIndex: number, timeSec: number): string {
  return `f${frameIndex}@${timeSec.toFixed(3)}`;
}
