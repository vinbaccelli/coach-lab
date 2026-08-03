'use client';

import type { AlphaMask } from '@/lib/stroMotionDraft/types';
import {
  COVERED_MIN_ALPHA,
  letterboxToSquare,
  logSegmenterCoverage,
  rampAlpha,
} from '@/lib/stroMotionDraft/segmenterCommon';

/**
 * MediaPipe SelfieMulticlass — the SECOND, SELECTABLE person segmenter.
 *
 * WHY IT EXISTS (this is a DIAGNOSTIC, not yet a decision)
 * The legacy path (selfieSegmenter.ts) runs MediaPipe SelfieSegmentation, a
 * MobileNetV3 model built for close-up video-call selfies. On a full-body
 * athlete across a court it cannot resolve hair or a forearm, and the open
 * question is WHY: is it the architecture, or is it the 256x256 input?
 *
 * SelfieMulticlass is a Vision Transformer at the SAME 256x256 input. So:
 *   - if it noticeably improves hair/edge quality → architecture was the limit,
 *     and we may be done for far less than a 115MB model,
 *   - if it barely moves → 256x256 RESOLUTION is the wall, which is exactly the
 *     evidence needed to justify Step 3 (BiRefNet_lite via ONNX Runtime Web).
 * Either answer is worth the ~20 lines of glue below.
 *
 * NO NEW DEPENDENCY: @mediapipe/tasks-vision@0.10.35 is already installed and
 * already used by lib/mediapipeSegmenter.ts (MagicTouch). Licence is Apache-2.0
 * for both the runtime and the model — commercially safe, unlike the BRIA RMBG
 * family (CC-BY-NC), which is off-limits for a paid product.
 *
 * SELF-HOSTED, NOT CDN — /models/selfie_multiclass_256x256.tflite (15.6MB),
 * fetched once from Google's official mediapipe-models bucket and committed,
 * exactly like /models/magic_touch.tflite and the pose_landmarker .task files.
 * The StroMotion pipeline must not acquire a runtime dependency on a CDN.
 *
 * SAME INPUT, SAME OUTPUT as the legacy path: it receives the caller's crop,
 * letterboxes it to square with the shared helper, and returns an AlphaMask at
 * the crop's own dimensions. The skeleton-zone intersect and the bone-core union
 * downstream are untouched and cannot tell the two segmenters apart.
 */

type ImageSegmenterT = import('@mediapipe/tasks-vision').ImageSegmenter;

/** Tasks-Vision WASM runtime — the copy lib/mediapipeSegmenter.ts already uses. */
const WASM_DIR = '/mediapipe-wasm';
const MODEL_PATH = '/models/selfie_multiclass_256x256.tflite';

/**
 * Class order read out of the model's own embedded metadata (labels.txt inside
 * the .tflite), not from documentation:
 *
 *   0 background   1 hair   2 body-skin   3 face-skin   4 clothes   5 others
 *
 * The model emits one confidence mask per class, softmax'd across the six, so
 * summing a subset gives a genuine soft probability for "this pixel belongs to
 * that subset" — no binarizing anywhere.
 */
const CLASS_LABELS = ['background', 'hair', 'body-skin', 'face-skin', 'clothes', 'others'] as const;
const CLASS_HAIR = 1;
const CLASS_BODY_SKIN = 2;
const CLASS_FACE_SKIN = 3;
const CLASS_CLOTHES = 4;
const CLASS_OTHERS = 5;

/** The athlete: hair + body-skin + face-skin + clothes. Everything else is out. */
const PERSON_CLASSES = [CLASS_HAIR, CLASS_BODY_SKIN, CLASS_FACE_SKIN, CLASS_CLOTHES];

/**
 * Class 5 ("others" — accessories: caps, wristbands, bags, and plausibly a grip)
 * is EXCLUDED by default: it is not the athlete's body, and the racket already
 * has its own deliberate handling downstream (excluded from bone-core
 * force-keep). Includable for A/B without a rebuild:
 *
 *   window.__stroMulticlassOthers = true
 */
function foregroundClasses(): number[] {
  if (typeof window === 'undefined') return PERSON_CLASSES;
  const w = window as unknown as Record<string, unknown>;
  return w.__stroMulticlassOthers === true ? [...PERSON_CLASSES, CLASS_OTHERS] : PERSON_CLASSES;
}

/**
 * Run one throwaway inference at the model's native size, during init.
 *
 * NOT a quality fix. Measured on real footage (demo.mp4, cold graph): the first
 * inference returns a mask BIT-IDENTICAL to the warm ones — same pixel sum, same
 * FNV hash, same covered-pixel count. MediaPipe's ImageSegmenter in IMAGE running
 * mode carries no state between calls, so a "cold" mask is not a worse mask.
 *
 * What the first call DOES cost is time: ~2.0s versus ~0.3s warm, because the GPU
 * delegate compiles its shaders and allocates buffers on first use. Paying that
 * here, inside init, means the first REAL frame of a batch runs at the same speed
 * as every other frame — so per-frame timings are comparable and frame 1 is not an
 * outlier in any respect we control. That removes warmup as a confound from A/B
 * runs rather than fixing a defect, which is the honest description of it.
 *
 * Fire-and-forget and fully guarded: a failure here must never stop a segmenter
 * that is otherwise fine from being returned.
 */
function warmUp(seg: ImageSegmenterT): void {
  try {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 256, 256);
    const r = seg.segment(c);
    try { r?.close(); } catch { /* already released */ }
  } catch (e) {
    console.warn('[multiclassSegmenter] warm-up inference failed (harmless):', e);
  }
}

let segmenterPromise: Promise<ImageSegmenterT | null> | null = null;

async function getSegmenter(): Promise<ImageSegmenterT | null> {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks(WASM_DIR);
      const make = (delegate: 'GPU' | 'CPU') =>
        ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_PATH, delegate },
          runningMode: 'IMAGE',
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        });
      let seg: ImageSegmenterT;
      let delegate: 'GPU' | 'CPU';
      try {
        seg = await make('GPU');
        delegate = 'GPU';
      } catch {
        seg = await make('CPU');
        delegate = 'CPU';
      }
      warmUp(seg);
      console.log(`[multiclassSegmenter] initialized from ${MODEL_PATH} (${delegate}, warmed)`);
      return seg;
    })().catch((e) => {
      // Same rule as the legacy path: surface the REAL error and do NOT cache a
      // failure, or one bad load silently disables the model for the session.
      console.error('[multiclassSegmenter] init FAILED:', e);
      segmenterPromise = null;
      return null;
    });
  }
  return segmenterPromise;
}

/** Warm the model so the first Motion Layer frame does not pay the load. */
export function preloadMulticlassSegmenter(): void {
  if (typeof window === 'undefined') return;
  void getSegmenter();
}

/**
 * Segment the person in `image`, returning a soft AlphaMask at the image's own
 * dimensions — the exact contract of `segmentPersonInImage`.
 *
 * Returns null when the model is unavailable or found nothing at all, which is
 * the caller's signal to fall back to the legacy segmenter.
 */
export async function segmentPersonMulticlass(image: ImageBitmap): Promise<AlphaMask | null> {
  const seg = await getSegmenter();
  if (!seg) return null;

  const boxed = letterboxToSquare(image);
  if (!boxed) return null;

  const classes = foregroundClasses();
  let personConf: Float32Array | null = null;
  let mw = 0;
  let mh = 0;

  try {
    const result = seg.segment(boxed.canvas);
    try {
      const masks = result?.confidenceMasks;
      if (!masks || masks.length < CLASS_LABELS.length) {
        console.warn(
          `[multiclassSegmenter] expected ${CLASS_LABELS.length} confidence masks, got ${masks?.length ?? 0}`,
        );
        return null;
      }
      mw = masks[0].width;
      mh = masks[0].height;
      if (mw < 1 || mh < 1) {
        console.warn(`[multiclassSegmenter] mask has no dimensions (${mw}x${mh})`);
        return null;
      }
      // Sum the foreground classes into ONE soft person-confidence. Reading the
      // Float32Arrays must happen before result.close() releases them.
      personConf = new Float32Array(mw * mh);
      for (const c of classes) {
        const arr = masks[c].getAsFloat32Array();
        for (let i = 0; i < personConf.length; i++) personConf[i] += arr[i];
      }
    } finally {
      try { result?.close(); } catch { /* already released */ }
    }
  } catch (e) {
    console.warn('[multiclassSegmenter] segment failed:', e);
    return null;
  }
  if (!personConf) return null;

  // Read the mask back out of the padded square: walk the image's own pixels and
  // sample the position each one was drawn to. Identical mapping to the legacy
  // path, so a coverage comparison between the two is apples-to-apples.
  const iw = image.width;
  const ih = image.height;
  const alpha = new Uint8ClampedArray(iw * ih);
  let covered = 0;
  for (let y = 0; y < ih; y++) {
    const my = Math.min(mh - 1, Math.floor(((y + boxed.offsetY) * mh) / boxed.side));
    for (let x = 0; x < iw; x++) {
      const mx = Math.min(mw - 1, Math.floor(((x + boxed.offsetX) * mw) / boxed.side));
      const c = personConf[my * mw + mx];
      const a = rampAlpha(c > 1 ? 1 : c);
      alpha[y * iw + x] = a;
      if (a > COVERED_MIN_ALPHA) covered++;
    }
  }

  logSegmenterCoverage({
    segmenter: 'multiclass',
    inW: iw,
    inH: ih,
    side: boxed.side,
    maskW: mw,
    maskH: mh,
    covered,
    extra: `fg=${classes.map((c) => CLASS_LABELS[c]).join('+')}`,
  });

  if (covered === 0) return null;
  return { width: iw, height: ih, data: alpha };
}
