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

/** Click-to-remove: flood-fill similar pixels (from source frame) and clear mask alpha. */
export function floodRemoveInMask(
  mask: AlphaMask,
  sourcePixels: Uint8ClampedArray,
  sourceWidth: number,
  x: number,
  y: number,
  tolerance = 38,
): AlphaMask {
  const next = cloneAlphaMask(mask);
  const { width, height, data } = next;
  if (sourceWidth !== width) return next;
  const cx = Math.round(x);
  const cy = Math.round(y);
  if (cx < 0 || cy < 0 || cx >= width || cy >= height) return next;

  const startIdx = cy * width + cx;
  const si = startIdx * 4;
  const sr = sourcePixels[si];
  const sg = sourcePixels[si + 1];
  const sb = sourcePixels[si + 2];

  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  queue[tail++] = startIdx;
  visited[startIdx] = 1;

  const matches = (idx: number) => {
    const i = idx * 4;
    return Math.hypot(sourcePixels[i] - sr, sourcePixels[i + 1] - sg, sourcePixels[i + 2] - sb) <= tolerance;
  };

  while (head < tail) {
    const idx = queue[head++];
    if (!matches(idx)) continue;
    data[idx] = 0;

    const px = idx % width;
    const py = (idx / width) | 0;
    const neighbors = [
      px > 0 ? idx - 1 : -1,
      px < width - 1 ? idx + 1 : -1,
      py > 0 ? idx - width : -1,
      py < height - 1 ? idx + width : -1,
    ];
    for (const nIdx of neighbors) {
      if (nIdx < 0 || visited[nIdx]) continue;
      visited[nIdx] = 1;
      queue[tail++] = nIdx;
    }
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
