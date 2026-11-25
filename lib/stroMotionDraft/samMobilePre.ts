/**
 * MobileSAM image preprocessing, pure (no DOM): resize so the LONGEST side is 1024, normalise with SAM's mean/std,
 * zero-pad the right/bottom to 1024 x 1024, channel-first. Mirrors segment-anything's ResizeLongestSide + preprocess.
 * Kept separate from samMobile.ts so it can be unit-tested in Node.
 */
export const MOBILE_SAM_SIZE = 1024;
const MEAN = [123.675, 116.28, 103.53];
const STD = [58.395, 57.12, 57.375];

/** Target size of the resized image (longest side = 1024, rounded like segment-anything: int(x + 0.5)). */
export function mobileSamTarget(w: number, h: number): { width: number; height: number; scale: number } {
  const scale = MOBILE_SAM_SIZE / Math.max(w, h);
  return { width: Math.floor(w * scale + 0.5), height: Math.floor(h * scale + 0.5), scale };
}

/** RGBA pixels of the ALREADY RESIZED image (width x height) -> Float32 [1,3,1024,1024], normalised, zero padded. */
export function rgbaToMobileSamInput(rgba: ArrayLike<number>, width: number, height: number): Float32Array {
  const S = MOBILE_SAM_SIZE;
  const out = new Float32Array(3 * S * S);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const o = y * S + x;
      out[o] = (rgba[i] - MEAN[0]) / STD[0];
      out[S * S + o] = (rgba[i + 1] - MEAN[1]) / STD[1];
      out[2 * S * S + o] = (rgba[i + 2] - MEAN[2]) / STD[2];
    }
  }
  return out;
}

/** Prompt points in video pixels -> the decoder's input space (1024 longest side). */
export function scalePoint(p: { x: number; y: number }, scale: number): [number, number] {
  return [p.x * scale, p.y * scale];
}
