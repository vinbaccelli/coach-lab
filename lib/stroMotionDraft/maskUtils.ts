'use client';

import type { AlphaMask } from '@/lib/stroMotionDraft/types';

export function cloneAlphaMask(mask: AlphaMask): AlphaMask {
  return {
    width: mask.width,
    height: mask.height,
    data: new Uint8ClampedArray(mask.data),
  };
}

export async function extractAlphaMaskFromBitmap(bitmap: ImageBitmap): Promise<AlphaMask> {
  const w = bitmap.width;
  const h = bitmap.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h) };
  }
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, w, h);
  const alpha = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) {
    alpha[i] = data[i * 4 + 3];
  }
  return { width: w, height: h, data: alpha };
}

/**
 * Stamp ONE brush disc into a mask IN PLACE, in FRAME px.
 *
 * This is the exact disc loop `applyBrushToMask` has always run, lifted out
 * verbatim so the single-stamp and the stroke variants cannot drift apart. It
 * mutates and is therefore not exported from the package index: callers go
 * through `applyBrushToMask` (clone + one stamp) or `applyBrushStrokeToMask`
 * (clone + stamps along a segment).
 */
function stampBrushDisc(
  mask: AlphaMask,
  x: number,
  y: number,
  radius: number,
  mode: 'add' | 'remove',
): void {
  const { width, height, data } = mask;
  const r2 = radius * radius;
  const cx = Math.round(x);
  const cy = Math.round(y);
  const y0 = Math.max(0, cy - Math.ceil(radius));
  const y1 = Math.min(height - 1, cy + Math.ceil(radius));
  const x0 = Math.max(0, cx - Math.ceil(radius));
  const x1 = Math.min(width - 1, cx + Math.ceil(radius));

  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy > r2) continue;
      const idx = py * width + px;
      data[idx] = mode === 'add' ? 255 : 0;
    }
  }
}

export function applyBrushToMask(
  mask: AlphaMask,
  x: number,
  y: number,
  radius: number,
  mode: 'add' | 'remove',
): AlphaMask {
  const next = cloneAlphaMask(mask);
  stampBrushDisc(next, x, y, radius, mode);
  return next;
}

/**
 * A brush SEGMENT: `applyBrushToMask`'s disc, stamped along `from`→`to`.
 *
 * Pointer samples are sparse — a fast drag delivers points tens of frame-px
 * apart, and stamping only at the samples paints a dotted line rather than a
 * stroke. Interpolating at ≤ radius/2 spacing guarantees consecutive discs
 * overlap, so the painted region is exactly the swept disc.
 *
 * Clones ONCE for the whole segment. Calling `applyBrushToMask` per interpolated
 * point would clone the full-frame mask (~2 MB at 1080p) per stamp.
 *
 * `from === to` (a click, or the first point of a drag) stamps a single disc,
 * identical to `applyBrushToMask(mask, from.x, from.y, radius, mode)`.
 */
export function applyBrushStrokeToMask(
  mask: AlphaMask,
  from: { x: number; y: number },
  to: { x: number; y: number },
  radius: number,
  mode: 'add' | 'remove',
): AlphaMask {
  const next = cloneAlphaMask(mask);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const spacing = Math.max(0.5, radius * 0.5);
  const steps = Math.max(1, Math.ceil(distance / spacing));

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    stampBrushDisc(next, from.x + dx * t, from.y + dy * t, radius, mode);
  }
  return next;
}

/** Which direction a flood click moves the mask. */
export type FloodMode = 'add' | 'remove';

/** Colour distance from the seed pixel that still counts as "the same region". */
export const FLOOD_TOLERANCE_DEFAULT = 38;
export const FLOOD_TOLERANCE_MIN = 4;
export const FLOOD_TOLERANCE_MAX = 120;

export interface FloodOptions {
  mode: FloodMode;
  /** Defaults to FLOOD_TOLERANCE_DEFAULT. */
  tolerance?: number;
  /**
   * NORMALIZED box the fill may not leave — pass the frame's selection box.
   * Null/omitted floods the whole frame, which is almost never what a coach wants.
   */
  bounds?: { x: number; y: number; width: number; height: number } | null;
}

/**
 * Click-to-flood: walk the pixels that look like the one clicked, and set the
 * mask across them — ADD (255) or REMOVE (0).
 *
 * ── WHY THIS IS BOUNDED ───────────────────────────────────────────────────────
 * The previous version walked purely on source-image colour similarity and never
 * consulted the mask or any boundary. Neighbours were enqueued regardless of where
 * they were, so a click on the court could leave the selection, cross the frame
 * through similar pixels, and clear parts of the athlete on the way back — the
 * "it removes parts that should stay" report. Colour similarity alone is not a
 * region: a tennis court is the same colour on both sides of the player.
 *
 * The fix is a HARD WALK BOUNDARY rather than a cleverer colour test. Pixels
 * outside `bounds` are never visited, so the fill physically cannot escape the box
 * the coach drew. Inside it, connectivity still does the work it is good at.
 *
 * ── WHY SEED-RELATIVE COLOUR, NOT NEIGHBOUR-RELATIVE ──────────────────────────
 * Every pixel is compared to the SEED, not to the pixel it came from. Neighbour-
 * relative matching creeps: each small step is within tolerance, so a gradient
 * walks the fill arbitrarily far from the colour actually clicked. Seed-relative
 * under-fills a gradient instead, which is recoverable with the brush — the whole
 * point of flood doing the bulk and the brush doing the fine-tuning.
 *
 * Squared distance, no `Math.hypot`, and no per-pixel neighbour array: this runs
 * once per in-bounds pixel on a 1080p frame.
 */
export function floodInMask(
  mask: AlphaMask,
  sourcePixels: Uint8ClampedArray,
  sourceWidth: number,
  x: number,
  y: number,
  opts: FloodOptions,
): AlphaMask {
  const next = cloneAlphaMask(mask);
  const { width, height, data } = next;
  if (sourceWidth !== width) return next;

  const value = opts.mode === 'add' ? 255 : 0;
  const tolerance = opts.tolerance ?? FLOOD_TOLERANCE_DEFAULT;
  const tol2 = tolerance * tolerance;

  // Walk boundary, in frame px and inclusive. `padding: 0` so it is exactly the
  // box the coach drew and the editor outlines in yellow.
  const rect = opts.bounds
    ? boxToMaskRect(width, height, opts.bounds, 0)
    : { px: 0, py: 0, x2: width, y2: height };
  const minX = Math.max(0, rect.px);
  const minY = Math.max(0, rect.py);
  const maxX = Math.min(width - 1, rect.x2 - 1);
  const maxY = Math.min(height - 1, rect.y2 - 1);
  if (minX > maxX || minY > maxY) return next;

  const cx = Math.round(x);
  const cy = Math.round(y);
  // A click outside the box is a no-op rather than an unbounded fill.
  if (cx < minX || cy < minY || cx > maxX || cy > maxY) return next;

  const startIdx = cy * width + cx;
  const si = startIdx * 4;
  const sr = sourcePixels[si];
  const sg = sourcePixels[si + 1];
  const sb = sourcePixels[si + 2];

  const visited = new Uint8Array(width * height);
  // Visited is set BEFORE enqueueing, so each in-bounds pixel is queued at most
  // once and the bounded area is an exact capacity.
  const queue = new Int32Array((maxX - minX + 1) * (maxY - minY + 1));
  let head = 0;
  let tail = 0;
  queue[tail++] = startIdx;
  visited[startIdx] = 1;

  while (head < tail) {
    const idx = queue[head++];
    const i = idx * 4;
    const dr = sourcePixels[i] - sr;
    const dg = sourcePixels[i + 1] - sg;
    const db = sourcePixels[i + 2] - sb;
    if (dr * dr + dg * dg + db * db > tol2) continue;
    data[idx] = value;

    const px = idx % width;
    const py = (idx / width) | 0;
    if (px > minX && !visited[idx - 1]) { visited[idx - 1] = 1; queue[tail++] = idx - 1; }
    if (px < maxX && !visited[idx + 1]) { visited[idx + 1] = 1; queue[tail++] = idx + 1; }
    if (py > minY && !visited[idx - width]) { visited[idx - width] = 1; queue[tail++] = idx - width; }
    if (py < maxY && !visited[idx + width]) { visited[idx + width] = 1; queue[tail++] = idx + width; }
  }

  return next;
}

export function mergeMasksPreferForeground(base: AlphaMask, overlay: AlphaMask): AlphaMask {
  const next = cloneAlphaMask(base);
  for (let i = 0; i < next.data.length; i++) {
    next.data[i] = Math.max(next.data[i], overlay.data[i] ?? 0);
  }
  return next;
}

/**
 * Nearest-neighbour resample of an alpha mask.
 *
 * A segmentation model may return its mask at its own internal resolution rather
 * than the size of the image it was handed; this brings it back to the expected
 * dimensions before `embedRegionMask` pastes it into the frame. No-ops when the
 * size already matches.
 */
/** Lit pixels in a mask. Used to tell a real flood from one that changed nothing. */
export function countMaskLit(mask: AlphaMask): number {
  let n = 0;
  for (let i = 0; i < mask.data.length; i++) if (mask.data[i] > 127) n++;
  return n;
}

/**
 * NORMALIZED bounding box of a mask's lit pixels, or null when it is empty.
 *
 * The flood tools need a boundary they may not cross, and the coach's selection
 * box is the natural one — but it is optional, and a hard "no box, no flood"
 * made both buttons inert with no explanation. The mask's own extent is the
 * honest fallback: it is the region the coach is demonstrably working in, it
 * always exists once there is anything to edit, and it still stops a fill from
 * escaping across the whole frame.
 *
 * `pad` widens it as a fraction of the box's own size, so flood-ADD can reach
 * the pixels just outside the current mask — which is the entire point of adding.
 */
export function maskBoundsNormalized(
  mask: AlphaMask,
  pad = 0,
): { x: number; y: number; width: number; height: number } | null {
  const { width, height, data } = mask;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (data[row + x] <= 127) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const px = bw * pad;
  const py = bh * pad;
  const x0 = Math.max(0, minX - px);
  const y0 = Math.max(0, minY - py);
  const x1 = Math.min(width, maxX + 1 + px);
  const y1 = Math.min(height, maxY + 1 + py);
  return { x: x0 / width, y: y0 / height, width: (x1 - x0) / width, height: (y1 - y0) / height };
}

export function resampleAlphaMask(mask: AlphaMask, dw: number, dh: number): AlphaMask {
  if (mask.width === dw && mask.height === dh) return mask;
  const data = new Uint8ClampedArray(dw * dh);
  const { width: sw, height: sh, data: src } = mask;
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / dw));
      data[y * dw + x] = src[sy * sw + sx];
    }
  }
  return { width: dw, height: dh, data };
}

/** Paste a smaller region mask into a full-frame alpha mask. */
export function embedRegionMask(
  frameWidth: number,
  frameHeight: number,
  originX: number,
  originY: number,
  regionMask: AlphaMask,
): AlphaMask {
  const data = new Uint8ClampedArray(frameWidth * frameHeight);
  const rw = regionMask.width;
  const rh = regionMask.height;
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const fx = originX + x;
      const fy = originY + y;
      if (fx < 0 || fy < 0 || fx >= frameWidth || fy >= frameHeight) continue;
      data[fy * frameWidth + fx] = regionMask.data[y * rw + x];
    }
  }
  return { width: frameWidth, height: frameHeight, data };
}

/**
 * Normalized selection box → half-open FRAME-space rect [px, x2) × [py, y2).
 *
 * Lifted out of `fillBoxMask` verbatim so "the pixels the box FILLS" and "the
 * pixels the box KEEPS" (`intersectMaskWithBox`) are computed by one piece of
 * arithmetic and cannot drift apart.
 */
function boxToMaskRect(
  frameWidth: number,
  frameHeight: number,
  box: { x: number; y: number; width: number; height: number },
  padding: number,
) {
  return {
    px: Math.max(0, Math.round((box.x - padding * box.width) * frameWidth)),
    py: Math.max(0, Math.round((box.y - padding * box.height) * frameHeight)),
    x2: Math.min(frameWidth, Math.round((box.x + box.width * (1 + padding)) * frameWidth)),
    y2: Math.min(frameHeight, Math.round((box.y + box.height * (1 + padding)) * frameHeight)),
  };
}

/** Rectangular fallback when auto-matte returns empty (keeps coach workflow unblocked). */
export function fillBoxMask(
  frameWidth: number,
  frameHeight: number,
  box: { x: number; y: number; width: number; height: number },
  padding = 0.04,
): AlphaMask {
  const data = new Uint8ClampedArray(frameWidth * frameHeight);
  const { px, py, x2, y2 } = boxToMaskRect(frameWidth, frameHeight, box, padding);
  for (let y = py; y < y2; y++) {
    for (let x = px; x < x2; x++) {
      data[y * frameWidth + x] = 255;
    }
  }
  return { width: frameWidth, height: frameHeight, data };
}

/**
 * Clear every mask pixel OUTSIDE the selection box, keep what is inside.
 *
 * Auto BG mattes the WHOLE frame (`buildMatteAlphaMask` takes a bitmap, not a
 * box), so without this the coach's selection is ignored and the entire frame
 * comes back as "keep". Scoping the result restores the selection box as the
 * boundary of the layer.
 */
export function intersectMaskWithBox(
  mask: AlphaMask,
  box: { x: number; y: number; width: number; height: number },
  padding = 0,
): AlphaMask {
  const next = cloneAlphaMask(mask);
  const { width, height, data } = next;
  const { px, py, x2, y2 } = boxToMaskRect(width, height, box, padding);
  for (let y = 0; y < height; y++) {
    const inRowBand = y >= py && y < y2;
    for (let x = 0; x < width; x++) {
      if (inRowBand && x >= px && x < x2) continue;
      data[y * width + x] = 0;
    }
  }
  return next;
}
