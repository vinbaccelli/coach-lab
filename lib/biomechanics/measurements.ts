import { calcAngleDeg } from '@/lib/drawingTools';
import { dominantArmIndices } from '@/lib/stroMotionPose';
import type {
  BalanceMetrics,
  FootDirection,
  FootSpacing,
  JointAngles,
  PhaseMeasurements,
  PoseKeypoint,
  StringbedDirection,
} from '@/lib/biomechanics/types';

const MIN_SCORE = 0.2;
const POSE = {
  L_SHOULDER: 5,
  R_SHOULDER: 6,
  L_ELBOW: 7,
  R_ELBOW: 8,
  L_WRIST: 9,
  R_WRIST: 10,
  L_HIP: 11,
  R_HIP: 12,
  L_KNEE: 13,
  R_KNEE: 14,
  L_ANKLE: 15,
  R_ANKLE: 16,
} as const;

function kp(keypoints: PoseKeypoint[] | null, idx: number): PoseKeypoint | null {
  if (!keypoints) return null;
  const p = keypoints[idx];
  return p && p.score >= MIN_SCORE ? p : null;
}

function round(n: number, d = 1): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function angleBetweenLinesDeg(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
): number | null {
  const v1x = a2.x - a1.x;
  const v1y = a2.y - a1.y;
  const v2x = b2.x - b1.x;
  const v2y = b2.y - b1.y;
  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (m1 < 1e-3 || m2 < 1e-3) return null;
  const dot = (v1x * v2x + v1y * v2y) / (m1 * m2);
  return round((Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI, 1);
}

function vectorAngleDeg(dx: number, dy: number): number {
  return round(((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360, 1);
}

export function computeJointAngles(keypoints: PoseKeypoint[] | null): JointAngles {
  const ls = kp(keypoints, POSE.L_SHOULDER);
  const rs = kp(keypoints, POSE.R_SHOULDER);
  const le = kp(keypoints, POSE.L_ELBOW);
  const re = kp(keypoints, POSE.R_ELBOW);
  const lw = kp(keypoints, POSE.L_WRIST);
  const rw = kp(keypoints, POSE.R_WRIST);
  const lh = kp(keypoints, POSE.L_HIP);
  const rh = kp(keypoints, POSE.R_HIP);
  const lk = kp(keypoints, POSE.L_KNEE);
  const rk = kp(keypoints, POSE.R_KNEE);
  const la = kp(keypoints, POSE.L_ANKLE);
  const ra = kp(keypoints, POSE.R_ANKLE);

  return {
    leftElbowDeg: ls && le && lw ? calcAngleDeg(ls, le, lw) : null,
    rightElbowDeg: rs && re && rw ? calcAngleDeg(rs, re, rw) : null,
    leftKneeDeg: lh && lk && la ? calcAngleDeg(lh, lk, la) : null,
    rightKneeDeg: rh && rk && ra ? calcAngleDeg(rh, rk, ra) : null,
    leftShoulderDeg: lh && ls && le ? calcAngleDeg(lh, ls, le) : null,
    rightShoulderDeg: rh && rs && re ? calcAngleDeg(rh, rs, re) : null,
  };
}

export function computeShoulderHipSeparationDeg(
  keypoints: PoseKeypoint[] | null,
): number | null {
  const ls = kp(keypoints, POSE.L_SHOULDER);
  const rs = kp(keypoints, POSE.R_SHOULDER);
  const lh = kp(keypoints, POSE.L_HIP);
  const rh = kp(keypoints, POSE.R_HIP);
  if (!ls || !rs || !lh || !rh) return null;
  return angleBetweenLinesDeg(ls, rs, lh, rh);
}

export function computeFootSpacing(keypoints: PoseKeypoint[] | null): FootSpacing | null {
  const la = kp(keypoints, POSE.L_ANKLE);
  const ra = kp(keypoints, POSE.R_ANKLE);
  const ls = kp(keypoints, POSE.L_SHOULDER);
  const rs = kp(keypoints, POSE.R_SHOULDER);
  if (!la || !ra) return null;
  const absolutePx = round(Math.hypot(ra.x - la.x, ra.y - la.y), 1);
  const shoulderW = ls && rs ? Math.hypot(rs.x - ls.x, rs.y - ls.y) : 0;
  const normalizedToShoulderWidth = shoulderW > 1
    ? round(absolutePx / shoulderW, 2)
    : 0;
  return { absolutePx, normalizedToShoulderWidth };
}

/**
 * Foot direction as a screen-space unit vector (y grows downward).
 *
 * MoveNet exposes no toe/heel keypoint, so the foot cannot be read directly.
 * We model it anatomically: the foot is ~perpendicular to the shin, the toe is
 * always at/below the ankle (never above), and it points FORWARD toward the
 * player's stance/facing direction. This mirrors the on-canvas foot line
 * (Canvas.drawSkeletonOverlay) exactly so the AI-Detect number and the drawn
 * line always agree. `bodyCenterX` is the hip midpoint; `facing` is +1 when the
 * player faces screen-right, -1 when facing screen-left.
 */
export function estimateFootVector(
  knee: { x: number; y: number },
  ankle: { x: number; y: number },
  bodyCenterX: number | null,
  facing: 1 | -1,
): { x: number; y: number } {
  const shinX = ankle.x - knee.x;
  const shinY = ankle.y - knee.y;
  const shinLen = Math.hypot(shinX, shinY) || 1;
  // Ankle clearly ahead/behind the body → that side is forward; else use facing.
  let fwd: number = facing;
  if (bodyCenterX != null && Math.abs(ankle.x - bodyCenterX) > shinLen * 0.15) {
    fwd = ankle.x >= bodyCenterX ? 1 : -1;
  }
  // Two unit perpendiculars to the shin; pick the one that points down + forward.
  const p1x = shinY, p1y = -shinX;
  const p2x = -shinY, p2y = shinX;
  const l1 = Math.hypot(p1x, p1y) || 1;
  const l2 = Math.hypot(p2x, p2y) || 1;
  const s1 = 0.6 * (p1y / l1) + 0.4 * fwd * (p1x / l1);
  const s2 = 0.6 * (p2y / l2) + 0.4 * fwd * (p2x / l2);
  let dirX = s1 >= s2 ? p1x / l1 : p2x / l2;
  let dirY = s1 >= s2 ? p1y / l1 : p2y / l2;
  // Hard guarantee: never point the toe above the ankle.
  if (dirY < 0) { dirY = 0; dirX = fwd; const l = Math.hypot(dirX, dirY) || 1; dirX /= l; dirY /= l; }
  return { x: dirX, y: dirY };
}

/** Named (appended, index ≥17) keypoint lookup — real MediaPipe foot points. */
function namedKp(keypoints: PoseKeypoint[] | null, name: string): PoseKeypoint | null {
  if (!keypoints) return null;
  for (let i = 17; i < keypoints.length; i++) {
    const p = keypoints[i] as PoseKeypoint & { name?: string };
    if (p?.name === name && p.score >= 0.3) return p;
  }
  return null;
}

/**
 * Foot direction (degrees). Uses REAL ankle→toe (foot_index) when MediaPipe
 * foot keypoints are present (AI Track / AI Detect enrich the pose with them);
 * falls back to the anatomical shin-perpendicular estimate otherwise.
 */
export function computeFootDirection(keypoints: PoseKeypoint[] | null): FootDirection {
  const lk = kp(keypoints, POSE.L_KNEE);
  const rk = kp(keypoints, POSE.R_KNEE);
  const la = kp(keypoints, POSE.L_ANKLE);
  const ra = kp(keypoints, POSE.R_ANKLE);
  const lh = kp(keypoints, POSE.L_HIP);
  const rh = kp(keypoints, POSE.R_HIP);
  const nose = kp(keypoints, 0);
  const lToe = namedKp(keypoints, 'left_foot_index');
  const rToe = namedKp(keypoints, 'right_foot_index');

  const hipXs = [lh, rh].filter((h): h is PoseKeypoint => !!h).map((h) => h.x);
  const bodyCenterX = hipXs.length ? hipXs.reduce((a, b) => a + b, 0) / hipXs.length : null;
  const facing: 1 | -1 = bodyCenterX != null && nose ? (nose.x >= bodyCenterX ? 1 : -1) : 1;

  let leftFootDeg: number | null = null;
  let rightFootDeg: number | null = null;
  if (la && lToe) leftFootDeg = vectorAngleDeg(lToe.x - la.x, lToe.y - la.y);
  else if (lk && la) { const v = estimateFootVector(lk, la, bodyCenterX, facing); leftFootDeg = vectorAngleDeg(v.x, v.y); }
  if (ra && rToe) rightFootDeg = vectorAngleDeg(rToe.x - ra.x, rToe.y - ra.y);
  else if (rk && ra) { const v = estimateFootVector(rk, ra, bodyCenterX, facing); rightFootDeg = vectorAngleDeg(v.x, v.y); }

  return { leftFootDeg, rightFootDeg };
}

/** Center-of-mass proxy and stance orientation — objective fields only, no composite score. */
export function computeBalanceMetrics(
  keypoints: PoseKeypoint[] | null,
  footSpacing: FootSpacing | null,
  footDirection: FootDirection,
): BalanceMetrics {
  const la = kp(keypoints, POSE.L_ANKLE);
  const ra = kp(keypoints, POSE.R_ANKLE);
  const lh = kp(keypoints, POSE.L_HIP);
  const rh = kp(keypoints, POSE.R_HIP);
  const ls = kp(keypoints, POSE.L_SHOULDER);
  const rs = kp(keypoints, POSE.R_SHOULDER);

  let lateralComOffsetNormalized: number | null = null;
  let verticalComOffsetPx: number | null = null;

  if (la && ra && lh && rh) {
    const ankleMidX = (la.x + ra.x) / 2;
    const hipMidX = (lh.x + rh.x) / 2;
    const ankleMidY = (la.y + ra.y) / 2;
    const hipMidY = (lh.y + rh.y) / 2;
    verticalComOffsetPx = round(ankleMidY - hipMidY, 1);
    const shoulderW = ls && rs ? Math.hypot(rs.x - ls.x, rs.y - ls.y) : 0;
    if (shoulderW > 1) {
      lateralComOffsetNormalized = round((ankleMidX - hipMidX) / shoulderW, 2);
    }
  }

  let footOrientationSpreadDeg: number | null = null;
  if (
    footDirection.leftFootDeg !== null
    && footDirection.rightFootDeg !== null
  ) {
    const diff = Math.abs(footDirection.leftFootDeg - footDirection.rightFootDeg);
    footOrientationSpreadDeg = round(Math.min(diff, 360 - diff), 1);
  }

  const stanceWidthNormalized = footSpacing?.normalizedToShoulderWidth ?? null;

  return {
    lateralComOffsetNormalized,
    verticalComOffsetPx,
    footOrientationSpreadDeg,
    stanceWidthNormalized,
  };
}

/** Racket angle from dominant wrist through estimated tip (handle → tip vector). */
export function computeRacketAngleDeg(keypoints: PoseKeypoint[] | null): number | null {
  if (!keypoints?.length) return null;
  try {
    const arm = dominantArmIndices(keypoints);
    const elbow = kp(keypoints, arm.elbow);
    const wrist = kp(keypoints, arm.wrist);
    if (!elbow || !wrist) return null;
    const dx = wrist.x - elbow.x;
    const dy = wrist.y - elbow.y;
    const len = Math.hypot(dx, dy);
    if (len < 4) return null;
    const ux = dx / len;
    const uy = dy / len;
    const tipX = wrist.x + ux * len * 2.25;
    const tipY = wrist.y + uy * len * 2.25;
    return vectorAngleDeg(tipX - wrist.x, tipY - wrist.y);
  } catch {
    return null;
  }
}

/**
 * Stringbed direction — estimated from forearm plane (proxy until visual detection).
 * Perpendicular to handle→tip in 2D; flagged low-confidence for coach verification.
 */
export function computeStringbedDirection(keypoints: PoseKeypoint[] | null): StringbedDirection {
  const racketDeg = computeRacketAngleDeg(keypoints);
  if (racketDeg === null) {
    return {
      available: false,
      degrees: null,
      confidence: 0,
      note: 'Insufficient pose confidence — manual confirmation recommended',
    };
  }
  return {
    available: true,
    degrees: round((racketDeg + 90) % 360, 1),
    confidence: 0.35,
    note: 'Pose-geometry estimate — verify visually or confirm manually in a future pass',
  };
}

export function computePhaseMeasurements(
  phaseId: string,
  phaseLabel: string,
  timeSec: number,
  keypoints: PoseKeypoint[] | null,
): PhaseMeasurements {
  const footSpacing = computeFootSpacing(keypoints);
  const footDirection = computeFootDirection(keypoints);
  return {
    phaseId,
    phaseLabel,
    timeSec: round(timeSec, 3),
    jointAngles: computeJointAngles(keypoints),
    shoulderHipSeparationDeg: computeShoulderHipSeparationDeg(keypoints),
    footSpacing,
    footDirection,
    balance: computeBalanceMetrics(keypoints, footSpacing, footDirection),
    racketAngleDeg: computeRacketAngleDeg(keypoints),
    stringbedDirection: computeStringbedDirection(keypoints),
  };
}
