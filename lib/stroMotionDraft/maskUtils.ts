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

export function applyBrushToMask(
  mask: AlphaMask,
  x: number,
  y: number,
  radius: number,
  mode: 'add' | 'remove',
): AlphaMask {
  const next = cloneAlphaMask(mask);
  const { width, height, data } = next;
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

/** Rectangular fallback when auto-matte returns empty (keeps coach workflow unblocked). */
export function fillBoxMask(
  frameWidth: number,
  frameHeight: number,
  box: { x: number; y: number; width: number; height: number },
  padding = 0.04,
): AlphaMask {
  const data = new Uint8ClampedArray(frameWidth * frameHeight);
  const px = Math.max(0, Math.round((box.x - padding * box.width) * frameWidth));
  const py = Math.max(0, Math.round((box.y - padding * box.height) * frameHeight));
  const x2 = Math.min(
    frameWidth,
    Math.round((box.x + box.width * (1 + padding)) * frameWidth),
  );
  const y2 = Math.min(
    frameHeight,
    Math.round((box.y + box.height * (1 + padding)) * frameHeight),
  );
  for (let y = py; y < y2; y++) {
    for (let x = px; x < x2; x++) {
      data[y * frameWidth + x] = 255;
    }
  }
  return { width: frameWidth, height: frameHeight, data };
}
