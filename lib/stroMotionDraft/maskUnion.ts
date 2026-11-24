import type { AlphaMask } from '@/lib/stroMotionDraft/types';

/**
 * Per-pixel maximum of two masks of the same size: a click that ADDS to the selection never takes away what the earlier clicks selected.
 * (Object select re-decodes from all the clicks each time and its "racket-shaped" pick could drop the earlier part.)
 * Different sizes: the newer mask is returned as it is.
 */
export function unionMasks(prev: AlphaMask | null, next: AlphaMask): AlphaMask {
  if (!prev || prev.width !== next.width || prev.height !== next.height) return next;
  const data = new Uint8ClampedArray(next.data.length);
  for (let i = 0; i < data.length; i++) data[i] = prev.data[i] > next.data[i] ? prev.data[i] : next.data[i];
  return { width: next.width, height: next.height, data };
}
