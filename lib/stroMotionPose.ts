'use client';

/** MoveNet / BlazePose-style indices used across AngleMotion. */
export const POSE_IDX = {
  LEFT_SHOULDER: 5,
  RIGHT_SHOULDER: 6,
  LEFT_ELBOW: 7,
  RIGHT_ELBOW: 8,
  LEFT_WRIST: 9,
  RIGHT_WRIST: 10,
  LEFT_HIP: 11,
  RIGHT_HIP: 12,
  LEFT_KNEE: 13,
  RIGHT_KNEE: 14,
  LEFT_ANKLE: 15,
  RIGHT_ANKLE: 16,
} as const;

export interface StroMotionPoseKeypoint {
  x: number;
  y: number;
  score: number;
  name: string;
}

export interface PixelRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface TennisRacketZones {
  /** Handle, head, backswing, overhead, two-hand merge, etc. */
  zones: PixelRect[];
  combined: PixelRect | null;
}

const MIN_POSE_SCORE = 0.2;
/** Shared pose buffer radii — region expansion and ghost masks must match. */
export const POSE_BODY_RADIUS_UPPER = 44;
export const POSE_BODY_RADIUS_LOWER = 30;

export function clampPixelRect(rect: PixelRect, vw: number, vh: number): PixelRect {
  const x0 = Math.max(0, Math.min(vw - 1, rect.x0));
  const y0 = Math.max(0, Math.min(vh - 1, rect.y0));
  const x1 = Math.max(x0 + 1, Math.min(vw, rect.x1));
  const y1 = Math.max(y0 + 1, Math.min(vh, rect.y1));
  return { x0, y0, x1, y1 };
}

export function unionPixelRect(a: PixelRect, b: PixelRect): PixelRect {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

export function pixelRectArea(rect: PixelRect): number {
  return Math.max(0, rect.x1 - rect.x0) * Math.max(0, rect.y1 - rect.y0);
}

export function isRectContained(inner: PixelRect, outer: PixelRect): boolean {
  return inner.x0 >= outer.x0 && inner.y0 >= outer.y0 && inner.x1 <= outer.x1 && inner.y1 <= outer.y1;
}

function circleRect(cx: number, cy: number, radius: number): PixelRect {
  return { x0: cx - radius, y0: cy - radius, x1: cx + radius, y1: cy + radius };
}

function keypointRect(kp: StroMotionPoseKeypoint, radius: number): PixelRect {
  return circleRect(kp.x, kp.y, radius);
}

/** Dominant hitting arm — higher wrist score; tie-break by extension from shoulder. */
export function dominantArmIndices(keypoints: StroMotionPoseKeypoint[]): {
  shoulder: number;
  elbow: number;
  wrist: number;
} {
  const leftW = keypoints[POSE_IDX.LEFT_WRIST];
  const rightW = keypoints[POSE_IDX.RIGHT_WRIST];
  const leftS = keypoints[POSE_IDX.LEFT_SHOULDER];
  const rightS = keypoints[POSE_IDX.RIGHT_SHOULDER];

  let useRight = (rightW?.score ?? 0) >= (leftW?.score ?? 0);
  if (Math.abs((rightW?.score ?? 0) - (leftW?.score ?? 0)) < 0.05 && leftS && rightS && leftW && rightW) {
    const leftExt = Math.hypot(leftW.x - leftS.x, leftW.y - leftS.y);
    const rightExt = Math.hypot(rightW.x - rightS.x, rightW.y - rightS.y);
    useRight = rightExt >= leftExt;
  }

  return useRight
    ? { shoulder: POSE_IDX.RIGHT_SHOULDER, elbow: POSE_IDX.RIGHT_ELBOW, wrist: POSE_IDX.RIGHT_WRIST }
    : { shoulder: POSE_IDX.LEFT_SHOULDER, elbow: POSE_IDX.LEFT_ELBOW, wrist: POSE_IDX.LEFT_WRIST };
}

/**
 * Per-arm racket zones for tennis strokes:
 * - forward head (contact, volley, pronation)
 * - backswing / lag (reverse finish, trophy, racket drop)
 * - overhead cap (serve, smash)
 */
function armRacketZones(
  keypoints: StroMotionPoseKeypoint[],
  shoulderIdx: number,
  elbowIdx: number,
  wristIdx: number,
): PixelRect[] {
  const shoulder = keypoints[shoulderIdx];
  const elbow = keypoints[elbowIdx];
  const wrist = keypoints[wristIdx];
  if (
    !shoulder || !elbow || !wrist ||
    shoulder.score < MIN_POSE_SCORE ||
    elbow.score < MIN_POSE_SCORE ||
    wrist.score < MIN_POSE_SCORE
  ) {
    return [];
  }

  const fdx = wrist.x - elbow.x;
  const fdy = wrist.y - elbow.y;
  const forearmLen = Math.hypot(fdx, fdy);
  if (forearmLen < 4) return [];

  const ux = fdx / forearmLen;
  const uy = fdy / forearmLen;

  const wristAboveShoulder = wrist.y < shoulder.y - forearmLen * 0.12;
  const isOverhead = wristAboveShoulder;

  // Forward extension scales up for serve/smash/overhead contact
  const forwardMult = isOverhead ? 2.7 : 2.25;
  const backswingMult = isOverhead ? 1.35 : 1.05;

  const headX = wrist.x + ux * forearmLen * forwardMult;
  const headY = wrist.y + uy * forearmLen * forwardMult;
  const backX = wrist.x - ux * forearmLen * backswingMult;
  const backY = wrist.y - uy * forearmLen * backswingMult;

  const headR = Math.max(24, forearmLen * (isOverhead ? 1.05 : 0.92));
  const handleR = Math.max(16, forearmLen * 0.38);
  const backR = Math.max(20, forearmLen * 0.78);

  const zones: PixelRect[] = [
    circleRect(wrist.x, wrist.y, handleR),
    circleRect(headX, headY, headR),
    circleRect(backX, backY, backR),
    // Full arm sweep (windshield wiper / reverse finish arc)
    circleRect(
      (shoulder.x + headX) / 2,
      (shoulder.y + headY) / 2,
      Math.hypot(headX - shoulder.x, headY - shoulder.y) / 2 + headR * 0.45,
    ),
  ];

  if (isOverhead) {
    const topY = Math.min(shoulder.y, wrist.y, headY) - forearmLen * 0.65;
    zones.push({
      x0: Math.min(shoulder.x, wrist.x, headX) - headR,
      y0: topY - headR * 0.4,
      x1: Math.max(shoulder.x, wrist.x, headX) + headR,
      y1: Math.max(shoulder.y, wrist.y) + handleR,
    });
  }

  return zones;
}

/** Two-handed backhand: merge wrists when both hands are on the racket. */
function twoHandedMergeZone(keypoints: StroMotionPoseKeypoint[]): PixelRect | null {
  const lw = keypoints[POSE_IDX.LEFT_WRIST];
  const rw = keypoints[POSE_IDX.RIGHT_WRIST];
  if (!lw || !rw || lw.score < MIN_POSE_SCORE || rw.score < MIN_POSE_SCORE) return null;

  const dist = Math.hypot(lw.x - rw.x, lw.y - rw.y);
  const le = keypoints[POSE_IDX.LEFT_ELBOW];
  const re = keypoints[POSE_IDX.RIGHT_ELBOW];
  const forearmRef = Math.max(
    le && lw ? Math.hypot(lw.x - le.x, lw.y - le.y) : 0,
    re && rw ? Math.hypot(rw.x - re.x, rw.y - re.y) : 0,
  );
  if (forearmRef < 4 || dist > forearmRef * 2.2) return null;

  const mx = (lw.x + rw.x) / 2;
  const my = (lw.y + rw.y) / 2;
  const extR = Math.max(28, forearmRef * 1.15);
  return circleRect(mx, my, extR);
}

/**
 * Tennis-aware racket zones across both arms.
 * Covers forehand, backhand (1H/2H), serve, volley, smash arcs.
 */
export function estimateTennisRacketZones(
  keypoints: StroMotionPoseKeypoint[],
  vw: number,
  vh: number,
): TennisRacketZones {
  const zones: PixelRect[] = [
    ...armRacketZones(keypoints, POSE_IDX.LEFT_SHOULDER, POSE_IDX.LEFT_ELBOW, POSE_IDX.LEFT_WRIST),
    ...armRacketZones(keypoints, POSE_IDX.RIGHT_SHOULDER, POSE_IDX.RIGHT_ELBOW, POSE_IDX.RIGHT_WRIST),
  ];

  const twoHand = twoHandedMergeZone(keypoints);
  if (twoHand) zones.push(twoHand);

  let combined: PixelRect | null = null;
  for (const z of zones) {
    combined = combined ? unionPixelRect(combined, z) : z;
  }

  return { zones, combined: combined ? clampPixelRect(combined, vw, vh) : null };
}

/** @deprecated use estimateTennisRacketZones */
export function estimateRacketZone(keypoints: StroMotionPoseKeypoint[]): PixelRect | null {
  return estimateTennisRacketZones(keypoints, 99999, 99999).combined;
}

/** Body + limbs without racket zones (for expansion attribution). */
export function poseBodyUnionRect(
  keypoints: StroMotionPoseKeypoint[] | null,
  vw: number,
  vh: number,
): PixelRect | null {
  if (!keypoints?.length) return null;

  const indices = [
    POSE_IDX.LEFT_SHOULDER,
    POSE_IDX.RIGHT_SHOULDER,
    POSE_IDX.LEFT_ELBOW,
    POSE_IDX.RIGHT_ELBOW,
    POSE_IDX.LEFT_WRIST,
    POSE_IDX.RIGHT_WRIST,
    POSE_IDX.LEFT_HIP,
    POSE_IDX.RIGHT_HIP,
    POSE_IDX.LEFT_KNEE,
    POSE_IDX.RIGHT_KNEE,
    POSE_IDX.LEFT_ANKLE,
    POSE_IDX.RIGHT_ANKLE,
  ];

  let union: PixelRect | null = null;
  for (const idx of indices) {
    const kp = keypoints[idx];
    if (!kp || kp.score < MIN_POSE_SCORE) continue;
    const r = keypointRect(kp, idx <= POSE_IDX.RIGHT_WRIST ? POSE_BODY_RADIUS_UPPER : POSE_BODY_RADIUS_LOWER);
    union = union ? unionPixelRect(union, r) : r;
  }

  return union ? clampPixelRect(union, vw, vh) : null;
}

/** Union of body + all tennis racket zones for one pose frame. */
export function poseUnionRect(
  keypoints: StroMotionPoseKeypoint[] | null,
  vw: number,
  vh: number,
): PixelRect | null {
  let union = poseBodyUnionRect(keypoints, vw, vh);
  if (!keypoints?.length) return union;

  const racket = estimateTennisRacketZones(keypoints, vw, vh).combined;
  if (racket) union = union ? unionPixelRect(union, racket) : racket;

  return union;
}

/** Racket-only union (no body joints) for validation attribution. */
export function racketZoneUnionRect(
  keypoints: StroMotionPoseKeypoint[] | null,
  vw: number,
  vh: number,
): PixelRect | null {
  if (!keypoints?.length) return null;
  return estimateTennisRacketZones(keypoints, vw, vh).combined;
}

export function countSuccessfulPoses(poses: (StroMotionPoseKeypoint[] | null)[]): number {
  return poses.filter((p) => p && p.some((k) => k.score >= MIN_POSE_SCORE)).length;
}

/** Expand region until all pose + racket zones from every frame are contained. */
export function ensureRegionContainsAllPoses(
  region: PixelRect,
  poses: (StroMotionPoseKeypoint[] | null)[],
  vw: number,
  vh: number,
  padPx = 14,
): PixelRect {
  let expanded = { ...region };

  for (const pose of poses) {
    if (!pose) continue;
    const body = poseBodyUnionRect(pose, vw, vh);
    const racket = racketZoneUnionRect(pose, vw, vh);
    for (const rect of [body, racket]) {
      if (!rect) continue;
      if (!isRectContained(rect, expanded)) {
        expanded = unionPixelRect(expanded, rect);
        expanded = {
          x0: expanded.x0 - padPx,
          y0: expanded.y0 - padPx,
          x1: expanded.x1 + padPx,
          y1: expanded.y1 + padPx,
        };
      }
    }
  }

  return clampPixelRect(expanded, vw, vh);
}

export interface RegionExpansionMetrics {
  coachBoxAreaPx: number;
  effectiveAreaPx: number;
  effectiveAreaPercentOfFrame: number;
  coachAreaPercentOfFrame: number;
  areaExpansionRatio: number;
  poseExpansionContributionPercent: number;
  racketZoneExpansionContributionPercent: number;
  motionExpansionContributionPercent: number;
  edgeSafeguardContributionPercent: number;
}

export function computeRegionExpansionMetrics(
  coachRect: PixelRect,
  effectiveRect: PixelRect,
  poseOnlyUnion: PixelRect | null,
  racketOnlyUnion: PixelRect | null,
  motionUnion: PixelRect | null,
  beforeEdgeRect: PixelRect,
  vw: number,
  vh: number,
): RegionExpansionMetrics {
  const frameArea = vw * vh;
  const coachArea = pixelRectArea(coachRect);
  const effectiveArea = pixelRectArea(effectiveRect);

  const afterPose = poseOnlyUnion ? unionPixelRect(coachRect, poseOnlyUnion) : coachRect;
  const afterRacket = racketOnlyUnion ? unionPixelRect(afterPose, racketOnlyUnion) : afterPose;
  const afterMotion = motionUnion ? unionPixelRect(afterRacket, motionUnion) : afterRacket;

  const poseAdded = pixelRectArea(afterPose) - coachArea;
  const racketAdded = pixelRectArea(afterRacket) - pixelRectArea(afterPose);
  const motionAdded = pixelRectArea(afterMotion) - pixelRectArea(afterRacket);
  const edgeAdded = pixelRectArea(effectiveRect) - pixelRectArea(beforeEdgeRect);

  const denom = Math.max(1, coachArea);

  return {
    coachBoxAreaPx: coachArea,
    effectiveAreaPx: effectiveArea,
    effectiveAreaPercentOfFrame: (effectiveArea / frameArea) * 100,
    coachAreaPercentOfFrame: (coachArea / frameArea) * 100,
    areaExpansionRatio: effectiveArea / denom,
    poseExpansionContributionPercent: (poseAdded / denom) * 100,
    racketZoneExpansionContributionPercent: (racketAdded / denom) * 100,
    motionExpansionContributionPercent: (motionAdded / denom) * 100,
    edgeSafeguardContributionPercent: (Math.max(0, edgeAdded) / denom) * 100,
  };
}

export interface PerFrameValidation {
  time: number;
  poseDetected: boolean;
  wristVisible: boolean;
  racketZoneVisible: boolean;
  wouldClipWithoutPose: boolean;
  wouldClipWithoutRacket: boolean;
}

export function validatePerFrame(
  time: number,
  pose: StroMotionPoseKeypoint[] | null,
  coachRect: PixelRect,
  effectiveRect: PixelRect,
  vw: number,
  vh: number,
): PerFrameValidation {
  const body = poseBodyUnionRect(pose, vw, vh);
  const racket = racketZoneUnionRect(pose, vw, vh);
  const lw = pose?.[POSE_IDX.LEFT_WRIST];
  const rw = pose?.[POSE_IDX.RIGHT_WRIST];
  const wristVisible = !!(lw && lw.score >= MIN_POSE_SCORE) || !!(rw && rw.score >= MIN_POSE_SCORE);

  return {
    time,
    poseDetected: !!(pose && pose.some((k) => k.score >= MIN_POSE_SCORE)),
    wristVisible,
    racketZoneVisible: !!racket,
    wouldClipWithoutPose: !!(body && !isRectContained(body, coachRect)),
    wouldClipWithoutRacket: !!(racket && !isRectContained(racket, coachRect)),
  };
}

export interface StroMotionValidationReport {
  strokeCoverageNotes: string[];
  expansion: RegionExpansionMetrics;
  perFrame: PerFrameValidation[];
  clippingWarnings: string[];
  allFramesPass: boolean;
}

export function buildStroMotionValidationReport(
  coachRect: PixelRect,
  effectiveRect: PixelRect,
  beforeEdgeRect: PixelRect,
  poseOnlyGlobalUnion: PixelRect | null,
  racketOnlyGlobalUnion: PixelRect | null,
  motionGlobalUnion: PixelRect | null,
  sampleTimes: number[],
  poses: (StroMotionPoseKeypoint[] | null)[],
  vw: number,
  vh: number,
): StroMotionValidationReport {
  const expansion = computeRegionExpansionMetrics(
    coachRect,
    effectiveRect,
    poseOnlyGlobalUnion,
    racketOnlyGlobalUnion,
    motionGlobalUnion,
    beforeEdgeRect,
    vw,
    vh,
  );

  const perFrame = sampleTimes.map((time, i) =>
    validatePerFrame(time, poses[i] ?? null, coachRect, effectiveRect, vw, vh),
  );

  const clippingWarnings: string[] = [];
  for (let i = 0; i < perFrame.length; i++) {
    const pf = perFrame[i];
    const pose = poses[i];
    if (!pose) {
      clippingWarnings.push(`Frame @ ${pf.time.toFixed(3)}s: pose not detected — racket visibility relies on motion mask`);
      continue;
    }
    const racket = racketZoneUnionRect(pose, vw, vh);
    const body = poseBodyUnionRect(pose, vw, vh);
    if (racket && !isRectContained(racket, effectiveRect)) {
      clippingWarnings.push(`Frame @ ${pf.time.toFixed(3)}s: racket zone exceeds effective region (check pose)`);
    }
    if (body && !isRectContained(body, effectiveRect)) {
      clippingWarnings.push(`Frame @ ${pf.time.toFixed(3)}s: body pose exceeds effective region`);
    }
  }

  const strokeCoverageNotes = [
    'Forehand: forward head + backswing zones cover lag, contact, windshield-wiper, reverse finish',
    'One-/two-handed backhand: both arms + two-hand merge when wrists are close',
    'Serve/smash: overhead cap when wrist is above shoulder (trophy, drop, pronation)',
    'Volley: compact handle + forward head zones at reduced extension',
  ];

  return {
    strokeCoverageNotes,
    expansion,
    perFrame,
    clippingWarnings,
    allFramesPass: clippingWarnings.length === 0,
  };
}

export function logStroMotionValidationReport(report: StroMotionValidationReport): void {
  console.group('[StroMotion] Tennis validation report');
  console.log('Effective region size:', {
    areaPx: report.expansion.effectiveAreaPx,
    percentOfFrame: `${report.expansion.effectiveAreaPercentOfFrame.toFixed(1)}%`,
    coachPercentOfFrame: `${report.expansion.coachAreaPercentOfFrame.toFixed(1)}%`,
    expansionRatio: `${report.expansion.areaExpansionRatio.toFixed(2)}× coach box`,
  });
  console.log('Expansion contributions (% of coach box area):', {
    pose: `${report.expansion.poseExpansionContributionPercent.toFixed(1)}%`,
    racketZone: `${report.expansion.racketZoneExpansionContributionPercent.toFixed(1)}%`,
    motion: `${report.expansion.motionExpansionContributionPercent.toFixed(1)}%`,
    edgeSafeguard: `${report.expansion.edgeSafeguardContributionPercent.toFixed(1)}%`,
  });
  console.table(
    report.perFrame.map((f) => ({
      time: f.time.toFixed(3),
      pose: f.poseDetected ? '✓' : '✗',
      wrist: f.wristVisible ? '✓' : '✗',
      racketZone: f.racketZoneVisible ? '✓' : '✗',
      clipWithoutPose: f.wouldClipWithoutPose ? 'YES' : 'no',
      clipWithoutRacket: f.wouldClipWithoutRacket ? 'YES' : 'no',
    })),
  );
  if (report.clippingWarnings.length > 0) {
    console.warn('Clipping warnings:', report.clippingWarnings);
  } else {
    console.log('Clipping check: PASS — racket, hand, and follow-through contained');
  }
  console.log('Stroke coverage:', report.strokeCoverageNotes);
  console.log('Overall:', report.allFramesPass ? 'PASS' : 'REVIEW');
  console.groupEnd();
}
