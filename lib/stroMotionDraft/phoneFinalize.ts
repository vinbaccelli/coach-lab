'use client';

import { captureVideoFrameAtTime } from '@/lib/stroMotionDraft/captureSource';
import { upscaleAlphaMask } from '@/lib/stroMotionDraft/phoneBudget';
import type { AlphaMask } from '@/lib/stroMotionDraft/types';

/**
 * PHONE MEMORY BUDGET — the last step before the atomic commit.
 *
 * On a phone the pass works on frames and masks capped at PHONE_MAX_EDGE. The draft
 * wants native-size frames and masks (the editor, the composite and the export all
 * assume `sourceFrame`, `aiSnapshot` and `working` share the video's size), so just
 * before the commit each built frame gets its masks scaled up (bilinear, so soft
 * edges stay soft) and its picture re-captured at native size. By then the heavy
 * models have been released, so the extra native bitmaps are the only large thing
 * alive. A frame whose native capture fails keeps its capped pair (picture and masks
 * at the same size), never a mismatched one.
 *
 * It does not touch the commit itself: it only edits the `built` array the commit
 * reads.
 */
export async function finalizeBuiltAtNativeSize<
  T extends { frameIndex: number; sourceFrame: ImageBitmap; aiSnapshot: AlphaMask; working: AlphaMask },
>(
  video: HTMLVideoElement,
  built: T[],
  timeOf: (frameIndex: number) => number | undefined,
): Promise<number> {
  const nw = video.videoWidth;
  const nh = video.videoHeight;
  if (!(nw > 0) || !(nh > 0)) return 0;
  let done = 0;
  for (const b of built) {
    if (b.sourceFrame.width === nw && b.sourceFrame.height === nh) continue;
    const t = timeOf(b.frameIndex);
    if (t === undefined) continue;
    let native: ImageBitmap;
    try {
      native = await captureVideoFrameAtTime(video, t);
    } catch (e) {
      console.warn('[phoneBudget] native re-capture failed on frame', b.frameIndex, '— keeping the capped frame', e);
      continue;
    }
    const ai = upscaleAlphaMask(b.aiSnapshot, nw, nh);
    // `working` starts as a copy of `aiSnapshot` and may differ after the racket union;
    // each is scaled from its own pixels.
    const working = b.working === b.aiSnapshot ? ai : upscaleAlphaMask(b.working, nw, nh);
    try { b.sourceFrame.close(); } catch { /* already closed */ }
    b.sourceFrame = native;
    b.aiSnapshot = ai as AlphaMask;
    b.working = working as AlphaMask;
    done++;
  }
  return done;
}
