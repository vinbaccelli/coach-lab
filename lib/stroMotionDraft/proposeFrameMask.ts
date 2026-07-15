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
 * frame and the BACKGROUND (ideally a temporal-median plate; single reference
 * frame as fallback). Pipeline inside the selection box:
 *   diff → SOFT alpha (smoothstep 30..70 of channel-diff — preserves the
 *   semi-transparency of motion-blurred implements) → strong-core binarize +
 *   morphological open → CONNECTED COMPONENTS keep only blobs near the box
 *   centre (kills background speckle) → alpha gated by the kept support →
 *   3×3 box-blur feather.
 * Requires a reasonably static camera (tripod/phone-mount), our V1 capture
 * case. Returns null when the diff is unreliable (empty or blown-out box).
 */
async function motionDiffMaskInSelection(
  sourceFrame: ImageBitmap,
  background: { bitmap: ImageBitmap; scale: number },
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
  // The background may live at a reduced resolution (median plate) — its
  // source rect is the same box scaled into plate space.
  const bs = background.scale;
  ctx.drawImage(background.bitmap, px * bs, py * bs, pw * bs, ph * bs, 0, 0, w, h);
  const bg = ctx.getImageData(0, 0, w, h);

  const n = w * h;
  const T_LOW = 30;   // below: definitely background
  const T_HIGH = 70;  // above: definitely moving object
  const alphaRaw = new Uint8ClampedArray(n);
  const core = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const d =
      Math.abs(cur.data[o] - bg.data[o]) +
      Math.abs(cur.data[o + 1] - bg.data[o + 1]) +
      Math.abs(cur.data[o + 2] - bg.data[o + 2]);
    // smoothstep(T_LOW, T_HIGH, d) → soft alpha keeps motion-blur transparency.
    const tRaw = (d - T_LOW) / (T_HIGH - T_LOW);
    const t = tRaw <= 0 ? 0 : tRaw >= 1 ? 1 : tRaw * tRaw * (3 - 2 * tRaw);
    alphaRaw[i] = Math.round(t * 255);
    core[i] = d > T_HIGH ? 1 : 0;
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

  // Open (erode→dilate) kills pixel speckle in the strong core.
  let m = morph(core, 'erode');
  m = morph(m, 'dilate');

  // Connected components on the cleaned core: keep only blobs whose bounding
  // box touches the inner 60% of the selection — the object the coach framed —
  // and drop peripheral movers (shadows, other players, wind-blown net).
  const labels = new Int32Array(n).fill(-1);
  const innerX0 = w * 0.2, innerX1 = w * 0.8, innerY0 = h * 0.2, innerY1 = h * 0.8;
  const stack: number[] = [];
  let nextLabel = 0;
  const keepLabel: boolean[] = [];
  for (let i = 0; i < n; i++) {
    if (!m[i] || labels[i] !== -1) continue;
    const label = nextLabel++;
    let minX = w, maxX = 0, minY = h, maxY = 0;
    stack.push(i);
    labels[i] = label;
    while (stack.length) {
      const p = stack.pop() as number;
      const pxl = p % w, pyl = (p / w) | 0;
      if (pxl < minX) minX = pxl;
      if (pxl > maxX) maxX = pxl;
      if (pyl < minY) minY = pyl;
      if (pyl > maxY) maxY = pyl;
      // 4-connectivity
      if (pxl > 0 && m[p - 1] && labels[p - 1] === -1) { labels[p - 1] = label; stack.push(p - 1); }
      if (pxl < w - 1 && m[p + 1] && labels[p + 1] === -1) { labels[p + 1] = label; stack.push(p + 1); }
      if (pyl > 0 && m[p - w] && labels[p - w] === -1) { labels[p - w] = label; stack.push(p - w); }
      if (pyl < h - 1 && m[p + w] && labels[p + w] === -1) { labels[p + w] = label; stack.push(p + w); }
    }
    keepLabel[label] = maxX >= innerX0 && minX <= innerX1 && maxY >= innerY0 && minY <= innerY1;
  }
  const kept = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (labels[i] >= 0 && keepLabel[labels[i]]) kept[i] = 1;

  // Support = kept core grown twice, so the soft alpha skirt survives around it.
  let support = morph(kept, 'dilate');
  support = morph(support, 'dilate');

  let on = 0;
  for (let i = 0; i < n; i++) on += kept[i];
  const frac = on / n;
  // Nearly-empty diff = object didn't move / wrong reference; nearly-full =
  // camera moved or exposure shifted. Both mean "don't trust this".
  if (frac < 0.004 || frac > 0.9) return null;

  // Gate the soft alpha by the support, then feather with a 3×3 box blur.
  const gated = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) gated[i] = support[i] ? alphaRaw[i] : 0;
  const soft = new Uint8ClampedArray(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0, cnt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dxx = -1; dxx <= 1; dxx++) {
          const yy = y + dy, xx = x + dxx;
          if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue;
          acc += gated[yy * w + xx];
          cnt++;
        }
      }
      soft[y * w + x] = Math.round(acc / cnt);
    }
  }

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
 *   0. POSE-ANCHORED SEGMENTATION (MediaPipe MagicTouch) — when a scribble over
 *      the athlete + implement is supplied (auto path), cut that subject out
 *      directly. This is the Dartfish-grade path.
 *   1. MOTION DIFF vs the background reference frame — isolates whatever MOVED
 *      inside the box (any sport implement, any color).
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
  /** Temporal-median plate (preferred diff reference — see backgroundPlate.ts). */
  backgroundPlate?: { bitmap: ImageBitmap; scale: number } | null,
  /** Pose-derived scribble (normalized points over athlete + implement). */
  scribble?: Array<{ x: number; y: number }> | null,
): Promise<ProposeFrameMaskResult | null> {
  if (video.videoWidth === 0 || video.videoHeight === 0) return null;

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const box = normalizeObjectBox(selectionBox);
  const sourceFrame = await captureVideoFrameAtTime(video, timeSec);

  let aiSnapshot: AlphaMask | null = null;

  // 0. Pose-anchored segmentation — the athlete + implement, cut cleanly. Only
  //    runs on the auto path (a scribble is present); falls through on failure.
  if (scribble && scribble.length >= 2) {
    try {
      const { segmentSubjectMask } = await import('@/lib/mediapipeSegmenter');
      const seg = await segmentSubjectMask(sourceFrame, scribble, vw, vh);
      if (seg && maskHasContent(seg)) aiSnapshot = seg;
    } catch {
      aiSnapshot = null;
    }
  }

  // 1a. Motion diff against the temporal-MEDIAN plate — robust even when the
  //     object overlaps its own position in any single reference frame. Skipped
  //     when rung 0 (segmentation) already produced a mask.
  if (!maskHasContent(aiSnapshot) && backgroundPlate) {
    try {
      aiSnapshot = await motionDiffMaskInSelection(sourceFrame, backgroundPlate, box, vw, vh);
    } catch {
      aiSnapshot = null;
    }
  }

  // 1b. Single-reference-frame diff fallback (skip when the reference is
  //     effectively the same frame — nothing to diff).
  if ((!aiSnapshot || !maskHasContent(aiSnapshot)) && Math.abs(backgroundTimeSec - timeSec) > 0.05) {
    try {
      const backgroundFrame = await captureVideoFrameAtTime(video, backgroundTimeSec);
      try {
        aiSnapshot = await motionDiffMaskInSelection(sourceFrame, { bitmap: backgroundFrame, scale: 1 }, box, vw, vh);
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
