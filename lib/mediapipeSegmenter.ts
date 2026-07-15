'use client';

/**
 * MediaPipe Interactive Segmenter (MagicTouch) — pose-anchored foreground
 * segmentation for StroMotion. Given a "scribble" of points over the athlete and
 * the implement they hold (derived from the skeleton), it returns a soft alpha
 * matte of that subject, cut cleanly from the background. Runs only on paused,
 * seeked frames (the StroMotion pipeline), never during live playback.
 *
 * Self-hosted assets (same pattern as lib/mediapipePose.ts):
 *   /mediapipe-wasm/*            (Tasks-Vision WASM)
 *   /models/magic_touch.tflite   (~5.9MB, Apache-2.0)
 */

import type { AlphaMask } from '@/lib/stroMotionDraft/types';

type InteractiveSegmenterT = import('@mediapipe/tasks-vision').InteractiveSegmenter;

let segmenterPromise: Promise<InteractiveSegmenterT | null> | null = null;

async function getSegmenter(): Promise<InteractiveSegmenterT | null> {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      try {
        const { FilesetResolver, InteractiveSegmenter } = await import('@mediapipe/tasks-vision');
        const fileset = await FilesetResolver.forVisionTasks('/mediapipe-wasm');
        const make = (delegate: 'GPU' | 'CPU') =>
          InteractiveSegmenter.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: '/models/magic_touch.tflite', delegate },
            outputConfidenceMasks: true,
            outputCategoryMask: false,
          });
        try {
          return await make('GPU');
        } catch {
          return await make('CPU');
        }
      } catch (e) {
        console.warn('[segmenter] Interactive Segmenter unavailable:', e);
        return null;
      }
    })();
  }
  return segmenterPromise;
}

export function preloadSegmenter(): void {
  if (typeof window === 'undefined') return;
  void getSegmenter();
}

/**
 * Build the scribble prompt (normalized points) covering the athlete + the
 * implement, from a COCO-17 pose (video pixels). Points: nose, shoulders,
 * elbows, wrists, hips, knees, ankles + the implement tip (dominant wrist
 * extended past the elbow). Low-confidence joints are skipped.
 */
export function poseScribble(
  kps: Array<{ x: number; y: number; score: number }>,
  vw: number,
  vh: number,
): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  const idxs = [0, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
  for (const i of idxs) {
    const k = kps[i];
    if (k && k.score >= 0.2) pts.push({ x: k.x / vw, y: k.y / vh });
  }
  const rW = kps[10], lW = kps[9], rE = kps[8], lE = kps[7];
  const dom = rW?.score >= 0.2 && (!lW || lW.score < rW.score)
    ? { w: rW, e: rE }
    : (lW?.score >= 0.2 ? { w: lW, e: lE } : null);
  if (dom?.w && dom.e && dom.e.score >= 0.2) {
    const dx = dom.w.x - dom.e.x;
    const dy = dom.w.y - dom.e.y;
    pts.push({
      x: Math.min(1, Math.max(0, (dom.w.x + dx * 1.2) / vw)),
      y: Math.min(1, Math.max(0, (dom.w.y + dy * 1.2) / vh)),
    });
  }
  return pts;
}

function scaleAlpha(src: Uint8ClampedArray, sw: number, sh: number, dw: number, dh: number): AlphaMask {
  const data = new Uint8ClampedArray(dw * dh);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / dw));
      data[y * dw + x] = src[sy * sw + sx];
    }
  }
  return { width: dw, height: dh, data };
}

/** Zero alpha outside the scribble's bounding box (dilated) to reject other people. */
function clampToBox(mask: AlphaMask, pts: Array<{ x: number; y: number }>, dilate: number): void {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const w = maxX - minX, h = maxY - minY;
  const x1 = Math.floor((minX - w * dilate) * mask.width);
  const y1 = Math.floor((minY - h * dilate) * mask.height);
  const x2 = Math.ceil((maxX + w * dilate) * mask.width);
  const y2 = Math.ceil((maxY + h * dilate) * mask.height);
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (x < x1 || x >= x2 || y < y1 || y >= y2) mask.data[y * mask.width + x] = 0;
    }
  }
}

/**
 * Segment the subject the scribble points cover (athlete + implement), returning
 * a full-frame soft AlphaMask, or null if unavailable/empty. Points are
 * normalized [0,1]. Output is clamped to the scribble's dilated bbox so a
 * background person can't leak in.
 */
export async function segmentSubjectMask(
  image: ImageBitmap | HTMLCanvasElement | HTMLVideoElement,
  scribbleNorm: Array<{ x: number; y: number }>,
  frameW: number,
  frameH: number,
): Promise<AlphaMask | null> {
  if (scribbleNorm.length < 2 || frameW < 1 || frameH < 1) return null;
  const seg = await getSegmenter();
  if (!seg) return null;

  let result: import('@mediapipe/tasks-vision').InteractiveSegmenterResult | undefined;
  try {
    result = seg.segment(image, { scribble: scribbleNorm.map((p) => ({ x: p.x, y: p.y })) });
  } catch (e) {
    console.warn('[segmenter] segment failed:', e);
    return null;
  }
  const mpMask = result?.confidenceMasks?.[0];
  if (!mpMask) return null;

  const conf = mpMask.getAsFloat32Array();
  const mw = mpMask.width;
  const mh = mpMask.height;
  const alpha = new Uint8ClampedArray(mw * mh);
  let covered = 0;
  for (let i = 0; i < conf.length; i++) {
    const c = conf[i];
    // Soft ramp 0.3 → 0.6 keeps a feathered (Dartfish-like) edge.
    const a = c <= 0.3 ? 0 : c >= 0.6 ? 255 : Math.round(((c - 0.3) / 0.3) * 255);
    alpha[i] = a;
    if (a > 8) covered++;
  }
  try { mpMask.close(); } catch { /* already released */ }

  if (covered < mw * mh * 0.002) return null; // essentially empty

  const full = (mw === frameW && mh === frameH)
    ? { width: frameW, height: frameH, data: alpha }
    : scaleAlpha(alpha, mw, mh, frameW, frameH);
  clampToBox(full, scribbleNorm, 0.35);
  return full;
}
