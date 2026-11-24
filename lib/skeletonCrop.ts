/**
 * Crop-based tracking for the single-player AI Track pass (pure geometry).
 *
 * Measured on the Demo clip (MediaPipe heavy, desktop): a player ≈280 px tall
 * in a 1080p frame was missed on 21/90 frames full-frame (12 % jumps, jerk p95
 * 0.67) but tracked on 90/90 inside a crop (0 % jumps, jerk p95 0.016); a large
 * player (≈600 px) was slightly WORSE in a crop (jerk p95 0.017 vs 0.013). So the
 * crop is used only while the tracked player is small (< CROP_BELOW of frame
 * height) and every crop result is checked; a failed check re-acquires on the
 * FULL frame in the same step. Large players keep today's full-frame path.
 */
import { poseBox, type Box, type TrackKp } from './aiTrackLock';

export type { Box };
export interface Rect { x: number; y: number; w: number; h: number }

/** Crop only while the player's box is shorter than this fraction of the frame height. */
export const CROP_BELOW = 0.5;
/** Crop side = longest box side × (1 + CROP_PAD): ~35 % margin each side, for the racket arm and fast reach. */
export const CROP_PAD = 0.7;
const MIN_CROP_PX = 192;
/** ≥ this many of the 12 body joints must be confident for a crop result to be accepted. */
const MIN_BODY_JOINTS = 6;
const BODY_IDX = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
/** Result box height may change by at most this factor vs the previous box. */
const SIZE_RATIO = 2;
/** Result centre may move at most this many previous-box heights in one step. */
const MAX_MOVE_BH = 1;
/** Confident joints within this fraction of the crop side of a crop edge ⇒ the crop may have cut the player. */
const EDGE_FRAC = 0.03;

const boxH = (b: Box) => b.y1 - b.y0;
const centre = (b: Box) => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });

/** Is this player small enough (and known) for crop tracking? */
export function shouldCrop(box: Box | null, frameH: number): boolean {
  return !!box && boxH(box) > 8 && boxH(box) < CROP_BELOW * frameH;
}

/** Square crop around `box`, clamped inside the frame. */
export function cropRect(box: Box, vw: number, vh: number): Rect {
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  let s = Math.max(box.x1 - box.x0, box.y1 - box.y0) * (1 + CROP_PAD);
  s = Math.min(Math.max(s, MIN_CROP_PX), Math.min(vw, vh));
  const x = Math.min(Math.max(0, cx - s / 2), vw - s);
  const y = Math.min(Math.max(0, cy - s / 2), vh - s);
  return { x, y, w: s, h: s };
}

/** Crop-space → video-space (landmarks arrive scaled to the crop; offset them back). */
export function mapFromCrop<K extends { x: number; y: number }>(kps: K[], r: Rect): K[] {
  return kps.map((k) => ({ ...k, x: k.x + r.x, y: k.y + r.y }));
}

const confidentBody = (kps: readonly TrackKp[]) => BODY_IDX.filter((i) => kps[i] && kps[i].score >= 0.3).length;

/** Did confident joints pile up on a crop edge that is not also the frame edge? (player probably cut off) */
export function touchesCropEdge(kps: readonly TrackKp[], r: Rect, vw: number, vh: number): boolean {
  const m = r.w * EDGE_FRAC;
  let n = 0;
  for (const i of BODY_IDX) {
    const k = kps[i];
    if (!k || k.score < 0.3) continue;
    const left = k.x - r.x < m && r.x > 1, right = r.x + r.w - k.x < m && r.x + r.w < vw - 1;
    const top = k.y - r.y < m && r.y > 1, bottom = r.y + r.h - k.y < m && r.y + r.h < vh - 1;
    if (left || right || top || bottom) n++;
  }
  return n >= 2;
}

/**
 * Accept a crop result (already in video space) as the SAME player: enough
 * confident joints, a similar size, a plausible move, and not cut by the crop.
 * Anything else ⇒ caller re-acquires on the full frame.
 */
export function acceptCropPose(prev: Box, kps: readonly TrackKp[] | null, r: Rect, vw: number, vh: number): boolean {
  if (!kps || confidentBody(kps) < MIN_BODY_JOINTS) return false;
  const b = poseBox(kps);
  if (!b || boxH(b) <= 0) return false;
  const ratio = boxH(b) / boxH(prev);
  if (ratio > SIZE_RATIO || ratio < 1 / SIZE_RATIO) return false;
  const c0 = centre(prev), c1 = centre(b);
  if (Math.hypot(c1.x - c0.x, c1.y - c0.y) > MAX_MOVE_BH * boxH(prev)) return false;
  if (touchesCropEdge(kps, r, vw, vh)) return false;
  return true;
}

/** Body box of a pose (confident joints), or null. */
export const trackBox = (kps: readonly TrackKp[] | null | undefined): Box | null => poseBox(kps);
