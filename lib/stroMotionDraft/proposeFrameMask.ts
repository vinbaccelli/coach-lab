'use client';

import { buildMatteAlphaMask } from '@/lib/objectMultiplier';
import { normalizeObjectBox, type StroMotionSubjectBox } from '@/lib/stroMotion';
import { captureVideoFrameAtTime } from '@/lib/stroMotionDraft/captureFrame';
import { maskHasContent } from '@/lib/stroMotionDraft/frameMask';
import { cloneAlphaMask, embedRegionMask, fillBoxMask } from '@/lib/stroMotionDraft/maskUtils';
import type { AlphaMask, StroMotionObjectType } from '@/lib/stroMotionDraft/types';

export interface ProposeFrameMaskResult {
  sourceFrame: ImageBitmap;
  aiSnapshot: AlphaMask;
  working: AlphaMask;
}

function boxToPixels(
  box: StroMotionSubjectBox,
  vw: number,
  vh: number,
  padFraction = 0.12,
) {
  const px = Math.round(box.x * vw);
  const py = Math.round(box.y * vh);
  const pw = Math.max(1, Math.round(box.width * vw));
  const ph = Math.max(1, Math.round(box.height * vh));
  const padX = Math.round(pw * padFraction);
  const padY = Math.round(ph * padFraction);
  const x0 = Math.max(0, px - padX);
  const y0 = Math.max(0, py - padY);
  const x1 = Math.min(vw, px + pw + padX);
  const y1 = Math.min(vh, py + ph + padY);
  return {
    px: x0,
    py: y0,
    pw: Math.max(1, x1 - x0),
    ph: Math.max(1, y1 - y0),
  };
}

/**
 * Motion-difference matte — the classic Dartfish StroMotion technique.
 *
 * The moving object (racket/bat/club/limb) is exactly what CHANGED between this
 * frame and a background reference frame (a moment when the object is not in
 * the box). |frame − background| inside the selection, cleaned with a
 * morphological open and feathered, isolates the object regardless of its
 * colors — far more reliable than color flood-fill on real footage. Requires a
 * reasonably static camera (tripod/phone-mount), our V1 capture case.
 * Returns null when the diff is unreliable (empty or blown-out box).
 */
async function motionDiffMaskInSelection(
  sourceFrame: ImageBitmap,
  backgroundFrame: ImageBitmap,
  box: StroMotionSubjectBox,
  vw: number,
  vh: number,
): Promise<AlphaMask | null> {
  const { px, py, pw, ph } = boxToPixels(box, vw, vh);
  // Process at a capped resolution — masks don't need full-res precision and
  // the morphology stays fast.
  const scale = Math.min(1, 420 / Math.max(pw, ph));
  const w = Math.max(8, Math.round(pw * scale));
  const h = Math.max(8, Math.round(ph * scale));
  const cnv = document.createElement('canvas');
  cnv.width = w;
  cnv.height = h;
  const ctx = cnv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(sourceFrame, px, py, pw, ph, 0, 0, w, h);
  const cur = ctx.getImageData(0, 0, w, h);
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(backgroundFrame, px, py, pw, ph, 0, 0, w, h);
  const bg = ctx.getImageData(0, 0, w, h);

  const n = w * h;
  const bin = new Uint8Array(n);
  const T = 48; // sum-of-channel-abs-diff threshold
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const d =
      Math.abs(cur.data[o] - bg.data[o]) +
      Math.abs(cur.data[o + 1] - bg.data[o + 1]) +
      Math.abs(cur.data[o + 2] - bg.data[o + 2]);
    bin[i] = d > T ? 1 : 0;
  }

  const morph = (src: Uint8Array, op: 'erode' | 'dilate'): Uint8Array => {
    const out = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = op === 'erode' ? 1 : 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dxx = -1; dxx <= 1; dxx++) {
            const yy = y + dy, xx = x + dxx;
            const s = yy < 0 || xx < 0 || yy >= h || xx >= w ? 0 : src[yy * w + xx];
            if (op === 'erode') v = Math.min(v, s); else v = Math.max(v, s);
          }
        }
        out[y * w + x] = v;
      }
    }
    return out;
  };

  // Open (erode→dilate) kills pixel speckle; the extra dilate reconnects thin
  // fast-moving parts (racket shaft) the open pass may have nicked.
  let m = morph(bin, 'erode');
  m = morph(m, 'dilate');
  m = morph(m, 'dilate');

  let on = 0;
  for (let i = 0; i < n; i++) on += m[i];
  const frac = on / n;
  // Nearly-empty diff = object didn't move / wrong reference; nearly-full =
  // camera moved or exposure shifted. Both mean "don't trust this".
  if (frac < 0.005 || frac > 0.9) return null;

  // Feather: solid core at 255, one dilate ring at soft alpha (motion blur
  // makes fast implements semi-transparent — a hard cut looks wrong).
  const ring = morph(m, 'dilate');
  const soft = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) soft[i] = m[i] ? 255 : ring[i] ? 120 : 0;

  // Upscale (nearest) back to the crop's native resolution for embedding.
  const up = new Uint8ClampedArray(pw * ph);
  for (let y = 0; y < ph; y++) {
    const sy = Math.min(h - 1, Math.floor((y * h) / ph));
    for (let x = 0; x < pw; x++) {
      const sx2 = Math.min(w - 1, Math.floor((x * w) / pw));
      up[y * pw + x] = soft[sy * w + sx2];
    }
  }
  return embedRegionMask(vw, vh, px, py, { width: pw, height: ph, data: up });
}

async function matteMaskInSelection(
  sourceFrame: ImageBitmap,
  box: StroMotionSubjectBox,
  vw: number,
  vh: number,
): Promise<AlphaMask> {
  const { px, py, pw, ph } = boxToPixels(box, vw, vh);
  const crop = await createImageBitmap(sourceFrame, px, py, pw, ph);
  try {
    const regionMatte = await buildMatteAlphaMask(crop);
    return embedRegionMask(vw, vh, px, py, regionMatte);
  } finally {
    crop.close();
  }
}

/**
 * Background-removal proposal after coach Select Area.
 *
 * Proposal ladder (best → safest):
 *   1. MOTION DIFF vs the background reference frame — the Dartfish technique;
 *      isolates whatever MOVED inside the box (any sport implement, any color).
 *   2. Border flood-fill matte (color-based) when the diff is unreliable.
 *   3. Solid selection-box fill so the manual editor always opens with something.
 * The coach's manual mask editor remains the final say on every frame.
 */
export async function proposeFrameMask(
  video: HTMLVideoElement,
  timeSec: number,
  selectionBox: StroMotionSubjectBox,
  backgroundTimeSec: number,
  objectType: StroMotionObjectType = 'racket',
): Promise<ProposeFrameMaskResult | null> {
  if (video.videoWidth === 0 || video.videoHeight === 0) return null;

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const box = normalizeObjectBox(selectionBox);
  const sourceFrame = await captureVideoFrameAtTime(video, timeSec);

  let aiSnapshot: AlphaMask | null = null;

  // 1. Motion diff against the background plate time (skip when the reference
  //    is effectively the same frame — nothing to diff).
  if (Math.abs(backgroundTimeSec - timeSec) > 0.05) {
    try {
      const backgroundFrame = await captureVideoFrameAtTime(video, backgroundTimeSec);
      try {
        aiSnapshot = await motionDiffMaskInSelection(sourceFrame, backgroundFrame, box, vw, vh);
      } finally {
        backgroundFrame.close();
      }
    } catch {
      aiSnapshot = null;
    }
  }

  // 2. Color flood-fill matte fallback, constrained to the selection box.
  if (!aiSnapshot || !maskHasContent(aiSnapshot)) {
    aiSnapshot = await matteMaskInSelection(sourceFrame, box, vw, vh);
  }

  // 3. Guaranteed non-empty proposal.
  if (!maskHasContent(aiSnapshot)) {
    aiSnapshot = fillBoxMask(vw, vh, box);
  }

  return {
    sourceFrame,
    aiSnapshot,
    working: cloneAlphaMask(aiSnapshot),
  };
}
