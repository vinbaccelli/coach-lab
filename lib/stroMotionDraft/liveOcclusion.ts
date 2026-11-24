/**
 * "Layers behind the player" for the generated Motion Layer video.
 *
 * The video is recorded step by step: the live frame at time t is the background and the ghost layers reached so
 * far are drawn over it, so the layers sat IN FRONT of the live player. To put them behind, the live player's
 * pixels in that frame must be known. The camera is normally fixed, so they are the pixels that differ from the
 * clean background plate (the per-pixel median of frames across the section, backgroundPlate.ts): anything that
 * moves is a minority of the samples and drops out of the median.
 *
 * Pure typed-array functions (no canvas), so they are unit tested.
 */

export interface LiveMask {
  width: number;
  height: number;
  /** 0 = background (a layer may show), 255 = the live player (a layer must not cover it). */
  alpha: Uint8ClampedArray;
  /** Share of the picture that differs from the plate, before the clean-up (0..1). */
  coverage: number;
  /** False when the picture differs almost everywhere: the camera moved or the plate does not fit. The mask is then empty. */
  reliable: boolean;
}

export interface LiveMaskOptions {
  /** Largest per-channel difference (0-255) that still counts as background. Default 34. */
  threshold?: number;
  /** Grow the player's area by this many pixels, so a layer never peeks out at its edge. Default 3. */
  grow?: number;
  /** Above this share of changed pixels the frame is treated as unreliable. Default 0.45. */
  maxCoverage?: number;
}

const boxMax = (src: Uint8Array, w: number, h: number, r: number): Uint8Array => {
  if (r <= 0) return src;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = -r; k <= r && !v; k++) { const xx = x + k; if (xx >= 0 && xx < w && src[y * w + xx]) v = 1; }
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = -r; k <= r && !v; k++) { const yy = y + k; if (yy >= 0 && yy < h && tmp[yy * w + x]) v = 1; }
      out[y * w + x] = v;
    }
  }
  return out;
};

/** Drop isolated changed pixels (video noise): keep a pixel only when at least 5 of its 3x3 neighbourhood changed. */
const denoise = (bin: Uint8Array, w: number, h: number): Uint8Array => {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!bin[y * w + x]) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w && bin[yy * w + xx]) n++;
        }
      }
      if (n >= 5) out[y * w + x] = 1;
    }
  }
  return out;
};

/** live and plate: RGBA, both w x h. */
export function livePlayerMask(
  live: Uint8ClampedArray, plate: Uint8ClampedArray, w: number, h: number, opts: LiveMaskOptions = {},
): LiveMask {
  const threshold = opts.threshold ?? 34;
  const grow = opts.grow ?? 3;
  const maxCoverage = opts.maxCoverage ?? 0.45;
  const n = w * h;
  const bin = new Uint8Array(n);
  let changed = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const d = Math.max(Math.abs(live[o] - plate[o]), Math.abs(live[o + 1] - plate[o + 1]), Math.abs(live[o + 2] - plate[o + 2]));
    if (d > threshold) { bin[i] = 1; changed++; }
  }
  const coverage = n ? changed / n : 0;
  if (coverage > maxCoverage) return { width: w, height: h, alpha: new Uint8ClampedArray(n), coverage, reliable: false };

  const grown = boxMax(denoise(bin, w, h), w, h, grow);
  // Soft edge: a 3x3 mean, so the cut-out does not look hard-edged.
  const alpha = new Uint8ClampedArray(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          s += grown[yy * w + xx]; c++;
        }
      }
      alpha[y * w + x] = Math.round((s / c) * 255);
    }
  }
  return { width: w, height: h, alpha, coverage, reliable: true };
}
