/**
 * RTMPose spike — pure pre/post-processing (no ONNX runtime, no DOM), so it is testable in node and shared by
 * the desktop benchmark and the browser engine. Mirrors the official mmpose/mmdeploy pipelines
 * (rtmpose-*_simcc-body7_pt-body7_420e-256x192: pipeline.json "TopDownGetBboxCenterScale padding 1.25",
 * "TopDownAffine 192x256", RGB mean/std normalise, SimCCLabelDecode split ratio 2.0).
 */

export const COCO17 = [
  'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear', 'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
] as const;

export const IN_W = 192;
export const IN_H = 256;
export const SIMCC_X = 384; // IN_W × split ratio
export const SIMCC_Y = 512; // IN_H × split ratio
export const SPLIT = 2;
export const BBOX_PADDING = 1.25;

export interface Box { x: number; y: number; w: number; h: number }
export interface CropSpec { cx: number; cy: number; sw: number; sh: number }
export interface Kp { x: number; y: number; score: number; name: string }

/** bbox → centre/scale with the model's aspect ratio (mmpose TopDownGetBboxCenterScale). */
export function cropFromBox(box: Box, padding = BBOX_PADDING): CropSpec {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  let w = box.w, h = box.h;
  const aspect = IN_W / IN_H;
  if (w > h * aspect) h = w / aspect; else w = h * aspect;
  return { cx, cy, sw: w * padding, sh: h * padding };
}

/** RGBA frame → Float32 CHW tensor [1,3,256,192], bilinear warp of the crop (black outside the frame), RGB mean/std normalised. */
export function cropToTensor(rgba: Uint8ClampedArray | Uint8Array, srcW: number, srcH: number, c: CropSpec): Float32Array {
  const out = new Float32Array(3 * IN_H * IN_W);
  const mean = [123.675, 116.28, 103.53], std = [58.395, 57.12, 57.375];
  const x0 = c.cx - c.sw / 2, y0 = c.cy - c.sh / 2;
  const kx = c.sw / IN_W, ky = c.sh / IN_H;
  const plane = IN_H * IN_W;
  for (let v = 0; v < IN_H; v++) {
    const sy = y0 + (v + 0.5) * ky - 0.5;
    const iy = Math.floor(sy), fy = sy - iy;
    for (let u = 0; u < IN_W; u++) {
      const sx = x0 + (u + 0.5) * kx - 0.5;
      const ix = Math.floor(sx), fx = sx - ix;
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < 2; dy++) {
        const yy = iy + dy;
        if (yy < 0 || yy >= srcH) continue;
        const wy = dy ? fy : 1 - fy;
        for (let dx = 0; dx < 2; dx++) {
          const xx = ix + dx;
          if (xx < 0 || xx >= srcW) continue;
          const w = wy * (dx ? fx : 1 - fx);
          const p = (yy * srcW + xx) * 4;
          r += rgba[p] * w; g += rgba[p + 1] * w; b += rgba[p + 2] * w;
        }
      }
      const o = v * IN_W + u;
      out[o] = (r - mean[0]) / std[0];
      out[plane + o] = (g - mean[1]) / std[1];
      out[2 * plane + o] = (b - mean[2]) / std[2];
    }
  }
  return out;
}

/** Same normalisation for an already-cropped 192×256 RGBA image (the browser path draws the crop with a canvas transform). */
export function rgbaCropToTensor(rgba: Uint8ClampedArray | Uint8Array): Float32Array {
  const out = new Float32Array(3 * IN_H * IN_W);
  const mean = [123.675, 116.28, 103.53], std = [58.395, 57.12, 57.375];
  const plane = IN_H * IN_W;
  for (let i = 0; i < plane; i++) {
    out[i] = (rgba[i * 4] - mean[0]) / std[0];
    out[plane + i] = (rgba[i * 4 + 1] - mean[1]) / std[1];
    out[2 * plane + i] = (rgba[i * 4 + 2] - mean[2]) / std[2];
  }
  return out;
}

/** SimCC heads → 17 keypoints in FRAME pixels. Score = min(max over x, max over y) as in mmpose get_simcc_maximum. */
export function decodeSimcc(simccX: ArrayLike<number>, simccY: ArrayLike<number>, c: CropSpec): Kp[] {
  const kps: Kp[] = [];
  for (let k = 0; k < 17; k++) {
    let bx = 0, mx = -Infinity, by = 0, my = -Infinity;
    for (let i = 0; i < SIMCC_X; i++) { const v = simccX[k * SIMCC_X + i]; if (v > mx) { mx = v; bx = i; } }
    for (let i = 0; i < SIMCC_Y; i++) { const v = simccY[k * SIMCC_Y + i]; if (v > my) { my = v; by = i; } }
    const px = bx / SPLIT, py = by / SPLIT; // crop pixels (192×256)
    kps.push({
      name: COCO17[k],
      x: (px / IN_W) * c.sw + c.cx - c.sw / 2,
      y: (py / IN_H) * c.sh + c.cy - c.sh / 2,
      score: Math.max(0, Math.min(1, Math.min(mx, my))),
    });
  }
  return kps;
}

/** Next frame's box from this frame's confident joints (the tracked top-down policy; no person detector needed per frame). */
export function boxFromKeypoints(kps: Kp[], minScore = 0.3, grow = 1.15): Box | null {
  const pts = kps.filter((k) => k.score >= minScore);
  if (pts.length < 6) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const w = Math.max(8, x1 - x0) * grow, h = Math.max(8, y1 - y0) * grow;
  return { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h };
}

/** YOLOX letterbox for the mmdeploy end2end model: resize keep-ratio to 416, pad to square with 114, raw 0–255 (BGR order kept as in the pipeline: to_rgb false). */
export function letterboxYolox(rgba: Uint8ClampedArray | Uint8Array, srcW: number, srcH: number, size = 416): { tensor: Float32Array; scale: number } {
  const scale = Math.min(size / srcW, size / srcH);
  const nw = Math.round(srcW * scale), nh = Math.round(srcH * scale);
  const out = new Float32Array(3 * size * size).fill(114);
  const plane = size * size;
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(srcH - 1, Math.floor(y / scale));
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(srcW - 1, Math.floor(x / scale));
      const p = (sy * srcW + sx) * 4, o = y * size + x;
      out[o] = rgba[p + 2]; out[plane + o] = rgba[p + 1]; out[2 * plane + o] = rgba[p]; // BGR
    }
  }
  return { tensor: out, scale };
}

/** Best "person" (label 0) box from the end2end YOLOX outputs (dets [1,N,5] x1,y1,x2,y2,score; labels [1,N]), in frame pixels. */
export function bestPerson(dets: ArrayLike<number>, labels: ArrayLike<number | bigint>, scale: number, minScore = 0.3, prefer?: Box): Box | null {
  const n = labels.length;
  let best: Box | null = null, bestS = -1;
  for (let i = 0; i < n; i++) {
    if (Number(labels[i]) !== 0) continue;
    const s = dets[i * 5 + 4];
    if (s < minScore) continue;
    const b = { x: dets[i * 5] / scale, y: dets[i * 5 + 1] / scale, w: (dets[i * 5 + 2] - dets[i * 5]) / scale, h: (dets[i * 5 + 3] - dets[i * 5 + 1]) / scale };
    // with a previous box, prefer the person who overlaps it most (the player we follow), else the most confident
    const score = prefer ? iou(b, prefer) + s * 0.01 : s;
    if (score > bestS) { bestS = score; best = b; }
  }
  return best;
}

/**
 * Best "person" box from the stock Megvii YOLOX-tiny COCO ONNX (Apache-2.0 weights): one tensor [1,N,85] per anchor,
 * NOT grid-decoded: tx, ty, tw, th (offsets/log-sizes per stride 8/16/32 grid on the 416 letterbox), objectness, then 80 class scores
 * (scores already sigmoided). Person = class 0; score = objectness × class score. Selection rule as bestPerson
 * (follow the overlapping player, else most confident).
 */
export function bestPersonYoloxCoco(out: ArrayLike<number>, scale: number, minScore = 0.3, prefer?: Box, size = 416): Box | null {
  const stride = 85;
  const n = Math.floor(out.length / stride);
  const strides = [8, 16, 32];
  let best: Box | null = null, bestS = -1;
  let i = 0;
  for (const st of strides) {
    const g = size / st;
    for (let k = 0; k < g * g && i < n; k++, i++) {
      const o = i * stride;
      const s = out[o + 4] * out[o + 5];
      if (s < minScore) continue;
      const gx = k % g, gy = Math.floor(k / g);
      const cx = (out[o] + gx) * st, cy = (out[o + 1] + gy) * st;
      const w = Math.exp(out[o + 2]) * st, h = Math.exp(out[o + 3]) * st;
      const b = { x: (cx - w / 2) / scale, y: (cy - h / 2) / scale, w: w / scale, h: h / scale };
      const score = prefer ? iou(b, prefer) + s * 0.01 : s;
      if (score > bestS) { bestS = score; best = b; }
    }
  }
  return best;
}

export function iou(a: Box, b: Box): number {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const u = a.w * a.h + b.w * b.h - inter;
  return u > 0 ? inter / u : 0;
}

/** Browser path for YOLOX: a 416×416 RGBA canvas (video letterboxed top-left on 114 grey) → BGR CHW float, raw 0–255. */
export function rgba416ToYoloxTensor(rgba: Uint8ClampedArray | Uint8Array, size = 416): Float32Array {
  const out = new Float32Array(3 * size * size);
  const plane = size * size;
  for (let i = 0; i < plane; i++) {
    out[i] = rgba[i * 4 + 2]; out[plane + i] = rgba[i * 4 + 1]; out[2 * plane + i] = rgba[i * 4];
  }
  return out;
}

/** Where a video of size vw×vh is actually drawn inside a box of size bw×bh with object-fit: contain (letterbox / pillarbox). */
export function containRect(bw: number, bh: number, vw: number, vh: number): { scale: number; x: number; y: number; w: number; h: number } {
  const scale = Math.min(bw / vw, bh / vh);
  const w = vw * scale, h = vh * scale;
  return { scale, x: (bw - w) / 2, y: (bh - h) / 2, w, h };
}
