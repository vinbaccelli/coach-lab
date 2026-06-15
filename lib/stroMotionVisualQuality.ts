'use client';

import {
  estimateTennisRacketZones,
  POSE_IDX,
  POSE_BODY_RADIUS_LOWER,
  POSE_BODY_RADIUS_UPPER,
  racketZoneUnionRect,
  type PixelRect,
  type StroMotionPoseKeypoint,
} from '@/lib/stroMotionPose';

export interface MaskQualityMetrics {
  coveragePercent: number;
  /** Foreground pixels that closely match base (likely court artifacts). */
  foregroundLeakagePercent: number;
  /** Pose/racket zone pixels with insufficient alpha (body/racket holes). */
  backgroundLeakagePercent: number;
  posePreservationPercent: number;
  racketPreservationPercent: number;
}

export interface GhostRacketValidation {
  index: number;
  time: number;
  wristRegionPresent: boolean;
  racketRegionPresent: boolean;
  coveragePercent: number;
  coverageDropVsNeighbor: number;
  warnings: string[];
}

export interface ServeStressFrame {
  time: number;
  phase: 'trophy' | 'drop' | 'acceleration' | 'pronation' | 'finish' | 'groundstroke';
  racketBoundaryMarginPx: number;
  poseBoundaryMarginPx: number;
  nearBoundary: boolean;
}

export interface PerformanceTimings {
  captureMs: number;
  poseMs: number;
  regionMs: number;
  maskMs: number;
  bitmapMs: number;
  totalMs: number;
}

export interface ExportParityReport {
  previewHash: string | null;
  pngHash: string | null;
  videoFrameHash: string | null;
  previewMatchesPng: boolean | null;
  previewMatchesVideo: boolean | null;
  mismatches: string[];
}

export interface VisualQualityScorecard {
  maskQuality: 'PASS' | 'REVIEW';
  ghostSeparation: 'PASS' | 'REVIEW';
  racketPreservation: 'PASS' | 'REVIEW';
  serveValidation: 'PASS' | 'REVIEW' | 'N/A';
  exportParity: 'PASS' | 'REVIEW' | 'N/A';
  overall: 'PASS' | 'REVIEW';
  details: string[];
}

const MIN_POSE = 0.2;

function distToPoseOrZone(
  x: number,
  y: number,
  keypoints: StroMotionPoseKeypoint[] | null,
  zones: PixelRect[],
): number {
  let minD = Infinity;
  if (keypoints) {
    for (let i = 5; i <= 16; i++) {
      const kp = keypoints[i];
      if (!kp || kp.score < MIN_POSE) continue;
      const r = i <= POSE_IDX.RIGHT_WRIST ? POSE_BODY_RADIUS_UPPER : POSE_BODY_RADIUS_LOWER;
      const d = Math.hypot(x - kp.x, y - kp.y);
      if (d <= r) return 0;
      minD = Math.min(minD, d - r);
    }
  }
  for (const z of zones) {
    if (x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1) return 0;
  }
  return minD;
}

function isInWristRegion(
  x: number,
  y: number,
  keypoints: StroMotionPoseKeypoint[] | null,
): boolean {
  if (!keypoints) return false;
  for (const idx of [POSE_IDX.LEFT_WRIST, POSE_IDX.RIGHT_WRIST]) {
    const kp = keypoints[idx];
    if (!kp || kp.score < MIN_POSE) continue;
    if (Math.hypot(x - kp.x, y - kp.y) <= 22) return true;
  }
  return false;
}

function isInRacketZone(
  x: number,
  y: number,
  zones: PixelRect[],
): boolean {
  return zones.some((z) => x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1);
}

/** Build foreground mask — prefer preserving athlete over aggressive court removal. */
export function buildGhostLayerMask(
  current: ImageData,
  base: ImageData,
  keypoints: StroMotionPoseKeypoint[] | null,
  region: PixelRect,
  vw: number,
  vh: number,
): { layer: ImageData; metrics: MaskQualityMetrics } {
  const out = new ImageData(vw, vh);
  const tennisZones = keypoints
    ? estimateTennisRacketZones(keypoints, vw, vh).zones
    : [];

  let regionCount = 0;
  let fgCount = 0;
  let fgLeak = 0;
  let bgLeak = 0;
  let poseZoneCount = 0;
  let posePreserved = 0;
  let racketZoneCount = 0;
  let racketPreserved = 0;

  for (let y = region.y0; y < region.y1; y++) {
    for (let x = region.x0; x < region.x1; x++) {
      regionCount++;
      const i = (y * vw + x) * 4;
      const diff =
        Math.abs(current.data[i] - base.data[i]) +
        Math.abs(current.data[i + 1] - base.data[i + 1]) +
        Math.abs(current.data[i + 2] - base.data[i + 2]);

      const poseDist = distToPoseOrZone(x, y, keypoints, tennisZones);
      const inPose = poseDist <= 0;
      const inWrist = isInWristRegion(x, y, keypoints);
      const inRacket = isInRacketZone(x, y, tennisZones);

      if (inPose) {
        poseZoneCount++;
        if (inRacket) racketZoneCount++;
      }

      let alpha = 0;

      if (inPose) {
        // Preserve athlete: only drop pixels nearly identical to base
        if (diff >= 10) {
          alpha = diff >= 28 ? 255 : Math.round(180 + ((diff - 10) / 18) * 75);
        } else if (inWrist || inRacket) {
          alpha = 200;
        }
      } else if (diff >= 52) {
        alpha = 255;
      } else if (diff >= 16) {
        alpha = Math.round(((diff - 16) / 36) * 220);
      }

      if (alpha > 0) {
        out.data[i] = current.data[i];
        out.data[i + 1] = current.data[i + 1];
        out.data[i + 2] = current.data[i + 2];
        out.data[i + 3] = alpha;
        fgCount++;
        if (diff < 18) fgLeak++;
        if (inPose && alpha >= 128) posePreserved++;
        if (inRacket && alpha >= 128) racketPreserved++;
      } else if (inPose && (inWrist || inRacket)) {
        bgLeak++;
      }
    }
  }

  // Court artifact cleanup: remove low-diff fg ONLY outside pose buffer
  for (let y = region.y0; y < region.y1; y++) {
    for (let x = region.x0; x < region.x1; x++) {
      const i = (y * vw + x) * 4;
      if (out.data[i + 3] < 40) continue;
      const diff =
        Math.abs(current.data[i] - base.data[i]) +
        Math.abs(current.data[i + 1] - base.data[i + 1]) +
        Math.abs(current.data[i + 2] - base.data[i + 2]);
      const poseDist = distToPoseOrZone(x, y, keypoints, tennisZones);
      if (poseDist > 8 && diff < 14) {
        out.data[i + 3] = 0;
        fgCount--;
        fgLeak--;
      }
    }
  }

  applyOverlapEdgeEnhancement(out, region, vw);

  const metrics: MaskQualityMetrics = {
    coveragePercent: regionCount > 0 ? (fgCount / regionCount) * 100 : 0,
    foregroundLeakagePercent: fgCount > 0 ? (fgLeak / fgCount) * 100 : 0,
    backgroundLeakagePercent: poseZoneCount > 0 ? (bgLeak / Math.max(1, poseZoneCount)) * 100 : 0,
    posePreservationPercent: poseZoneCount > 0 ? (posePreserved / poseZoneCount) * 100 : 100,
    racketPreservationPercent: racketZoneCount > 0 ? (racketPreserved / racketZoneCount) * 100 : 100,
  };

  return { layer: out, metrics };
}

/** Subtle 1px opacity-weighted edge + local contrast for overlap readability. */
export function applyOverlapEdgeEnhancement(
  data: ImageData,
  region: PixelRect,
  vw: number,
): void {
  const { width, height, data: px } = data;
  const enhanced = new Uint8ClampedArray(px);

  for (let y = Math.max(1, region.y0); y < Math.min(height - 1, region.y1); y++) {
    for (let x = Math.max(1, region.x0); x < Math.min(width - 1, region.x1); x++) {
      const i = (y * width + x) * 4;
      const a = px[i + 3];
      if (a >= 90) {
        const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        const boost = lum < 128 ? 1.06 : 1.03;
        enhanced[i] = Math.min(255, px[i] * boost);
        enhanced[i + 1] = Math.min(255, px[i + 1] * boost);
        enhanced[i + 2] = Math.min(255, px[i + 2] * boost);
        enhanced[i + 3] = a;
        continue;
      }
      if (a >= 40) continue;

      const neighbors = [
        px[((y - 1) * width + x) * 4 + 3],
        px[((y + 1) * width + x) * 4 + 3],
        px[(y * width + (x - 1)) * 4 + 3],
        px[(y * width + (x + 1)) * 4 + 3],
      ];
      const maxN = Math.max(...neighbors);
      if (maxN >= 100) {
        const edgeAlpha = Math.round(Math.min(90, maxN * 0.28 + 18));
        enhanced[i] = 255;
        enhanced[i + 1] = 255;
        enhanced[i + 2] = 255;
        enhanced[i + 3] = edgeAlpha;
      }
    }
  }

  px.set(enhanced);
}

export function analyzeLayerRacketVisibility(
  layer: ImageData,
  pose: StroMotionPoseKeypoint[] | null,
  index: number,
  time: number,
  coveragePercent: number,
  neighborCoverage: number,
  vw: number,
  vh: number,
): GhostRacketValidation {
  const zones = pose ? estimateTennisRacketZones(pose, vw, vh).zones : [];
  const warnings: string[] = [];

  let wristSamples = 0;
  let wristHit = 0;
  let racketSamples = 0;
  let racketHit = 0;

  if (pose) {
    for (const idx of [POSE_IDX.LEFT_WRIST, POSE_IDX.RIGHT_WRIST]) {
      const kp = pose[idx];
      if (!kp || kp.score < MIN_POSE) continue;
      for (let dy = -18; dy <= 18; dy += 6) {
        for (let dx = -18; dx <= 18; dx += 6) {
          const x = Math.round(kp.x + dx);
          const y = Math.round(kp.y + dy);
          if (x < 0 || y < 0 || x >= vw || y >= vh) continue;
          wristSamples++;
          if (layer.data[(y * vw + x) * 4 + 3] >= 80) wristHit++;
        }
      }
    }
  }

  for (const z of zones) {
    const sx = Math.max(z.x0, Math.floor((z.x0 + z.x1) / 2) - 12);
    const sy = Math.max(z.y0, Math.floor((z.y0 + z.y1) / 2) - 12);
    for (let dy = 0; dy <= 24; dy += 8) {
      for (let dx = 0; dx <= 24; dx += 8) {
        const x = sx + dx;
        const y = sy + dy;
        if (x >= vw || y >= vh) continue;
        racketSamples++;
        if (layer.data[(y * vw + x) * 4 + 3] >= 70) racketHit++;
      }
    }
  }

  const wristRegionPresent = wristSamples === 0 ? false : wristHit / wristSamples >= 0.35;
  const racketRegionPresent = racketSamples === 0 ? false : racketHit / racketSamples >= 0.3;
  const coverageDrop = neighborCoverage > 0
    ? ((neighborCoverage - coveragePercent) / neighborCoverage) * 100
    : 0;

  if (!wristRegionPresent) warnings.push('Wrist region missing or weak in ghost mask');
  if (!racketRegionPresent && zones.length > 0) warnings.push('Estimated racket region missing in ghost mask');
  if (coverageDrop > 35) {
    warnings.push(`Coverage dropped ${coverageDrop.toFixed(0)}% vs adjacent ghost — possible missing racket/body`);
  }

  return {
    index,
    time,
    wristRegionPresent,
    racketRegionPresent,
    coveragePercent,
    coverageDropVsNeighbor: coverageDrop,
    warnings,
  };
}

function rectBoundaryMargin(inner: PixelRect, outer: PixelRect): number {
  return Math.min(
    inner.x0 - outer.x0,
    inner.y0 - outer.y0,
    outer.x1 - inner.x1,
    outer.y1 - inner.y1,
  );
}

function classifyServePhase(
  pose: StroMotionPoseKeypoint[] | null,
  index: number,
  total: number,
): ServeStressFrame['phase'] {
  if (!pose) return 'groundstroke';
  const { shoulder, wrist } = (() => {
    const lw = pose[POSE_IDX.LEFT_WRIST];
    const rw = pose[POSE_IDX.RIGHT_WRIST];
    const useRight = (rw?.score ?? 0) >= (lw?.score ?? 0);
    return useRight
      ? { shoulder: pose[POSE_IDX.RIGHT_SHOULDER], wrist: pose[POSE_IDX.RIGHT_WRIST] }
      : { shoulder: pose[POSE_IDX.LEFT_SHOULDER], wrist: pose[POSE_IDX.LEFT_WRIST] };
  })();
  if (!shoulder || !wrist || shoulder.score < MIN_POSE || wrist.score < MIN_POSE) {
    return 'groundstroke';
  }
  const overhead = wrist.y < shoulder.y - 20;
  if (!overhead) return 'groundstroke';

  const t = index / Math.max(1, total - 1);
  if (t < 0.2) return 'trophy';
  if (t < 0.4) return 'drop';
  if (t < 0.65) return 'acceleration';
  if (t < 0.85) return 'pronation';
  return 'finish';
}

export function validateServeStress(
  poses: (StroMotionPoseKeypoint[] | null)[],
  sampleTimes: number[],
  effectiveRect: PixelRect,
  vw: number,
  vh: number,
  boundaryThresholdPx = 18,
): { frames: ServeStressFrame[]; warnings: string[]; hasOverhead: boolean } {
  const frames: ServeStressFrame[] = [];
  const warnings: string[] = [];
  let hasOverhead = false;

  for (let i = 0; i < poses.length; i++) {
    const pose = poses[i];
    const phase = classifyServePhase(pose, i, poses.length);
    if (phase !== 'groundstroke') hasOverhead = true;

    const body = pose ? estimateBodyRect(pose) : null;
    const racket = pose ? racketZoneUnionRect(pose, vw, vh) : null;

    let racketMargin = Infinity;
    let poseMargin = Infinity;
    if (racket) racketMargin = rectBoundaryMargin(racket, effectiveRect);
    if (body) poseMargin = rectBoundaryMargin(body, effectiveRect);

    const nearBoundary =
      racketMargin < boundaryThresholdPx || poseMargin < boundaryThresholdPx;

    frames.push({
      time: sampleTimes[i] ?? 0,
      phase,
      racketBoundaryMarginPx: Number.isFinite(racketMargin) ? Math.round(racketMargin) : -1,
      poseBoundaryMarginPx: Number.isFinite(poseMargin) ? Math.round(poseMargin) : -1,
      nearBoundary,
    });

    if (nearBoundary && phase !== 'groundstroke') {
      warnings.push(
        `@ ${(sampleTimes[i] ?? 0).toFixed(3)}s (${phase}): ` +
        `racket margin ${Math.round(racketMargin)}px, pose margin ${Math.round(poseMargin)}px — approaches extraction boundary`,
      );
    }
  }

  return { frames, warnings, hasOverhead };
}

function estimateBodyRect(pose: StroMotionPoseKeypoint[]): PixelRect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let found = false;
  for (let i = 5; i <= 16; i++) {
    const kp = pose[i];
    if (!kp || kp.score < MIN_POSE) continue;
    found = true;
    x0 = Math.min(x0, kp.x - 30);
    y0 = Math.min(y0, kp.y - 30);
    x1 = Math.max(x1, kp.x + 30);
    y1 = Math.max(y1, kp.y + 30);
  }
  return found ? { x0, y0, x1, y1 } : null;
}

/** FNV-1a hash of canvas pixels (deterministic export parity check). */
export async function hashCanvasContent(canvas: HTMLCanvasElement): Promise<string> {
  const ctx = canvas.getContext('2d');
  if (!ctx) return 'no-ctx';
  const { width, height } = canvas;
  if (width === 0 || height === 0) return 'empty';

  const data = ctx.getImageData(0, 0, width, height).data;
  let hash = 2166136261;
  const step = Math.max(4, Math.floor(data.length / 400_000) * 4);
  for (let i = 0; i < data.length; i += step) {
    hash ^= data[i];
    hash = Math.imul(hash, 16777619);
    hash ^= data[i + 1];
    hash = Math.imul(hash, 16777619);
    hash ^= data[i + 2];
    hash = Math.imul(hash, 16777619);
    hash ^= data[i + 3];
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildExportParityReport(
  previewHash: string | null,
  pngHash: string | null,
  videoFrameHash: string | null,
): ExportParityReport {
  const mismatches: string[] = [];
  let previewMatchesPng: boolean | null = null;
  let previewMatchesVideo: boolean | null = null;

  if (previewHash && pngHash) {
    previewMatchesPng = previewHash === pngHash;
    if (!previewMatchesPng) mismatches.push(`Preview ${previewHash} ≠ PNG ${pngHash}`);
  }
  if (previewHash && videoFrameHash) {
    previewMatchesVideo = previewHash === videoFrameHash;
    if (!previewMatchesVideo) mismatches.push(`Preview ${previewHash} ≠ Video frame ${videoFrameHash}`);
  }

  return {
    previewHash,
    pngHash,
    videoFrameHash,
    previewMatchesPng,
    previewMatchesVideo,
    mismatches,
  };
}

export function buildVisualQualityScorecard(input: {
  maskMetrics: MaskQualityMetrics[];
  ghostRacket: GhostRacketValidation[];
  serveWarnings: string[];
  hasOverhead: boolean;
  exportParity: ExportParityReport | null;
  avgForegroundLeakage: number;
  avgBackgroundLeakage: number;
}): VisualQualityScorecard {
  const details: string[] = [];

  const avgPosePres =
    input.maskMetrics.reduce((s, m) => s + m.posePreservationPercent, 0) /
    Math.max(1, input.maskMetrics.length);
  const avgRacketPres =
    input.maskMetrics.reduce((s, m) => s + m.racketPreservationPercent, 0) /
    Math.max(1, input.maskMetrics.length);

  const maskQuality: 'PASS' | 'REVIEW' =
    input.avgForegroundLeakage <= 12 &&
    input.avgBackgroundLeakage <= 15 &&
    avgPosePres >= 75
      ? 'PASS'
      : 'REVIEW';
  if (maskQuality === 'REVIEW') {
    details.push(
      `Mask: fg leakage ${input.avgForegroundLeakage.toFixed(1)}%, bg leakage ${input.avgBackgroundLeakage.toFixed(1)}%, pose preserve ${avgPosePres.toFixed(0)}%`,
    );
  }

  const ghostSeparation: 'PASS' | 'REVIEW' =
    input.avgForegroundLeakage <= 15 ? 'PASS' : 'REVIEW';

  const racketFails = input.ghostRacket.filter(
    (g) => !g.wristRegionPresent || !g.racketRegionPresent || g.warnings.length > 0,
  );
  const racketPreservation: 'PASS' | 'REVIEW' =
    racketFails.length === 0 && avgRacketPres >= 60 ? 'PASS' : 'REVIEW';
  if (racketPreservation === 'REVIEW') {
    details.push(`${racketFails.length} ghost(s) with racket/wrist warnings, avg racket preserve ${avgRacketPres.toFixed(0)}%`);
  }

  const serveValidation: 'PASS' | 'REVIEW' | 'N/A' = !input.hasOverhead
    ? 'N/A'
    : input.serveWarnings.length === 0
      ? 'PASS'
      : 'REVIEW';
  if (serveValidation === 'REVIEW') {
    details.push(...input.serveWarnings.slice(0, 3));
  }

  let exportParity: 'PASS' | 'REVIEW' | 'N/A' = 'N/A';
  if (input.exportParity) {
    const ep = input.exportParity;
    if (ep.previewHash) {
      exportParity =
        ep.mismatches.length === 0 ? 'PASS' : 'REVIEW';
      if (exportParity === 'REVIEW') details.push(...ep.mismatches);
    }
  }

  const checks = [maskQuality, ghostSeparation, racketPreservation];
  if (serveValidation !== 'N/A') checks.push(serveValidation);
  if (exportParity !== 'N/A') checks.push(exportParity);

  const overall: 'PASS' | 'REVIEW' = checks.every((c) => c === 'PASS') ? 'PASS' : 'REVIEW';

  return {
    maskQuality,
    ghostSeparation,
    racketPreservation,
    serveValidation,
    exportParity,
    overall,
    details,
  };
}

export function logVisualQualityScorecard(
  scorecard: VisualQualityScorecard,
  maskMetrics: MaskQualityMetrics[],
  ghostRacket: GhostRacketValidation[],
  timings: PerformanceTimings,
  serveFrames: ServeStressFrame[],
  exportParity: ExportParityReport | null,
): void {
  console.group('[StroMotion] Visual Quality Scorecard');
  console.log(`Mask quality ........ ${scorecard.maskQuality}`);
  console.log(`Ghost separation .... ${scorecard.ghostSeparation}`);
  console.log(`Racket preservation . ${scorecard.racketPreservation}`);
  console.log(`Serve validation .... ${scorecard.serveValidation}`);
  console.log(`Export parity ....... ${scorecard.exportParity}`);
  console.log(`Overall: ${scorecard.overall}`);

  console.log('\nMask metrics per ghost:');
  console.table(
    maskMetrics.map((m, i) => ({
      ghost: i + 1,
      coverage: `${m.coveragePercent.toFixed(1)}%`,
      fgLeak: `${m.foregroundLeakagePercent.toFixed(1)}%`,
      bgLeak: `${m.backgroundLeakagePercent.toFixed(1)}%`,
      posePres: `${m.posePreservationPercent.toFixed(0)}%`,
      racketPres: `${m.racketPreservationPercent.toFixed(0)}%`,
    })),
  );

  if (ghostRacket.some((g) => g.warnings.length > 0)) {
    console.warn('Racket visibility warnings:', ghostRacket.filter((g) => g.warnings.length).map((g) => ({
      ghost: g.index + 1,
      time: g.time.toFixed(3),
      warnings: g.warnings,
    })));
  }

  if (serveFrames.some((f) => f.phase !== 'groundstroke')) {
    console.log('Serve stress frames:');
    console.table(
      serveFrames
        .filter((f) => f.phase !== 'groundstroke')
        .map((f) => ({
          time: f.time.toFixed(3),
          phase: f.phase,
          racketMargin: f.racketBoundaryMarginPx,
          poseMargin: f.poseBoundaryMarginPx,
          nearBoundary: f.nearBoundary ? 'YES' : 'no',
        })),
    );
  }

  console.log('Performance (ms):', timings);

  if (exportParity) {
    console.log('Export parity:', exportParity);
  }

  if (scorecard.details.length > 0) {
    console.log('Review notes:', scorecard.details);
  }

  console.groupEnd();
}

/** Store on result for export-time parity updates. */
export function createEmptyExportParity(): ExportParityReport {
  return {
    previewHash: null,
    pngHash: null,
    videoFrameHash: null,
    previewMatchesPng: null,
    previewMatchesVideo: null,
    mismatches: [],
  };
}

export function updateExportParity(
  current: ExportParityReport,
  patch: Partial<ExportParityReport>,
): ExportParityReport {
  const next = { ...current, ...patch };
  return buildExportParityReport(next.previewHash, next.pngHash, next.videoFrameHash);
}
