'use client';

import type { AlphaMask } from '@/lib/stroMotionDraft/types';

/**
 * MediaPipe Selfie Segmentation — a true person-segmentation model, used as the
 * PRIMARY cut for the athlete in StroMotion.
 *
 * SELF-HOSTED, NOT CDN
 * The assets are copied into /public/mediapipe-selfie from the installed
 * @mediapipe/selfie_segmentation package (a peer dependency of the direct
 * dependency @tensorflow-models/body-segmentation). This mirrors how every other
 * model in the app is served — /models/*.tflite, /mediapipe-wasm/* — and
 * deliberately does NOT follow lib/webcamSegmentation.ts, which pulls the same
 * solution from jsdelivr at runtime. The StroMotion pipeline must not acquire a
 * network dependency on a third-party CDN.
 *
 * WHY A CROP, NOT THE FRAME
 * Segmentation quality is dominated by how many input pixels land on the subject.
 * The model resizes its input to a fixed internal resolution, so handing it a
 * 1920x1080 frame in which the athlete occupies ~15% wastes almost all of that
 * budget on background. Passing a crop around the athlete spends the entire
 * budget on them. The caller supplies the crop; this module returns a mask in
 * CROP pixel space, and the caller embeds it back to full frame.
 */

type BodySegmenter = {
  segmentPeople: (input: CanvasImageSource | ImageBitmap) => Promise<Array<{
    mask: { toImageData: () => Promise<ImageData> };
  }>>;
};

let segmenterPromise: Promise<BodySegmenter | null> | null = null;

/**
 * 'landscape' (144x256) is the faster variant and is what the general model
 * downsamples to anyway for wide inputs; 'general' (256x256) keeps more vertical
 * detail, which matters because an athlete crop is usually TALLER than it is
 * wide. Chosen deliberately for that reason.
 */
const MODEL_TYPE: 'general' | 'landscape' = 'general';

async function getSelfieSegmenter(): Promise<BodySegmenter | null> {
  if (typeof window === 'undefined') return null;
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      try {
        const bodySegmentation = await import('@tensorflow-models/body-segmentation');
        return (await bodySegmentation.createSegmenter(
          bodySegmentation.SupportedModels.MediaPipeSelfieSegmentation,
          {
            runtime: 'mediapipe',
            modelType: MODEL_TYPE,
            // Self-hosted; no trailing slash (the solution appends one).
            solutionPath: `${window.location.origin}/mediapipe-selfie`,
          },
        )) as unknown as BodySegmenter;
      } catch (e) {
        console.warn('[selfieSegmenter] unavailable, caller will fall back:', e);
        return null;
      }
    })();
  }
  return segmenterPromise;
}

/** Warm the model so the first AI-detect frame does not pay the load. */
export function preloadSelfieSegmenter(): void {
  if (typeof window === 'undefined') return;
  void getSelfieSegmenter();
}

/**
 * Segment the person in `image`, returning a soft AlphaMask at the image's own
 * dimensions, or null if unavailable/empty.
 *
 * The confidence ramp mirrors the existing MagicTouch path (soft 0.3→0.6 rather
 * than a hard threshold) so downstream compositing sees the same kind of
 * feathered edge it already handles.
 */
export async function segmentPersonInImage(
  image: ImageBitmap,
): Promise<AlphaMask | null> {
  const seg = await getSelfieSegmenter();
  if (!seg) return null;

  let people: Awaited<ReturnType<BodySegmenter['segmentPeople']>>;
  try {
    people = await seg.segmentPeople(image);
  } catch (e) {
    console.warn('[selfieSegmenter] segmentPeople failed:', e);
    return null;
  }
  const first = people?.[0];
  if (!first) return null;

  let imageData: ImageData;
  try {
    imageData = await first.mask.toImageData();
  } catch {
    return null;
  }

  const { width: mw, height: mh, data: rgba } = imageData;
  if (mw < 1 || mh < 1) return null;

  // Person confidence is carried in the COLOUR channels ("person = white,
  // background = black" — the same reading lib/webcamSegmentation.ts relies on),
  // NOT in alpha.
  //
  // Measured on a real frame: red reports 3.9% foreground where alpha reports
  // only 1.8% — alpha loses more than half the subject, which shows up as bits
  // of the athlete (a foot, an edge) simply missing. Taking the max across RGB
  // is robust to whichever channel the runtime happens to encode into.
  const alpha = new Uint8ClampedArray(mw * mh);
  let covered = 0;
  for (let i = 0; i < mw * mh; i++) {
    const o = i * 4;
    const c = Math.max(rgba[o], rgba[o + 1], rgba[o + 2]) / 255;
    const a = c <= 0.3 ? 0 : c >= 0.6 ? 255 : Math.round(((c - 0.3) / 0.3) * 255);
    alpha[i] = a;
    if (a > 8) covered++;
  }

  // Essentially empty — treat as "no person found" so the caller can fall back
  // rather than committing a blank frame.
  if (covered < mw * mh * 0.002) return null;

  return { width: mw, height: mh, data: alpha };
}
