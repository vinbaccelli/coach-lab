'use client';

import { livePlayerMask } from '@/lib/stroMotionDraft/liveOcclusion';
import type { BackgroundPlate } from '@/lib/stroMotionDraft/backgroundPlate';

/**
 * Canvas side of "layers behind the player" (liveOcclusion.ts): from the clean background plate, builds for each live
 * frame a canvas whose alpha is the live player. Reuses one canvas, so the result is only valid until the next call.
 */
export interface LiveOcclusionBuilder {
  /** The mask canvas for this live frame, or null when the frame is unreliable (camera moved): layers then stay in front. */
  maskFor(live: ImageBitmap): HTMLCanvasElement | null;
  dispose(): void;
}

export function createLiveOcclusion(plate: BackgroundPlate): LiveOcclusionBuilder | null {
  const w = plate.width;
  const h = plate.height;
  const work = document.createElement('canvas');
  work.width = w;
  work.height = h;
  const wctx = work.getContext('2d', { willReadFrequently: true });
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d');
  if (!wctx || !octx) return null;
  wctx.drawImage(plate.bitmap, 0, 0, w, h);
  const plateData = wctx.getImageData(0, 0, w, h).data;
  const img = octx.createImageData(w, h);
  return {
    maskFor(live) {
      try {
        wctx.drawImage(live, 0, 0, w, h);
        const m = livePlayerMask(wctx.getImageData(0, 0, w, h).data, plateData, w, h);
        if (!m.reliable) return null;
        for (let i = 0; i < w * h; i++) img.data[i * 4 + 3] = m.alpha[i]; // RGB stay 0: only the alpha is used
        octx.putImageData(img, 0, 0);
        return out;
      } catch {
        return null;
      }
    },
    dispose() {
      try { plate.bitmap.close(); } catch { /* already closed */ }
    },
  };
}
