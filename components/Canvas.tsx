'use client';

import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import type { ToolType, DrawingOptions } from '@/lib/drawingTools';
import { calcAngleDeg } from '@/lib/drawingTools';
import type { CachedPoseFrame } from '@/lib/poseDetection';
import type { BallPosition } from '@/lib/ballDetection';
import type { BallTrailMode, WebcamPipMode } from '@/components/ToolPalette';
import type { SwingSegment } from '@/lib/swingDetection';
import { detectSwingSegments } from '@/lib/swingDetection';
import type { RacketTrail } from '@/lib/racketMultiplier';

// ── Constants ──────────────────────────────────────────────────────────────

/** Throttle interval for real-time skeleton pose detection (~30fps) */
const POSE_DETECTION_INTERVAL = 1 / 30;
/** Throttle interval for real-time ball detection (~20fps) */
const BALL_DETECTION_INTERVAL = 1 / 20;
/** Maximum skeleton frames to keep in memory (~10s at 30fps) */
const MAX_SKELETON_FRAMES = 300;
/** Window (seconds) for matching a skeleton frame to current video time */
const SKELETON_TIME_TOLERANCE = 0.15;
/** Time window (seconds) used to skip duplicate ball detections at the same video position */
const BALL_DETECT_TIME_TOLERANCE = 0.08;
/** How many seconds of ball positions to keep in the real-time trail */
const BALL_TRAIL_WINDOW_SECONDS = 1.5;
/** Threshold (pixels) for detecting a pointer-down near an existing circle */
const CIRCLE_DRAG_THRESHOLD = 20;
/** Radius (pixels) of each racket trail dot */
const RACKET_TRAIL_CIRCLE_RADIUS = 8;
/** Maximum alpha for the most-recent racket trail position */
const RACKET_TRAIL_MAX_ALPHA = 0.65;
/** Radians per animFrame for spinning shapes */
const SHAPE_SPIN_SPEED = 0.025;
/** Minimum alpha applied to any StroMotion ghost frame */
const MIN_GHOST_OPACITY = 0.02;

// ── Types ──────────────────────────────────────────────────────────────────

type Pt = { x: number; y: number };

interface StrokePen     { tool: 'pen';                              pts: Pt[]; color: string; lw: number; dashed?: boolean }
interface StrokeLine    { tool: 'line';                             p1: Pt; p2: Pt; color: string; lw: number; dashed?: boolean }
interface StrokeArrow   { tool: 'arrow' | 'arrowAngle';             p1: Pt; p2: Pt; color: string; lw: number; dashed?: boolean }
interface StrokeEllipse {
  tool: 'circle' | 'bodyCircle';
  cx: number; cy: number; rx: number; ry: number;
  color: string; lw: number; dashed?: boolean;
  spinning?: boolean;
  spinSpeed?: number;  // degrees per second; defaults to ~100 deg/sec if spinning
  gapStart?: number;  // angle in radians
  gapEnd?: number;    // angle in radians
}
interface StrokeRect {
  tool: 'rect';
  cx: number; cy: number; rx: number; ry: number;
  color: string; lw: number; dashed?: boolean;
  spinning?: boolean;
  is3d?: boolean;
}
interface StrokeTriangle {
  tool: 'triangle';
  cx: number; cy: number; rx: number; ry: number;
  color: string; lw: number; dashed?: boolean;
  spinning?: boolean;
  is3d?: boolean;
}
interface StrokeSwing   { tool: 'swingPath' | 'manualSwing';        pts: Pt[]; color: string; lw: number; dashed?: boolean }
interface StrokeText    { tool: 'text';                             pos: Pt; text: string; color: string; fontSize: number }

type Stroke = StrokePen | StrokeLine | StrokeArrow | StrokeEllipse | StrokeRect | StrokeTriangle | StrokeSwing | StrokeText;

interface AngleMeas { v: Pt; p1: Pt; p2: Pt; deg: number }
interface LiveAngle { phase: 1 | 2; v: Pt; p1: Pt; cursor: Pt }

type Selection =
  | { kind: 'stroke'; idx: number; start: Pt; orig: Stroke }
  | { kind: 'angle'; idx: number; start: Pt; orig: AngleMeas }
  | null;

// ── Public handle ──────────────────────────────────────────────────────────

export interface CanvasHandle {
  clearAll: () => void;
  resetSkeleton: () => void;
  resetBallTrail: () => void;
  getCanvas: () => HTMLCanvasElement | null;
  /** Backward-compat alias for ExportModal */
  getCompositeCanvas: () => HTMLCanvasElement | null;
  captureStream: (fps?: number) => MediaStream | null;
  undo: () => void;
  redo: () => void;
  getDetectedSwings: () => SwingSegment[];
  drawSwingFromSegment: (segment: SwingSegment, color: string) => void;
  setRacketTrail: (trail: RacketTrail | null) => void;
  getSkeletonFrames: () => Array<{ timeSeconds: number; keypoints: Array<{ x: number; y: number; score: number; name: string }> }>;
  /** Begin rubber-band region selection for StroMotion; callback receives region in video-normalized 0..1 coords */
  startStroMotionRegionSelect: (cb: (region: { x: number; y: number; w: number; h: number }) => void) => void;
  resetCropZoom: () => void;
  /** Crop region (canvas-normalized 0..1) for export/recording */
  getCropRegion: () => { x: number; y: number; w: number; h: number } | null;
  clearCropRegion: () => void;
}

// ── Props ──────────────────────────────────────────────────────────────────

export interface CanvasProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  webcamVideoRef?: React.RefObject<HTMLVideoElement | null>;
  activeTool: ToolType;
  drawingOptions: DrawingOptions;
  containerWidth: number;
  containerHeight: number;
  ballTrailMode?: BallTrailMode;
  skeletonEnabled?: boolean;
  ballTrailEnabled?: boolean;
  onProcessingStatus?: (msg: string | null) => void;
  isRecording?: boolean;
  circleSpinning?: boolean;
  circleGapMode?: boolean;
  webcamPipMode?: WebcamPipMode;
  webcamOpacity?: number;
  stroMotionGhosts?: ImageBitmap[];
  stroMotionOpacity?: number;
  /** Region (video-normalized 0..1) to display stro-motion ghosts in */
  stroMotionRegion?: { x: number; y: number; w: number; h: number };
  skeletonShowAngles?: boolean;
  skeletonShowHeadLine?: boolean;
  skeletonClassicColors?: boolean;
  ballSampleMode?: boolean;
  rect3d?: boolean;
  triangle3d?: boolean;
  /** When videoRef has no playable video (e.g. YouTube embed), keep canvas transparent */
  transparentWhenNoVideo?: boolean;
}

// ── Module-level pose render cache ─────────────────────────────────────────

let poseRenderFns: {
  getPoseAtTime: (typeof import('@/lib/poseDetection'))['getPoseAtTime'];
  drawPoseSkeleton: (typeof import('@/lib/poseDetection'))['drawPoseSkeleton'];
  drawSkeletonFrame: (typeof import('@/lib/poseDetection'))['drawSkeletonFrame'];
} | null = null;

function ensurePoseRender(): void {
  if (poseRenderFns) return;
  import('@/lib/poseDetection').then((mod) => {
    poseRenderFns = {
      getPoseAtTime: mod.getPoseAtTime,
      drawPoseSkeleton: mod.drawPoseSkeleton,
      drawSkeletonFrame: mod.drawSkeletonFrame,
    };
  }).catch((err) => console.error('[Canvas] poseRender load error:', err));
}

// ── Standalone skeleton renderer ───────────────────────────────────────────

function drawSkeletonOverlay(
  ctx: CanvasRenderingContext2D,
  keypoints: Array<{ x: number; y: number; score: number; name: string }>,
  nativeW: number,
  nativeH: number,
  canvasW: number,
  canvasH: number,
  opts?: {
    showAngles?: boolean;
    showHeadLine?: boolean;
    classicColors?: boolean;
    showFootLine?: boolean;
  },
): void {
  const sx = canvasW / nativeW;
  const sy = canvasH / nativeH;

  const showAngles   = opts?.showAngles   !== false;
  const showHeadLine = opts?.showHeadLine !== false;
  const classicColors = opts?.classicColors === true;
  const showFootLine = opts?.showFootLine !== false;
  const jointRadius = Math.max(2, Math.min(7, Math.round(Math.min(canvasW, canvasH) / 180)));

  const BONES: [number, number][] = [
    [0, 1], [0, 2], [1, 3], [2, 4],
    [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],
    [5, 11], [6, 12], [11, 12],
    [11, 13], [13, 15], [12, 14], [14, 16],
  ];

  ctx.save();
  ctx.strokeStyle = classicColors ? '#39FF14' : '#35679A';
  ctx.lineWidth = classicColors ? 4 : 3;
  ctx.lineCap = 'round';
  for (const [a, b] of BONES) {
    const ka = keypoints[a];
    const kb = keypoints[b];
    if (!ka || !kb || ka.score < 0.3 || kb.score < 0.3) continue;
    ctx.beginPath();
    ctx.moveTo(ka.x * sx, ka.y * sy);
    ctx.lineTo(kb.x * sx, kb.y * sy);
    ctx.stroke();
  }

  // Headline: horizontal line at head height (helps keep face visible in recordings)
  if (showHeadLine) {
    const headIdxs = [0, 1, 2, 3, 4];
    const ys = headIdxs
      .map((i) => keypoints[i])
      .filter((kp) => kp && kp.score >= 0.3)
      .map((kp) => kp.y * sy);
    if (ys.length > 0) {
      const headY = Math.min(...ys);
      ctx.save();
      ctx.strokeStyle = classicColors ? '#39FF14' : '#35679A';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(0, headY);
      ctx.lineTo(canvasW, headY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  // Foot direction lines
  if (showFootLine) {
    for (const [kneeIdx, ankleIdx] of [[13, 15], [14, 16]] as [number, number][]) {
      const knee  = keypoints[kneeIdx];
      const ankle = keypoints[ankleIdx];
      if (!knee || !ankle || knee.score < 0.3 || ankle.score < 0.3) continue;
      const kx = knee.x  * sx, ky = knee.y  * sy;
      const ax = ankle.x * sx, ay = ankle.y * sy;
      const dist = Math.hypot(ax - kx, ay - ky);
      if (dist < 1) continue;
      const dx2 = (ax - kx) / dist;
      const dy2 = (ay - ky) / dist;
      const ext = dist * 0.4;
      ctx.save();
      ctx.strokeStyle = classicColors ? '#39FF14' : '#35679A';
      ctx.lineWidth = classicColors ? 4 : 3;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + dx2 * ext, ay + dy2 * ext);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  // Draw joint dots — skip head keypoints (indices 0-4)
  for (let i = 5; i < keypoints.length; i++) {
    const kp = keypoints[i];
    if (!kp || kp.score < 0.3) continue;
    ctx.beginPath();
    ctx.arc(kp.x * sx, kp.y * sy, jointRadius, 0, Math.PI * 2);
    if (classicColors) {
      // even indices = right side (red), odd = left side (blue)
      ctx.fillStyle = i % 2 === 0 ? '#FF4444' : '#4488FF';
    } else {
      ctx.fillStyle = '#F8F8F8';
    }
    ctx.fill();
    ctx.strokeStyle = classicColors ? (i % 2 === 0 ? '#FF4444' : '#4488FF') : '#35679A';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  if (showAngles) {
    const ANGLES: [number, number, number][] = [
      [7, 5, 9], [8, 6, 10], [13, 11, 15], [14, 12, 16],
    ];

    ctx.font = 'bold 13px -apple-system, sans-serif';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 3;

    for (const [vi, ai, bi] of ANGLES) {
      const v = keypoints[vi];
      const a = keypoints[ai];
      const b = keypoints[bi];
      if (!v || !a || !b || v.score < 0.3 || a.score < 0.3 || b.score < 0.3) continue;

      const vx = v.x * sx, vy = v.y * sy;
      const ax = a.x * sx, ay = a.y * sy;
      const bx = b.x * sx, by = b.y * sy;

      const v1 = { x: ax - vx, y: ay - vy };
      const v2 = { x: bx - vx, y: by - vy };
      const dot = v1.x * v2.x + v1.y * v2.y;
      const mag = Math.sqrt(v1.x ** 2 + v1.y ** 2) * Math.sqrt(v2.x ** 2 + v2.y ** 2);
      if (mag < 1) continue;

      const deg = Math.round(Math.acos(Math.min(1, Math.max(-1, dot / mag))) * 180 / Math.PI);
      const label = `${deg}°`;
      const m = ctx.measureText(label);
      const lx = vx + 8, ly = vy - 8;

      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(lx - 2, ly - 13, m.width + 4, 16);
      ctx.fillStyle = '#FFD700';
      ctx.fillText(label, lx, ly);
    }

    ctx.shadowBlur = 0;
  }

  ctx.restore();
}

// ── Standalone ball detector ────────────────────────────────────────────────

function findBallInImageData(
  imageData: ImageData,
  width: number,
  height: number,
  targetHue?: { hMin: number; hMax: number } | null,
): { x: number; y: number } | null {
  const data = imageData.data;
  const mask = new Uint8Array(width * height);
  let count = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) continue;
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;

    if (h * 360 >= (targetHue?.hMin ?? 50) && h * 360 <= (targetHue?.hMax ?? 82) && s >= 0.40 && l >= 0.35 && l <= 0.75) {
      mask[i >> 2] = 1;
      count++;
    }
  }

  // Too few pixels → no ball; too many → probably a large green surface (grass court, banner)
  if (count < 8 || count > 5000) return null;

  let sumX = 0, sumY = 0, n = 0;
  for (let idx = 0; idx < mask.length; idx++) {
    if (!mask[idx]) continue;
    sumX += idx % width;
    sumY += Math.floor(idx / width);
    n++;
  }

  if (n < 8) return null;
  return { x: Math.round(sumX / n), y: Math.round(sumY / n) };
}

// ── Drawing helpers ────────────────────────────────────────────────────────

function drawArrowHead(ctx: CanvasRenderingContext2D, p1: Pt, p2: Pt, size = 14): void {
  const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  ctx.beginPath();
  ctx.moveTo(p2.x, p2.y);
  ctx.lineTo(p2.x - size * Math.cos(angle - Math.PI / 7), p2.y - size * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(p2.x - size * Math.cos(angle + Math.PI / 7), p2.y - size * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
}

function labelPill(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  ctx.save();
  ctx.font = 'bold 12px Inter, sans-serif';
  const m = ctx.measureText(text);
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(x - 3, y - 13, m.width + 6, 16);
  ctx.fillStyle = '#FFD700';
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawSmoothPath(
  ctx: CanvasRenderingContext2D,
  points: Pt[],
  color: string,
  width: number,
  opacity: number,
  dashed: boolean,
): void {
  if (points.length < 2) return;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (dashed) ctx.setLineDash([8, 6]);

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length - 1; i++) {
    const xMid = (points[i].x + points[i + 1].x) / 2;
    const yMid = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, xMid, yMid);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();

  // Draw arrowhead at end
  if (points.length >= 2) {
    const p1 = points[points.length - 2];
    const p2 = points[points.length - 1];
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const headLen = Math.max(12, width * 3);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(p2.x, p2.y);
    ctx.lineTo(p2.x - headLen * Math.cos(angle - Math.PI / 7), p2.y - headLen * Math.sin(angle - Math.PI / 7));
    ctx.moveTo(p2.x, p2.y);
    ctx.lineTo(p2.x - headLen * Math.cos(angle + Math.PI / 7), p2.y - headLen * Math.sin(angle + Math.PI / 7));
    ctx.stroke();
  }

  ctx.restore();
}

function drawCircleStroke(
  ctx: CanvasRenderingContext2D,
  s: StrokeEllipse,
  _animFrame: number,
): void {
  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.lw;
  if (s.dashed) ctx.setLineDash([8, 6]);

  if (s.spinning || s.gapStart !== undefined) {
    // Use time-based rotation for smooth, drift-free animation
    ctx.translate(s.cx, s.cy);
    if (s.spinning) {
      const spinAngle = ((Date.now() / 3000) * Math.PI * 2) % (Math.PI * 2);
      ctx.rotate(spinAngle);
    }
    const startAngle = s.gapStart ?? 0;
    const endAngle   = s.gapEnd   ?? Math.PI * 2;
    const rx = Math.max(1, s.rx);
    const ry = Math.max(1, s.ry);
    ctx.beginPath();
    if (Math.abs(rx - ry) < 1) {
      ctx.arc(0, 0, rx, startAngle, endAngle);
    } else {
      ctx.ellipse(0, 0, rx, ry, 0, startAngle, endAngle);
    }
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.ellipse(s.cx, s.cy, Math.max(1, s.rx), Math.max(1, s.ry), 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

function drawRectStroke(
  ctx: CanvasRenderingContext2D,
  s: StrokeRect,
  _animFrame: number,
): void {
  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.lw;
  if (s.dashed) ctx.setLineDash([8, 6]);

  const drawRectAt = (cx: number, cy: number) => {
    ctx.strokeRect(cx - s.rx, cy - s.ry, s.rx * 2, s.ry * 2);
  };

  if (s.spinning) {
    const spinAngle = ((Date.now() / 3000) * Math.PI * 2) % (Math.PI * 2);
    ctx.translate(s.cx, s.cy);
    ctx.rotate(spinAngle);
    ctx.strokeRect(-s.rx, -s.ry, s.rx * 2, s.ry * 2);
  } else {
    drawRectAt(s.cx, s.cy);
  }

  if (s.is3d && !s.spinning) {
    const off = Math.max(8, s.lw * 2);
    ctx.globalAlpha = 0.65;
    drawRectAt(s.cx + off, s.cy - off);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(s.cx - s.rx, s.cy - s.ry);
    ctx.lineTo(s.cx - s.rx + off, s.cy - s.ry - off);
    ctx.moveTo(s.cx + s.rx, s.cy - s.ry);
    ctx.lineTo(s.cx + s.rx + off, s.cy - s.ry - off);
    ctx.moveTo(s.cx - s.rx, s.cy + s.ry);
    ctx.lineTo(s.cx - s.rx + off, s.cy + s.ry - off);
    ctx.moveTo(s.cx + s.rx, s.cy + s.ry);
    ctx.lineTo(s.cx + s.rx + off, s.cy + s.ry - off);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTriangleStroke(
  ctx: CanvasRenderingContext2D,
  s: StrokeTriangle,
  _animFrame: number,
): void {
  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.lw;
  if (s.dashed) ctx.setLineDash([8, 6]);

  const spinAngle = s.spinning
    ? ((Date.now() / 3000) * Math.PI * 2) % (Math.PI * 2)
    : 0;
  ctx.translate(s.cx, s.cy);
  ctx.rotate(spinAngle);
  const drawTri = (ox: number, oy: number) => {
    ctx.beginPath();
    ctx.moveTo(ox, oy - s.ry);
    ctx.lineTo(ox + s.rx, oy + s.ry);
    ctx.lineTo(ox - s.rx, oy + s.ry);
    ctx.closePath();
    ctx.stroke();
  };

  drawTri(0, 0);

  if (s.is3d && !s.spinning) {
    const off = Math.max(8, s.lw * 2);
    ctx.globalAlpha = 0.65;
    drawTri(off, -off);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(0, -s.ry);
    ctx.lineTo(off, -off - s.ry);
    ctx.moveTo(s.rx, s.ry);
    ctx.lineTo(off + s.rx, -off + s.ry);
    ctx.moveTo(-s.rx, s.ry);
    ctx.lineTo(off - s.rx, -off + s.ry);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, animFrame = 0): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (s.tool === 'pen') {
    const { pts, color, lw, dashed } = s;
    if (pts.length === 0) { ctx.restore(); return; }
    if (dashed) ctx.setLineDash([8, 6]);
    if (pts.length === 1) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, lw / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }

  } else if (s.tool === 'line') {
    const { p1, p2, color, lw, dashed } = s;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    if (dashed) ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();

  } else if (s.tool === 'swingPath' || s.tool === 'manualSwing') {
    drawSmoothPath(ctx, s.pts, s.color, s.lw, 1, s.dashed ?? false);
    ctx.restore();
    return;

  } else if (s.tool === 'arrow' || s.tool === 'arrowAngle') {
    const { p1, p2, color, lw, dashed } = s;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    if (dashed) ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    drawArrowHead(ctx, p1, p2);
    if (s.tool === 'arrowAngle') {
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const deg = Math.round(Math.abs(Math.atan2(dy, dx) * 180 / Math.PI));
      labelPill(ctx, `${deg}°`, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2 - 12);
    }

  } else if (s.tool === 'circle' || s.tool === 'bodyCircle') {
    ctx.restore();
    drawCircleStroke(ctx, s as StrokeEllipse, animFrame);
    return;

  } else if (s.tool === 'rect') {
    ctx.restore();
    drawRectStroke(ctx, s as StrokeRect, animFrame);
    return;

  } else if (s.tool === 'triangle') {
    ctx.restore();
    drawTriangleStroke(ctx, s as StrokeTriangle, animFrame);
    return;

  } else if (s.tool === 'text') {
    const { pos, text, color, fontSize } = s;
    ctx.font = `bold ${fontSize}px Inter, sans-serif`;
    ctx.fillStyle = color;
    ctx.fillText(text, pos.x, pos.y);
  }

  ctx.restore();
}

function drawAngleMeas(ctx: CanvasRenderingContext2D, m: AngleMeas): void {
  const { v, p1, p2, deg } = m;
  const a1 = Math.atan2(p1.y - v.y, p1.x - v.x);
  const a2 = Math.atan2(p2.y - v.y, p2.x - v.x);
  ctx.save();
  ctx.fillStyle = 'rgba(255,215,0,0.12)';
  ctx.strokeStyle = '#FFD700';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(v.x, v.y);
  ctx.arc(v.x, v.y, 30, a1, a2, false);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(v.x, v.y); ctx.lineTo(p1.x, p1.y);
  ctx.moveTo(v.x, v.y); ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
  const midA = (a1 + a2) / 2;
  labelPill(ctx, `${deg}°`, v.x + 46 * Math.cos(midA), v.y + 46 * Math.sin(midA));
  ctx.restore();
}

function drawLiveAnglePrev(ctx: CanvasRenderingContext2D, live: LiveAngle): void {
  const { v, p1, cursor } = live;
  const a1 = Math.atan2(p1.y - v.y, p1.x - v.x);
  const a2 = Math.atan2(cursor.y - v.y, cursor.x - v.x);
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(255,215,0,0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(v.x, v.y); ctx.lineTo(p1.x, p1.y);
  ctx.moveTo(v.x, v.y); ctx.lineTo(cursor.x, cursor.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,165,0,0.18)';
  ctx.beginPath();
  ctx.moveTo(v.x, v.y);
  ctx.arc(v.x, v.y, 30, a1, a2, false);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,215,0,0.6)';
  ctx.stroke();
  const deg = calcAngleDeg(p1, v, cursor);
  const midA = (a1 + a2) / 2;
  labelPill(ctx, `${deg}°`, v.x + 46 * Math.cos(midA), v.y + 46 * Math.sin(midA));
  ctx.restore();
}

function drawBallTrailOnCanvas(
  ctx: CanvasRenderingContext2D,
  track: BallPosition[],
  currentFrameIdx: number,
  mode: BallTrailMode,
  dx: number, dy: number, dw: number, dh: number,
): void {
  if (track.length === 0) return;
  const SHORT_TAIL = 18;

  ctx.save();
  ctx.lineCap = 'round';

  if (mode === 'comet') {
    const visible = track.filter(p => Math.abs(p.frameIndex - currentFrameIdx) <= SHORT_TAIL);
    if (visible.length >= 2) {
      for (let i = 1; i < visible.length; i++) {
        const alpha = (i / visible.length) * 0.7;
        ctx.strokeStyle = `rgba(204,255,0,${alpha})`;
        ctx.lineWidth = Math.max(2, 6 * (i / visible.length));
        ctx.beginPath();
        ctx.moveTo(dx + visible[i-1].nx * dw, dy + visible[i-1].ny * dh);
        ctx.lineTo(dx + visible[i].nx * dw, dy + visible[i].ny * dh);
        ctx.stroke();
      }
    }
    const cur = track.find(p => Math.abs(p.frameIndex - currentFrameIdx) <= 1);
    if (cur) {
      ctx.shadowColor = '#CCFF00';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#CCFF00';
      ctx.beginPath();
      ctx.arc(dx + cur.nx * dw, dy + cur.ny * dh, 10, 0, Math.PI * 2);
      ctx.fill();
      // highlight dot
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(dx + cur.nx * dw - 3, dy + cur.ny * dh - 3, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (mode === 'arc') {
    // past positions: solid line
    const past = track.filter(p => p.frameIndex <= currentFrameIdx);
    const future = track.filter(p => p.frameIndex > currentFrameIdx);
    if (past.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(dx + past[0].nx * dw, dy + past[0].ny * dh);
      for (let i = 1; i < past.length; i++)
        ctx.lineTo(dx + past[i].nx * dw, dy + past[i].ny * dh);
      ctx.strokeStyle = 'rgba(204,255,0,0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.stroke();
    }
    if (future.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(dx + future[0].nx * dw, dy + future[0].ny * dh);
      for (let i = 1; i < future.length; i++)
        ctx.lineTo(dx + future[i].nx * dw, dy + future[i].ny * dh);
      ctx.strokeStyle = 'rgba(204,255,0,0.35)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const p of track) {
      ctx.fillStyle = 'rgba(204,255,0,0.6)';
      ctx.beginPath();
      ctx.arc(dx + p.nx * dw, dy + p.ny * dh, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    const cur = track.find(p => Math.abs(p.frameIndex - currentFrameIdx) <= 1);
    if (cur) {
      ctx.shadowColor = '#CCFF00'; ctx.shadowBlur = 16;
      ctx.fillStyle = '#CCFF00';
      ctx.beginPath();
      ctx.arc(dx + cur.nx * dw, dy + cur.ny * dh, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  } else if (mode === 'strobe') {
    // Ghost balls every Nth position
    const step = Math.max(1, Math.floor(track.length / 8));
    for (let i = 0; i < track.length; i += step) {
      const p = track[i];
      const alpha = 0.55;
      ctx.shadowColor = '#CCFF00'; ctx.shadowBlur = 8;
      ctx.fillStyle = `rgba(204,255,0,${alpha})`;
      ctx.beginPath();
      ctx.arc(dx + p.nx * dw, dy + p.ny * dh, 8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}

// Draw real-time ball positions (stored as absolute coords in video resolution)
function drawRealtimeBallTrail(
  ctx: CanvasRenderingContext2D,
  track: Array<{ timeSeconds: number; x: number; y: number }>,
  currentTime: number,
  mode: BallTrailMode,
  dx: number, dy: number, dw: number, dh: number,
  vW: number, vH: number,
): void {
  if (track.length === 0) return;

  const toCanvasX = (x: number) => dx + (x / vW) * dw;
  const toCanvasY = (y: number) => dy + (y / vH) * dh;

  ctx.save();
  ctx.lineCap = 'round';

  if (mode === 'comet') {
    const TAIL = 0.8;
    const visible = track.filter(p => currentTime - p.timeSeconds <= TAIL && p.timeSeconds <= currentTime + 0.05);
    if (visible.length >= 2) {
      for (let i = 1; i < visible.length; i++) {
        const t = i / visible.length;
        ctx.strokeStyle = `rgba(204,255,0,${t * 0.85})`;
        ctx.lineWidth = Math.max(2, 7 * t);
        ctx.beginPath();
        ctx.moveTo(toCanvasX(visible[i-1].x), toCanvasY(visible[i-1].y));
        ctx.lineTo(toCanvasX(visible[i].x), toCanvasY(visible[i].y));
        ctx.stroke();
      }
    }
    const cur = visible[visible.length - 1];
    if (cur && currentTime - cur.timeSeconds < 0.08) {
      ctx.shadowColor = '#CCFF00'; ctx.shadowBlur = 18;
      ctx.fillStyle = '#CCFF00';
      ctx.beginPath();
      ctx.arc(toCanvasX(cur.x), toCanvasY(cur.y), 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(toCanvasX(cur.x) - 3, toCanvasY(cur.y) - 3, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (mode === 'arc') {
    const past   = track.filter(p => p.timeSeconds <= currentTime);
    const future = track.filter(p => p.timeSeconds >  currentTime);
    if (past.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(toCanvasX(past[0].x), toCanvasY(past[0].y));
      for (let i = 1; i < past.length; i++)
        ctx.lineTo(toCanvasX(past[i].x), toCanvasY(past[i].y));
      ctx.strokeStyle = 'rgba(204,255,0,0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.stroke();
    }
    if (future.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(toCanvasX(future[0].x), toCanvasY(future[0].y));
      for (let i = 1; i < future.length; i++)
        ctx.lineTo(toCanvasX(future[i].x), toCanvasY(future[i].y));
      ctx.strokeStyle = 'rgba(204,255,0,0.35)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const p of track) {
      ctx.fillStyle = 'rgba(204,255,0,0.6)';
      ctx.beginPath();
      ctx.arc(toCanvasX(p.x), toCanvasY(p.y), 4, 0, Math.PI * 2);
      ctx.fill();
    }
    const cur = track.reduce((a, b) =>
      Math.abs(a.timeSeconds - currentTime) < Math.abs(b.timeSeconds - currentTime) ? a : b,
      track[0]);
    if (cur) {
      ctx.shadowColor = '#CCFF00'; ctx.shadowBlur = 16;
      ctx.fillStyle = '#CCFF00';
      ctx.beginPath();
      ctx.arc(toCanvasX(cur.x), toCanvasY(cur.y), 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  } else if (mode === 'strobe') {
    const step = Math.max(1, Math.floor(track.length / 8));
    for (let i = 0; i < track.length; i += step) {
      const p = track[i];
      ctx.shadowColor = '#CCFF00'; ctx.shadowBlur = 8;
      ctx.fillStyle = 'rgba(204,255,0,0.55)';
      ctx.beginPath();
      ctx.arc(toCanvasX(p.x), toCanvasY(p.y), 8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}

// Draw racket motion trail (wrist positions over a swing segment)
function drawRacketMultiplier(
  ctx: CanvasRenderingContext2D,
  trail: RacketTrail,
  videoNativeW: number,
  videoNativeH: number,
  canvasW: number,
  canvasH: number,
): void {
  if (trail.positions.length === 0) return;

  const sx = canvasW / videoNativeW;
  const sy = canvasH / videoNativeH;

  ctx.save();

  for (let i = 0; i < trail.positions.length; i++) {
    const pos = trail.positions[i];
    const alpha = ((i + 1) / trail.positions.length) * RACKET_TRAIL_MAX_ALPHA;

    ctx.fillStyle = `rgba(255, 165, 0, ${alpha})`;
    ctx.beginPath();
    ctx.arc(pos.wristX * sx, pos.wristY * sy, RACKET_TRAIL_CIRCLE_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    if (i > 0) {
      const prev = trail.positions[i - 1];
      ctx.strokeStyle = `rgba(255, 165, 0, ${alpha * 0.5})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(prev.wristX * sx, prev.wristY * sy);
      ctx.lineTo(pos.wristX * sx, pos.wristY * sy);
      ctx.stroke();
    }
  }

  ctx.restore();
}

// ── Component ──────────────────────────────────────────────────────────────

const CanvasOverlay = React.forwardRef<CanvasHandle, CanvasProps>(
  function CanvasOverlay(
    {
      videoRef,
      webcamVideoRef,
      activeTool,
      drawingOptions,
      containerWidth,
      containerHeight,
      ballTrailMode = 'comet',
      skeletonEnabled = false,
      ballTrailEnabled = false,
      onProcessingStatus,
      isRecording = false,
      circleSpinning = false,
      circleGapMode = false,
      webcamPipMode = 'rectangle',
      webcamOpacity = 1,
      stroMotionGhosts,
      stroMotionOpacity = 0.3,
      stroMotionRegion,
      skeletonShowAngles = true,
      skeletonShowHeadLine = true,
      skeletonClassicColors = false,
      ballSampleMode = false,
      rect3d = false,
      triangle3d = false,
      transparentWhenNoVideo = false,
    },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);

    // Drawing state refs
    const strokesRef      = useRef<Stroke[]>([]);
    const historyRef      = useRef<Stroke[][]>([[]]);
    const historyIdxRef   = useRef<number>(0);
    const activeStrokeRef = useRef<Stroke | null>(null);
    const angleMeasRef    = useRef<AngleMeas[]>([]);
    const liveAngleRef    = useRef<LiveAngle | null>(null);
    const anglePhaseRef   = useRef<0 | 1 | 2>(0);
    const angleVRef       = useRef<Pt | null>(null);
    const angleP1Ref      = useRef<Pt | null>(null);
    const swingPtsRef     = useRef<Pt[]>([]);
    const swingDrawingRef = useRef(false);
    const dragStartRef    = useRef<Pt | null>(null);
    const isDraggingRef   = useRef(false);
    const rafRef          = useRef<number>(0);
    const animTickRef     = useRef<number>(0);
    const longPressRef    = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Dragging circle
    const dragCircleIdxRef = useRef<number>(-1);
    const dragCircleOffRef = useRef<Pt>({ x: 0, y: 0 });
    const selectionRef     = useRef<Selection>(null);

    // Circle gap mode: tracks which circle is being given a gap and which click phase
    const gapCircleIdxRef  = useRef<number>(-1);

    // Racket multiplier trail
    const racketTrailRef   = useRef<RacketTrail | null>(null);

    // Real-time skeleton detection
    const detectorRef         = useRef<any>(null);
    const latestKeypointsRef  = useRef<Array<{ x: number; y: number; score: number; name: string }> | null>(null);
    const poseLoopActiveRef   = useRef(false);
    const skeletonFramesRef   = useRef<Array<{ timeSeconds: number; keypoints: Array<{ x: number; y: number; score: number; name: string }> }>>([]);

    // Real-time ball detection
    const isBallDetectingRef  = useRef(false);
    const ballTrackRef        = useRef<Array<{ timeSeconds: number; x: number; y: number }>>([]);
    const ballDetectRef       = useRef<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null>(null);
    const ballColorRef = useRef<{ hMin: number; hMax: number } | null>(null);

    // Legacy AI detection caches (for manual ball shadow tool)
    const cachedPosesRef    = useRef<CachedPoseFrame[]>([]);
    const poseProcessingRef = useRef(false);
    const cachedBallRef     = useRef<BallPosition[]>([]);
    const ballProcessingRef = useRef(false);

    // Prop mirrors as refs
    const drawingOptsRef      = useRef(drawingOptions);
    const activeToolRef       = useRef(activeTool);
    const skeletonEnabledRef  = useRef(skeletonEnabled);
    const ballTrailEnabledRef = useRef(ballTrailEnabled);
    const ballTrailModeRef    = useRef(ballTrailMode);
    const isRecordingRef      = useRef(isRecording);
    const circleSpinningRef   = useRef(circleSpinning);
    const circleGapModeRef    = useRef(circleGapMode);
    const webcamPipModeRef    = useRef(webcamPipMode);
    const webcamOpacityRef    = useRef(webcamOpacity);
    const stroMotionGhostsRef = useRef<ImageBitmap[]>(stroMotionGhosts ?? []);
    const stroMotionOpacityRef = useRef(stroMotionOpacity);
    const stroMotionRegionRef = useRef(stroMotionRegion);
    const skeletonShowAnglesRef   = useRef(skeletonShowAngles);
    const skeletonShowHeadLineRef = useRef(skeletonShowHeadLine);
    const skeletonClassicColorsRef = useRef(skeletonClassicColors);
    const ballSampleModeRef = useRef(ballSampleMode);
    const rect3dRef = useRef(rect3d);
    const triangle3dRef = useRef(triangle3d);
    const transparentWhenNoVideoRef = useRef(transparentWhenNoVideo);

    // Zoom / pan state
    const zoomRef    = useRef(1.0);
    const panXRef    = useRef(0);
    const panYRef    = useRef(0);
    const isPanningRef  = useRef(false);
    const panStartRef   = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
    const spaceHeldRef  = useRef(false);
    /** Letterbox bounds of video in logical canvas space — updated each rAF */
    const videoBoundsRef = useRef({ dx: 0, dy: 0, dw: 1, dh: 1 });

    // StroMotion rubber-band region selection
    const isSelectingStroRegionRef   = useRef(false);
    const stroRegionCallbackRef      = useRef<((r: { x: number; y: number; w: number; h: number }) => void) | null>(null);
    const stroRegionStartRef         = useRef<Pt | null>(null);
    const stroRegionCurrentRef       = useRef<Pt | null>(null);

    const isCropSelectingRef    = useRef(false);
    const cropSelectStartRef    = useRef<Pt | null>(null);
    const cropSelectCurrentRef  = useRef<Pt | null>(null);
    const cropRegionRef         = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

    // Manual swing state
    const manualSwingPtsRef     = useRef<Pt[]>([]);
    const manualSwingActiveRef  = useRef(false);
    const lastClickTimeRef      = useRef(0);
    const lastClickPosRef       = useRef<Pt | null>(null);

    useEffect(() => { drawingOptsRef.current      = drawingOptions; },  [drawingOptions]);
    useEffect(() => { activeToolRef.current        = activeTool; },      [activeTool]);
    useEffect(() => { skeletonEnabledRef.current   = skeletonEnabled; }, [skeletonEnabled]);
    useEffect(() => { ballTrailEnabledRef.current  = ballTrailEnabled; }, [ballTrailEnabled]);
    useEffect(() => { ballTrailModeRef.current     = ballTrailMode; },   [ballTrailMode]);
    useEffect(() => { isRecordingRef.current       = isRecording; },     [isRecording]);
    useEffect(() => { circleSpinningRef.current    = circleSpinning; },  [circleSpinning]);
    useEffect(() => { circleGapModeRef.current     = circleGapMode; },   [circleGapMode]);
    useEffect(() => { webcamPipModeRef.current     = webcamPipMode; },   [webcamPipMode]);
    useEffect(() => { webcamOpacityRef.current     = webcamOpacity; },   [webcamOpacity]);
    useEffect(() => { stroMotionGhostsRef.current  = stroMotionGhosts ?? []; }, [stroMotionGhosts]);
    useEffect(() => { stroMotionOpacityRef.current = stroMotionOpacity; },      [stroMotionOpacity]);
    useEffect(() => { stroMotionRegionRef.current  = stroMotionRegion; },        [stroMotionRegion]);
    useEffect(() => { skeletonShowAnglesRef.current   = skeletonShowAngles; },   [skeletonShowAngles]);
    useEffect(() => { skeletonShowHeadLineRef.current  = skeletonShowHeadLine; },  [skeletonShowHeadLine]);
    useEffect(() => { skeletonClassicColorsRef.current = skeletonClassicColors; }, [skeletonClassicColors]);
    useEffect(() => { ballSampleModeRef.current = ballSampleMode; }, [ballSampleMode]);
    useEffect(() => { rect3dRef.current = rect3d; }, [rect3d]);
    useEffect(() => { triangle3dRef.current = triangle3d; }, [triangle3d]);
    useEffect(() => { transparentWhenNoVideoRef.current = transparentWhenNoVideo; }, [transparentWhenNoVideo]);

    // ── Touch pinch zoom ────────────────────────────────────────────────────
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      let lastDist = 0;

      const onTouchStart = (e: TouchEvent) => {
        if (e.touches.length === 2) {
          const t1 = e.touches[0], t2 = e.touches[1];
          lastDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
          e.preventDefault();
        }
      };
      const onTouchMove = (e: TouchEvent) => {
        if (e.touches.length === 2) {
          const t1 = e.touches[0], t2 = e.touches[1];
          const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
          if (lastDist > 0) {
            const factor = dist / lastDist;
            zoomRef.current = Math.max(0.25, Math.min(8, zoomRef.current * factor));
          }
          lastDist = dist;
          e.preventDefault();
        } else if (e.touches.length === 1 && zoomRef.current > 1) {
          e.preventDefault();
        }
      };
      const onTouchEnd = () => { lastDist = 0; };

      canvas.addEventListener('touchstart', onTouchStart, { passive: false });
      canvas.addEventListener('touchmove', onTouchMove, { passive: false });
      canvas.addEventListener('touchend', onTouchEnd);
      return () => {
        canvas.removeEventListener('touchstart', onTouchStart);
        canvas.removeEventListener('touchmove', onTouchMove);
        canvas.removeEventListener('touchend', onTouchEnd);
      };
    }, []);

    // ── History ────────────────────────────────────────────────────────────

    const pushHistory = useCallback(() => {
      const idx = historyIdxRef.current;
      historyRef.current = historyRef.current.slice(0, idx + 1);
      historyRef.current.push([...strokesRef.current]);
      if (historyRef.current.length > 50) historyRef.current.shift();
      historyIdxRef.current = historyRef.current.length - 1;
    }, []);

    // ── Exposed handle ─────────────────────────────────────────────────────

    useImperativeHandle(ref, () => ({
      clearAll: () => {
        strokesRef.current = [];
        angleMeasRef.current = [];
        activeStrokeRef.current = null;
        swingPtsRef.current = [];
        swingDrawingRef.current = false;
        manualSwingPtsRef.current = [];
        manualSwingActiveRef.current = false;
        liveAngleRef.current = null;
        anglePhaseRef.current = 0;
        angleVRef.current = null;
        angleP1Ref.current = null;
        // ClearAll should remove *everything* including AI overlays.
        cachedPosesRef.current = [];
        poseProcessingRef.current = false;
        skeletonFramesRef.current = [];
        latestKeypointsRef.current = null;
        cachedBallRef.current = [];
        ballProcessingRef.current = false;
        ballTrackRef.current = [];
        isBallDetectingRef.current = false;
        cropRegionRef.current = null;
        onProcessingStatus?.(null);
        pushHistory();
      },
      resetSkeleton: () => {
        cachedPosesRef.current = [];
        poseProcessingRef.current = false;
        skeletonFramesRef.current = [];
        latestKeypointsRef.current = null;
        onProcessingStatus?.(null);
      },
      resetBallTrail: () => {
        cachedBallRef.current = [];
        ballProcessingRef.current = false;
        ballTrackRef.current = [];
        isBallDetectingRef.current = false;
        onProcessingStatus?.(null);
      },
      getCanvas: () => canvasRef.current,
      getCompositeCanvas: () => canvasRef.current,
      captureStream: (fps = 30) => {
        if (!streamRef.current) {
          const canvas = canvasRef.current;
          if (!canvas) return null;
          streamRef.current = (canvas as unknown as { captureStream(f: number): MediaStream }).captureStream(fps);
        }
        return streamRef.current;
      },
      undo: () => {
        if (historyIdxRef.current > 0) {
          historyIdxRef.current--;
          strokesRef.current = [...historyRef.current[historyIdxRef.current]];
        }
      },
      redo: () => {
        if (historyIdxRef.current < historyRef.current.length - 1) {
          historyIdxRef.current++;
          strokesRef.current = [...historyRef.current[historyIdxRef.current]];
        }
      },
      getDetectedSwings: () => {
        const frames = skeletonFramesRef.current;
        const video = videoRef.current;
        if (frames.length === 0 || !video) return [];
        return detectSwingSegments(frames, video.videoWidth, video.videoHeight);
      },
      drawSwingFromSegment: (segment: SwingSegment, color: string) => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) return;

        const vW2 = video.videoWidth || canvas.width;
        const vH2 = video.videoHeight || canvas.height;
        const sc = Math.min(canvas.width / vW2, canvas.height / vH2);
        const dw2 = vW2 * sc;
        const dh2 = vH2 * sc;
        const dx2 = (canvas.width - dw2) / 2;
        const dy2 = (canvas.height - dh2) / 2;

        const points = segment.wristPositions.map((p) => ({
          x: dx2 + p.x * (dw2 / vW2),
          y: dy2 + p.y * (dh2 / vH2),
        }));

        strokesRef.current.push({
          tool: 'swingPath',
          pts: points,
          color,
          lw: 4,
          dashed: false,
        });
        pushHistory();
      },
      setRacketTrail: (trail: RacketTrail | null) => {
        racketTrailRef.current = trail;
      },
      getSkeletonFrames: () => skeletonFramesRef.current,
      startStroMotionRegionSelect: (cb) => {
        isSelectingStroRegionRef.current = true;
        stroRegionCallbackRef.current = cb;
        stroRegionStartRef.current = null;
        stroRegionCurrentRef.current = null;
      },
      resetCropZoom: () => {
        zoomRef.current = 1.0;
        panXRef.current = 0;
        panYRef.current = 0;
      },
      getCropRegion: () => cropRegionRef.current,
      clearCropRegion: () => { cropRegionRef.current = null; },
    }), [onProcessingStatus, pushHistory, videoRef]);

    // ── Skeleton detector loader ───────────────────────────────────────────

    useEffect(() => {
      if (!skeletonEnabled) {
        poseLoopActiveRef.current = false;
        latestKeypointsRef.current = null;
        return;
      }
      ensurePoseRender();
      if (typeof window === 'undefined') return;

      let cancelled = false;

      (async () => {
        onProcessingStatus?.('Loading pose model…');
        try {
          const tf = await import('@tensorflow/tfjs-core');
          await import('@tensorflow/tfjs-backend-webgl');
          await import('@tensorflow/tfjs-converter');
          await tf.setBackend('webgl');
          await tf.ready();
          const pd = await import('@tensorflow-models/pose-detection');
          if (cancelled) return;
          const det = await pd.createDetector(
            pd.SupportedModels.MoveNet,
            { modelType: pd.movenet.modelType.SINGLEPOSE_LIGHTNING },
          );
          if (cancelled) return;
          detectorRef.current = det;
          onProcessingStatus?.('Skeleton ready — press play');
        } catch (e: any) {
          if (!cancelled) onProcessingStatus?.(`Skeleton load failed: ${e.message}`);
        }
      })();

      return () => { cancelled = true; };
    }, [skeletonEnabled, onProcessingStatus]);

    // ── Pose detection loop — separate from the drawing rAF ───────────────

    useEffect(() => {
      if (!skeletonEnabled) return;
      const video = videoRef.current;
      if (!video) return;

      let rafId: number;
      poseLoopActiveRef.current = true;

      const poseLoop = async () => {
        if (!poseLoopActiveRef.current) return;

        const det = detectorRef.current;
        if (det && video.readyState >= 4 && video.videoWidth > 0) {
          try {
            const poses = await det.estimatePoses(video, { flipHorizontal: false });
            if (poses && poses.length > 0 && poses[0].keypoints) {
              const keypoints = poses[0].keypoints;
              latestKeypointsRef.current = keypoints;
              // Maintain skeletonFramesRef for swing detection.
              // Only push when the video has advanced to a new timestamp to avoid
              // flooding the buffer with identical zero-velocity frames while paused.
              const now = video.currentTime;
              const lastFrame = skeletonFramesRef.current.at(-1);
              if (!video.paused && (!lastFrame || now !== lastFrame.timeSeconds)) {
                skeletonFramesRef.current.push({ timeSeconds: now, keypoints });
                if (skeletonFramesRef.current.length > MAX_SKELETON_FRAMES) {
                  skeletonFramesRef.current = skeletonFramesRef.current.slice(-MAX_SKELETON_FRAMES);
                }
              }
            }
          } catch (e) {
            // Silent fail — video may not be ready
          }
        }

        rafId = requestAnimationFrame(poseLoop);
      };

      rafId = requestAnimationFrame(poseLoop);
      return () => {
        poseLoopActiveRef.current = false;
        cancelAnimationFrame(rafId);
      };
    }, [skeletonEnabled, videoRef]);

    // ── Ball detection canvas initialization ──────────────────────────────

    useEffect(() => {
      if (!ballTrailEnabled) {
        ballTrackRef.current = [];
        ballDetectRef.current = null;
        return;
      }
      const video = videoRef.current;
      if (!video) return;

      const setup = () => {
        if (video.videoWidth === 0) return;
        const c = document.createElement('canvas');
        const MAX_DETECT_W = 320;
        const scale = Math.min(1, MAX_DETECT_W / video.videoWidth);
        c.width  = Math.round(video.videoWidth  * scale);
        c.height = Math.round(video.videoHeight * scale);
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ballDetectRef.current = { canvas: c, ctx };
          onProcessingStatus?.('Ball detection ready — press play');
        }
      };

      if (video.readyState >= 1 && video.videoWidth > 0) {
        setup();
      } else {
        video.addEventListener('loadedmetadata', setup, { once: true });
      }

      return () => {
        ballTrackRef.current = [];
        ballDetectRef.current = null;
      };
    }, [ballTrailEnabled, videoRef, onProcessingStatus]);

    // ── Canvas size ────────────────────────────────────────────────────────

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas || !containerWidth || !containerHeight) return;
      canvas.width = containerWidth;
      canvas.height = containerHeight;
    }, [containerWidth, containerHeight]);

    // ── Wheel zoom ─────────────────────────────────────────────────────────

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        zoomRef.current = Math.max(0.25, Math.min(8, zoomRef.current * factor));
      };
      canvas.addEventListener('wheel', onWheel, { passive: false });
      return () => canvas.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Space key for pan mode ──────────────────────────────────────────────

    useEffect(() => {
      const onKeyDown = (e: KeyboardEvent) => { if (e.code === 'Space') spaceHeldRef.current = true; };
      const onKeyUp   = (e: KeyboardEvent) => {
        if (e.code === 'Space') {
          spaceHeldRef.current = false;
          isPanningRef.current = false;
          panStartRef.current = null;
        }
      };
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup',   onKeyUp);
      return () => {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup',   onKeyUp);
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Render loop ────────────────────────────────────────────────────────

    useEffect(() => {
      const render = () => {
        rafRef.current = requestAnimationFrame(render);
        animTickRef.current++;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const W = canvas.width;
        const H = canvas.height;
        ctx.clearRect(0, 0, W, H);

        // ── Apply zoom/pan transform ──────────────────────────────────────
        ctx.save();
        ctx.translate(W / 2 + panXRef.current, H / 2 + panYRef.current);
        ctx.scale(zoomRef.current, zoomRef.current);
        ctx.translate(-W / 2, -H / 2);

        // Video frame (letterboxed to preserve aspect ratio)
        const video = videoRef.current;
        let dx = 0, dy = 0, dw = W, dh = H, vW = W, vH = H;

        if (video && video.readyState >= 2 && video.videoWidth > 0) {
          vW = video.videoWidth;
          vH = video.videoHeight;
          const scale = Math.min(W / vW, H / vH);
          dw = vW * scale;
          dh = vH * scale;
          dx = (W - dw) / 2;
          dy = (H - dh) / 2;
          // Store for rubber-band region selection coordinate mapping
          videoBoundsRef.current = { dx, dy, dw, dh };
          ctx.drawImage(video, dx, dy, dw, dh);

          // ── Real-time ball detection (runs when playing or scrubbing) ──────
          if (ballTrailEnabledRef.current && !isBallDetectingRef.current) {
            const det = ballDetectRef.current;
            if (det && video.readyState >= 2 && video.videoWidth > 0) {
              const currentTime = video.currentTime;
              const hasRecent = ballTrackRef.current.some(p => Math.abs(p.timeSeconds - currentTime) < BALL_DETECT_TIME_TOLERANCE);

              if (!hasRecent) {
                isBallDetectingRef.current = true;
                det.ctx.drawImage(video, 0, 0, det.canvas.width, det.canvas.height);

                let imageData: ImageData | null = null;
                try {
                  imageData = det.ctx.getImageData(0, 0, det.canvas.width, det.canvas.height);
                } catch (e) {
                  // SecurityError: canvas tainted by cross-origin data — skip detection
                  onProcessingStatus?.('Ball detection unavailable: cross-origin video');
                  isBallDetectingRef.current = false;
                }

                if (imageData) {
                  const pos = findBallInImageData(imageData, det.canvas.width, det.canvas.height, ballColorRef.current);
                  if (pos) {
                    const scaleX = vW / det.canvas.width;
                    const scaleY = vH / det.canvas.height;
                    const newX = pos.x * scaleX;
                    const newY = pos.y * scaleY;

                    // Velocity gating: reject jumps that are unrealistically large
                    const last = ballTrackRef.current.at(-1);
                    const MAX_JUMP_FRACTION = 0.25;
                    const maxJump = Math.min(vW, vH) * MAX_JUMP_FRACTION;
                    const jumped = last
                      ? Math.hypot(newX - last.x, newY - last.y) > maxJump
                      : false;

                    if (!jumped) {
                      // EMA smoothing
                      const ALPHA = 0.6;
                      const smoothX = last ? ALPHA * newX + (1 - ALPHA) * last.x : newX;
                      const smoothY = last ? ALPHA * newY + (1 - ALPHA) * last.y : newY;
                      ballTrackRef.current.push({
                        timeSeconds: currentTime,
                        x: smoothX,
                        y: smoothY,
                      });
                      const cutoff = currentTime - BALL_TRAIL_WINDOW_SECONDS;
                      ballTrackRef.current = ballTrackRef.current.filter(p => p.timeSeconds >= cutoff);
                      onProcessingStatus?.(null);
                    }
                  }
                  isBallDetectingRef.current = false;
                }
              }
            }
          }
        } else {
          if (transparentWhenNoVideoRef.current) {
            ctx.clearRect(0, 0, W, H);
          } else {
            ctx.fillStyle = '#111';
            ctx.fillRect(0, 0, W, H);
          }
        }

        // ── StroMotion ghost frames ───────────────────────────────────────
        const stroGhosts = stroMotionGhostsRef.current;
        if (stroGhosts.length > 0 && dw > 0 && dh > 0) {
          ctx.save();
          const baseOpacity = stroMotionOpacityRef.current;
          const region = stroMotionRegionRef.current;
          for (let i = 0; i < stroGhosts.length; i++) {
            const alpha = Math.min(baseOpacity, ((i + 1) / stroGhosts.length) * baseOpacity);
            ctx.globalAlpha = Math.max(MIN_GHOST_OPACITY, alpha);
            if (region) {
              // Draw only in the selected video region
              const rx = dx + region.x * dw;
              const ry = dy + region.y * dh;
              const rw = region.w * dw;
              const rh = region.h * dh;
              ctx.drawImage(stroGhosts[i], rx, ry, rw, rh);
              // Draw faint outline around region on first (most-opaque) ghost
              if (i === stroGhosts.length - 1) {
                ctx.globalAlpha = 0.5;
                ctx.strokeStyle = '#35679A';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 4]);
                ctx.strokeRect(rx, ry, rw, rh);
                ctx.setLineDash([]);
              }
            } else {
              ctx.drawImage(stroGhosts[i], dx, dy, dw, dh);
            }
          }
          ctx.globalAlpha = 1.0;
          ctx.restore();
        }

        // ── Skeleton overlay ─────────────────────────────────────────────
        if (skeletonEnabledRef.current && video) {
          if (latestKeypointsRef.current && latestKeypointsRef.current.length > 0 && video.videoWidth > 0) {
            ctx.save();
            ctx.translate(dx, dy);
            drawSkeletonOverlay(ctx, latestKeypointsRef.current, vW, vH, dw, dh, {
              showAngles: skeletonShowAnglesRef.current,
              showHeadLine: skeletonShowHeadLineRef.current,
              classicColors: skeletonClassicColorsRef.current,
            });
            ctx.restore();
          } else if (cachedPosesRef.current.length > 0 && poseRenderFns) {
            // Fallback to legacy cached poses
            const pf = poseRenderFns.getPoseAtTime(cachedPosesRef.current, video.currentTime);
            if (pf && pf.poses.length > 0) {
              const scaleXY = dw / vW;
              ctx.save();
              ctx.translate(dx, dy);
              poseRenderFns.drawPoseSkeleton(ctx, pf.poses, dw, dh, scaleXY, scaleXY);
              ctx.restore();
            }
          }
        }

        // ── Ball trail overlay ───────────────────────────────────────────
        if (ballTrailEnabledRef.current && video) {
          if (ballTrackRef.current.length > 0) {
            drawRealtimeBallTrail(
              ctx,
              ballTrackRef.current,
              video.currentTime,
              ballTrailModeRef.current,
              dx, dy, dw, dh,
              vW, vH,
            );
          } else if (cachedBallRef.current.length > 0) {
            const curFrame = Math.round(video.currentTime * 30);
            drawBallTrailOnCanvas(ctx, cachedBallRef.current, curFrame, ballTrailModeRef.current, dx, dy, dw, dh);
          }
        }

        // ── Racket multiplier overlay ─────────────────────────────────────
        if (racketTrailRef.current && video && vW > 0) {
          ctx.save();
          ctx.translate(dx, dy);
          drawRacketMultiplier(ctx, racketTrailRef.current, vW, vH, dw, dh);
          ctx.restore();
        }

        // Webcam PiP — bottom-right corner when recording
        const webcam = webcamVideoRef?.current;
        if (isRecordingRef.current && webcam && webcam.readyState >= 2 && webcamPipModeRef.current !== 'hidden') {
          const camW = Math.round(W * 0.22);
          const camH = Math.round(camW * (9 / 16));
          const margin = 16;
          const cx2 = W - camW - margin;
          const cy2 = H - camH - margin;
          ctx.save();
          ctx.globalAlpha = webcamOpacityRef.current;
          if (webcamPipModeRef.current === 'circle') {
            const r = Math.min(camW, camH) / 2;
            const centerX = cx2 + camW / 2;
            const centerY = cy2 + camH / 2;
            ctx.beginPath();
            ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(webcam, cx2, cy2, camW, camH);
          } else {
            // rectangle mode
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(cx2, cy2, camW, camH, 10);
            else ctx.rect(cx2, cy2, camW, camH);
            ctx.clip();
            ctx.drawImage(webcam, cx2, cy2, camW, camH);
            ctx.globalAlpha = 1;
            ctx.strokeStyle = '#35679A';
            ctx.lineWidth = 3;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(cx2, cy2, camW, camH, 10);
            else ctx.rect(cx2, cy2, camW, camH);
            ctx.stroke();
          }
          ctx.restore();
        }

        // Completed strokes
        for (const s of strokesRef.current) drawStroke(ctx, s, animTickRef.current);

        // Active (in-progress) stroke
        if (activeStrokeRef.current) drawStroke(ctx, activeStrokeRef.current, animTickRef.current);

        // Swing path being drawn
        if (swingDrawingRef.current && swingPtsRef.current.length > 0) {
          const pts = swingPtsRef.current;
          const opts = drawingOptsRef.current;
          drawSmoothPath(ctx, pts, opts.color, opts.lineWidth, 0.8, opts.dashed ?? false);
        }

        // Manual swing path being drawn
        if (manualSwingActiveRef.current && manualSwingPtsRef.current.length > 0) {
          const pts = manualSwingPtsRef.current;
          const opts = drawingOptsRef.current;
          drawSmoothPath(ctx, pts, opts.color, opts.lineWidth, 0.8, opts.dashed ?? false);
        }

        // Locked angle measurements
        for (const m of angleMeasRef.current) drawAngleMeas(ctx, m);

        // Live angle preview
        const live = liveAngleRef.current;
        if (live) {
          if (live.phase === 2) {
            drawLiveAnglePrev(ctx, live);
          } else {
            ctx.save();
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = 'rgba(255,215,0,0.85)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(live.v.x, live.v.y);
            ctx.lineTo(live.p1.x, live.p1.y);
            ctx.stroke();
            ctx.restore();
          }
        }

        // ── Select tool highlight ────────────────────────────────────────
        const sel = selectionRef.current;
        if (sel) {
          let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
          if (sel.kind === 'stroke') {
            const s = strokesRef.current[sel.idx];
            if (s) {
              if (s.tool === 'pen' || s.tool === 'swingPath' || s.tool === 'manualSwing') {
                const pts = (s as StrokePen | StrokeSwing).pts;
                if (pts.length > 0) {
                  x0 = Math.min(...pts.map(p => p.x)); y0 = Math.min(...pts.map(p => p.y));
                  x1 = Math.max(...pts.map(p => p.x)); y1 = Math.max(...pts.map(p => p.y));
                }
              } else if (s.tool === 'line' || s.tool === 'arrow' || s.tool === 'arrowAngle') {
                const l = s as StrokeLine | StrokeArrow;
                x0 = Math.min(l.p1.x, l.p2.x); y0 = Math.min(l.p1.y, l.p2.y);
                x1 = Math.max(l.p1.x, l.p2.x); y1 = Math.max(l.p1.y, l.p2.y);
              } else if (s.tool === 'circle' || s.tool === 'bodyCircle') {
                const el = s as StrokeEllipse;
                x0 = el.cx - el.rx; y0 = el.cy - el.ry;
                x1 = el.cx + el.rx; y1 = el.cy + el.ry;
              } else if (s.tool === 'rect' || s.tool === 'triangle') {
                const sh = s as StrokeRect | StrokeTriangle;
                x0 = sh.cx - sh.rx; y0 = sh.cy - sh.ry;
                x1 = sh.cx + sh.rx; y1 = sh.cy + sh.ry;
              } else if (s.tool === 'text') {
                const tx = s as StrokeText;
                x0 = tx.pos.x - 20; y0 = tx.pos.y - 24;
                x1 = tx.pos.x + 140; y1 = tx.pos.y + 10;
              }
            }
          } else if (sel.kind === 'angle') {
            const m = angleMeasRef.current[sel.idx];
            if (m) {
              x0 = Math.min(m.v.x, m.p1.x, m.p2.x);
              y0 = Math.min(m.v.y, m.p1.y, m.p2.y);
              x1 = Math.max(m.v.x, m.p1.x, m.p2.x);
              y1 = Math.max(m.v.y, m.p1.y, m.p2.y);
            }
          }
          if (x1 > x0 || y1 > y0) {
            ctx.save();
            ctx.strokeStyle = 'rgba(255,215,0,0.95)';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.strokeRect(x0 - 6, y0 - 6, (x1 - x0) + 12, (y1 - y0) + 12);
            ctx.setLineDash([]);
            ctx.restore();
          }
        }

        // ── StroMotion rubber-band region selection ───────────────────────
        if (isSelectingStroRegionRef.current && stroRegionStartRef.current && stroRegionCurrentRef.current) {
          const p1 = stroRegionStartRef.current;
          const p2 = stroRegionCurrentRef.current;
          const rx = Math.min(p1.x, p2.x), ry = Math.min(p1.y, p2.y);
          const rw = Math.abs(p2.x - p1.x), rh = Math.abs(p2.y - p1.y);
          ctx.save();
          ctx.strokeStyle = '#35679A';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.strokeRect(rx, ry, rw, rh);
          ctx.fillStyle = 'rgba(53,103,154,0.12)';
          ctx.fillRect(rx, ry, rw, rh);
          ctx.setLineDash([]);
          ctx.restore();
        }

        // ── CropSelect rectangle ──────────────────────────────────────────────
        if (isCropSelectingRef.current && cropSelectStartRef.current && cropSelectCurrentRef.current) {
          const p1 = cropSelectStartRef.current;
          const p2 = cropSelectCurrentRef.current;
          const rx = Math.min(p1.x, p2.x), ry = Math.min(p1.y, p2.y);
          const rw = Math.abs(p2.x - p1.x), rh = Math.abs(p2.y - p1.y);
          ctx.save();
          ctx.strokeStyle = '#FF8C00';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.strokeRect(rx, ry, rw, rh);
          ctx.fillStyle = 'rgba(255, 140, 0, 0.1)';
          ctx.fillRect(rx, ry, rw, rh);
          ctx.setLineDash([]);
          ctx.restore();
        }

        // ── Active crop region (for export/recording) ─────────────────────
        if (cropRegionRef.current && !isCropSelectingRef.current) {
          const cr = cropRegionRef.current;
          const rx = cr.x * W;
          const ry = cr.y * H;
          const rw = cr.w * W;
          const rh = cr.h * H;
          ctx.save();
          ctx.strokeStyle = 'rgba(255, 140, 0, 0.95)';
          ctx.lineWidth = 2;
          ctx.strokeRect(rx, ry, rw, rh);
          ctx.fillStyle = 'rgba(255, 140, 0, 0.06)';
          ctx.fillRect(rx, ry, rw, rh);
          ctx.restore();
        }

        // ── Undo zoom/pan transform ───────────────────────────────────────
        ctx.restore();

        // Draw zoom level indicator (outside transform, fixed in corner)
        if (zoomRef.current !== 1.0 || panXRef.current !== 0 || panYRef.current !== 0) {
          const label = `${Math.round(zoomRef.current * 100)}%`;
          ctx.save();
          ctx.font = 'bold 12px -apple-system, sans-serif';
          const m = ctx.measureText(label);
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(8, 8, m.width + 12, 22);
          ctx.fillStyle = '#fff';
          ctx.fillText(label, 14, 24);
          ctx.restore();
        }
      };

      rafRef.current = requestAnimationFrame(render);
      return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Pointer helpers ────────────────────────────────────────────────────

    const getPos = (e: React.PointerEvent<HTMLCanvasElement>): Pt => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const sx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const sy = (e.clientY - rect.top)  * (canvas.height / rect.height);
      const W = canvas.width;
      const H = canvas.height;
      // Inverse zoom/pan transform so returned coords are in logical canvas space
      return {
        x: (sx - (W / 2 + panXRef.current)) / zoomRef.current + W / 2,
        y: (sy - (H / 2 + panYRef.current)) / zoomRef.current + H / 2,
      };
    };

    const pressureWidth = (e: React.PointerEvent<HTMLCanvasElement>): number => {
      const base = drawingOptsRef.current.lineWidth;
      return e.pointerType === 'pen' && e.pressure > 0
        ? Math.max(1, base * e.pressure * 2.5)
        : base;
    };

    // ── Finish swing path ──────────────────────────────────────────────────

    const finishSwingPath = useCallback(() => {
      if (longPressRef.current) clearTimeout(longPressRef.current);
      const pts = swingPtsRef.current;
      if (pts.length > 0) {
        const opts = drawingOptsRef.current;
        strokesRef.current = [
          ...strokesRef.current,
          { tool: 'swingPath', pts: [...pts], color: opts.color, lw: opts.lineWidth, dashed: opts.dashed ?? false },
        ];
        pushHistory();
      }
      swingPtsRef.current = [];
      swingDrawingRef.current = false;
    }, [pushHistory]);

    const finishManualSwingPath = useCallback(() => {
      const pts = manualSwingPtsRef.current;
      if (pts.length > 0) {
        const opts = drawingOptsRef.current;
        strokesRef.current = [
          ...strokesRef.current,
          { tool: 'manualSwing', pts: [...pts], color: opts.color, lw: opts.lineWidth, dashed: opts.dashed ?? false },
        ];
        pushHistory();
      }
      manualSwingPtsRef.current = [];
      manualSwingActiveRef.current = false;
      lastClickTimeRef.current = 0;
      lastClickPosRef.current = null;
    }, [pushHistory]);

    // ── Select tool: hit-test + drag any object ────────────────────────────

    const distToSegment = (p: Pt, a: Pt, b: Pt): number => {
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const apx = p.x - a.x;
      const apy = p.y - a.y;
      const denom = abx * abx + aby * aby;
      const t = denom > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / denom)) : 0;
      const cx = a.x + t * abx;
      const cy = a.y + t * aby;
      return Math.hypot(p.x - cx, p.y - cy);
    };

    const hitTestStroke = (s: Stroke, pos: Pt): number => {
      if (s.tool === 'pen' || s.tool === 'swingPath' || s.tool === 'manualSwing') {
        const pts = (s as StrokePen | StrokeSwing).pts;
        if (pts.length === 0) return Infinity;
        let best = Infinity;
        for (let i = 0; i < pts.length - 1; i++) best = Math.min(best, distToSegment(pos, pts[i], pts[i + 1]));
        best = Math.min(best, Math.hypot(pos.x - pts[0].x, pos.y - pts[0].y));
        return best;
      }
      if (s.tool === 'line' || s.tool === 'arrow' || s.tool === 'arrowAngle') {
        const l = s as StrokeLine | StrokeArrow;
        return distToSegment(pos, l.p1, l.p2);
      }
      if (s.tool === 'circle' || s.tool === 'bodyCircle') {
        const el = s as StrokeEllipse;
        const rx = Math.max(1, el.rx);
        const ry = Math.max(1, el.ry);
        const nx = (pos.x - el.cx) / rx;
        const ny = (pos.y - el.cy) / ry;
        const d = Math.abs(Math.hypot(nx, ny) - 1);
        return d * Math.max(rx, ry);
      }
      if (s.tool === 'rect') {
        const r = s as StrokeRect;
        const x0 = r.cx - r.rx, x1 = r.cx + r.rx;
        const y0 = r.cy - r.ry, y1 = r.cy + r.ry;
        const cx = Math.max(x0, Math.min(x1, pos.x));
        const cy = Math.max(y0, Math.min(y1, pos.y));
        const outside = (pos.x < x0 || pos.x > x1 || pos.y < y0 || pos.y > y1);
        return outside ? Math.hypot(pos.x - cx, pos.y - cy) : Math.min(
          Math.abs(pos.x - x0),
          Math.abs(pos.x - x1),
          Math.abs(pos.y - y0),
          Math.abs(pos.y - y1),
        );
      }
      if (s.tool === 'triangle') {
        const t = s as StrokeTriangle;
        // Approx: treat as bounding box of the triangle.
        const x0 = t.cx - t.rx, x1 = t.cx + t.rx;
        const y0 = t.cy - t.ry, y1 = t.cy + t.ry;
        const cx = Math.max(x0, Math.min(x1, pos.x));
        const cy = Math.max(y0, Math.min(y1, pos.y));
        return Math.hypot(pos.x - cx, pos.y - cy);
      }
      if (s.tool === 'text') {
        const tx = s as StrokeText;
        return Math.hypot(pos.x - tx.pos.x, pos.y - tx.pos.y);
      }
      return Infinity;
    };

    const translateStroke = (s: Stroke, dx: number, dy: number): Stroke => {
      if (s.tool === 'pen' || s.tool === 'swingPath' || s.tool === 'manualSwing') {
        return { ...s, pts: (s as StrokePen | StrokeSwing).pts.map((p) => ({ x: p.x + dx, y: p.y + dy })) } as Stroke;
      }
      if (s.tool === 'line' || s.tool === 'arrow' || s.tool === 'arrowAngle') {
        const l = s as StrokeLine | StrokeArrow;
        return { ...s, p1: { x: l.p1.x + dx, y: l.p1.y + dy }, p2: { x: l.p2.x + dx, y: l.p2.y + dy } } as Stroke;
      }
      if (s.tool === 'circle' || s.tool === 'bodyCircle' || s.tool === 'rect' || s.tool === 'triangle') {
        const anyS = s as any;
        return { ...s, cx: anyS.cx + dx, cy: anyS.cy + dy } as Stroke;
      }
      if (s.tool === 'text') {
        const tx = s as StrokeText;
        return { ...s, pos: { x: tx.pos.x + dx, y: tx.pos.y + dy } } as Stroke;
      }
      return s;
    };

    // ── Erase near a point ─────────────────────────────────────────────────

    const eraseAt = useCallback((pos: Pt) => {
      const T = 22;
      strokesRef.current = strokesRef.current.filter((s) => {
        if (s.tool === 'pen' || s.tool === 'swingPath' || s.tool === 'manualSwing')
          return !s.pts.some(p => Math.hypot(p.x - pos.x, p.y - pos.y) < T);
        if (s.tool === 'line' || s.tool === 'arrow' || s.tool === 'arrowAngle')
          return Math.hypot(s.p1.x - pos.x, s.p1.y - pos.y) > T
              && Math.hypot(s.p2.x - pos.x, s.p2.y - pos.y) > T;
        if (s.tool === 'circle' || s.tool === 'bodyCircle' || s.tool === 'rect' || s.tool === 'triangle')
          return Math.hypot(s.cx - pos.x, s.cy - pos.y) > T;
        if (s.tool === 'text')
          return Math.hypot(s.pos.x - pos.x, s.pos.y - pos.y) > T;
        return true;
      });
      angleMeasRef.current = angleMeasRef.current.filter(
        m => Math.hypot(m.v.x - pos.x, m.v.y - pos.y) > T,
      );
    }, []);

    // ── Pointer down ───────────────────────────────────────────────────────

    const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
      const pos  = getPos(e);
      const lw   = pressureWidth(e);
      const tool = activeToolRef.current;
      const opts = drawingOptsRef.current;

      // ── CropSelect rubber-band ────────────────────────────────────────────
      if (activeToolRef.current === 'cropSelect') {
        isCropSelectingRef.current = true;
        cropSelectStartRef.current = pos;
        cropSelectCurrentRef.current = pos;
        isDraggingRef.current = true;
        return;
      }

      // ── StroMotion rubber-band region selection ──────────────────────────
      if (isSelectingStroRegionRef.current) {
        stroRegionStartRef.current = pos;
        stroRegionCurrentRef.current = pos;
        isDraggingRef.current = true;
        return;
      }

      // ── Pan: middle-click or Space+drag ─────────────────────────────────
      if (e.button === 1 || spaceHeldRef.current) {
        isPanningRef.current = true;
        panStartRef.current = { x: e.clientX, y: e.clientY, px: panXRef.current, py: panYRef.current };
        e.preventDefault();
        return;
      }

      // ── Select tool: pick nearest object and drag it ────────────────────
      if (tool === 'select') {
        const HIT_T = 28;
        let best: Selection = null;
        let bestDist = Infinity;

        for (let i = 0; i < strokesRef.current.length; i++) {
          const d = hitTestStroke(strokesRef.current[i], pos);
          if (d < bestDist) {
            bestDist = d;
            best = { kind: 'stroke', idx: i, start: pos, orig: strokesRef.current[i] };
          }
        }

        for (let i = 0; i < angleMeasRef.current.length; i++) {
          const m = angleMeasRef.current[i];
          const d = Math.min(
            Math.hypot(pos.x - m.v.x, pos.y - m.v.y),
            distToSegment(pos, m.v, m.p1),
            distToSegment(pos, m.v, m.p2),
          );
          if (d < bestDist) {
            bestDist = d;
            best = { kind: 'angle', idx: i, start: pos, orig: m };
          }
        }

        if (best && bestDist <= HIT_T) {
          selectionRef.current = best;
          isDraggingRef.current = true;
          return;
        }

        selectionRef.current = null;
        isDraggingRef.current = false;
        return;
      }

      // Check if clicking near an existing draggable shape
      if (tool === 'circle' || tool === 'bodyCircle' || tool === 'rect' || tool === 'triangle') {
        const idx = strokesRef.current.findIndex((s) => {
          if (s.tool !== 'circle' && s.tool !== 'bodyCircle' && s.tool !== 'rect' && s.tool !== 'triangle') return false;
          const el = s as StrokeEllipse;
          const rx = Math.max(el.rx, 1) + CIRCLE_DRAG_THRESHOLD;
          const ry = Math.max(el.ry, 1) + CIRCLE_DRAG_THRESHOLD;
          const dx2 = pos.x - el.cx;
          const dy2 = pos.y - el.cy;
          return (dx2 * dx2) / (rx * rx) + (dy2 * dy2) / (ry * ry) <= 1;
        });

        if (idx >= 0 && circleGapModeRef.current && (tool === 'circle' || tool === 'bodyCircle')) {
          const el = strokesRef.current[idx] as StrokeEllipse;
          const angle = Math.atan2(pos.y - el.cy, pos.x - el.cx);
          const updated = { ...el };
          if (gapCircleIdxRef.current !== idx || el.gapStart === undefined) {
            updated.gapStart = angle;
            updated.gapEnd = undefined;
            gapCircleIdxRef.current = idx;
          } else {
            updated.gapEnd = el.gapStart;
            updated.gapStart = angle;
            gapCircleIdxRef.current = -1;
            pushHistory();
          }
          strokesRef.current = [
            ...strokesRef.current.slice(0, idx),
            updated,
            ...strokesRef.current.slice(idx + 1),
          ];
          return;
        }

        if (idx >= 0) {
          const el = strokesRef.current[idx] as { cx: number; cy: number };
          dragCircleIdxRef.current = idx;
          dragCircleOffRef.current = { x: pos.x - el.cx, y: pos.y - el.cy };
          isDraggingRef.current = true;
          return;
        }
      }

      switch (tool) {
        case 'pen':
          activeStrokeRef.current = { tool: 'pen', pts: [pos], color: opts.color, lw, dashed: opts.dashed ?? false };
          isDraggingRef.current = true;
          break;

        case 'line':
          dragStartRef.current = pos;
          activeStrokeRef.current = { tool: 'line', p1: pos, p2: pos, color: opts.color, lw, dashed: opts.dashed ?? false };
          isDraggingRef.current = true;
          break;

        case 'arrow':
        case 'arrowAngle':
          dragStartRef.current = pos;
          activeStrokeRef.current = { tool, p1: pos, p2: pos, color: opts.color, lw, dashed: opts.dashed ?? false };
          isDraggingRef.current = true;
          break;

        case 'circle':
        case 'bodyCircle':
          dragStartRef.current = pos;
          activeStrokeRef.current = {
            tool: tool as 'circle' | 'bodyCircle',
            cx: pos.x, cy: pos.y, rx: 0, ry: 0,
            color: opts.color, lw,
            dashed: opts.dashed ?? false,
            spinning: circleSpinningRef.current || undefined,
            // Apply a default 90° open gap when gap mode is on
            ...(circleGapModeRef.current
              ? { gapStart: Math.PI * 0.25, gapEnd: Math.PI * 1.75 }
              : {}),
          };
          isDraggingRef.current = true;
          break;

        case 'rect':
          dragStartRef.current = pos;
          activeStrokeRef.current = {
            tool: 'rect',
            cx: pos.x, cy: pos.y, rx: 0, ry: 0,
            color: opts.color, lw,
            dashed: opts.dashed ?? false,
            spinning: circleSpinningRef.current || undefined,
            is3d: rect3dRef.current || undefined,
          };
          isDraggingRef.current = true;
          break;

        case 'triangle':
          dragStartRef.current = pos;
          activeStrokeRef.current = {
            tool: 'triangle',
            cx: pos.x, cy: pos.y, rx: 0, ry: 0,
            color: opts.color, lw,
            dashed: opts.dashed ?? false,
            spinning: circleSpinningRef.current || undefined,
            is3d: triangle3dRef.current || undefined,
          };
          isDraggingRef.current = true;
          break;

        case 'angle':
          if (anglePhaseRef.current === 0) {
            angleVRef.current = pos;
            anglePhaseRef.current = 1;
            liveAngleRef.current = { phase: 1, v: pos, p1: pos, cursor: pos };
          } else if (anglePhaseRef.current === 1) {
            angleP1Ref.current = pos;
            anglePhaseRef.current = 2;
            liveAngleRef.current = { phase: 2, v: angleVRef.current!, p1: pos, cursor: pos };
          } else {
            const v  = angleVRef.current!;
            const p1 = angleP1Ref.current!;
            angleMeasRef.current = [
              ...angleMeasRef.current,
              { v, p1, p2: pos, deg: calcAngleDeg(p1, v, pos) },
            ];
            anglePhaseRef.current = 0;
            angleVRef.current   = null;
            angleP1Ref.current  = null;
            liveAngleRef.current = null;
            pushHistory();
          }
          break;

        case 'swingPath':
          if (!swingDrawingRef.current) {
            swingDrawingRef.current = true;
            swingPtsRef.current = [pos];
          } else {
            swingPtsRef.current = [...swingPtsRef.current, pos];
          }
          if (longPressRef.current) clearTimeout(longPressRef.current);
          longPressRef.current = setTimeout(finishSwingPath, 500);
          break;

        case 'manualSwing': {
          const now = Date.now();
          const last = lastClickPosRef.current;
          const timeSinceLast = now - lastClickTimeRef.current;
          const distSinceLast = last ? Math.hypot(pos.x - last.x, pos.y - last.y) : Infinity;
          const isDoubleClick = timeSinceLast < 400 || distSinceLast < 8;

          if (isDoubleClick && manualSwingActiveRef.current) {
            finishManualSwingPath();
          } else {
            if (!manualSwingActiveRef.current) {
              manualSwingActiveRef.current = true;
              manualSwingPtsRef.current = [pos];
            } else {
              manualSwingPtsRef.current = [...manualSwingPtsRef.current, pos];
            }
          }
          lastClickTimeRef.current = now;
          lastClickPosRef.current = pos;
          break;
        }

        case 'text': {
          if (typeof window === 'undefined') break;
          const text = window.prompt('Enter text:');
          if (text) {
            strokesRef.current = [
              ...strokesRef.current,
              { tool: 'text', pos, text, color: opts.color, fontSize: opts.fontSize },
            ];
            pushHistory();
          }
          break;
        }

        case 'erase':
          eraseAt(pos);
          isDraggingRef.current = true;
          break;

        case 'ballShadow': {
          const video  = videoRef.current;
          const canvas = canvasRef.current;
          if (video && canvas) {
            const vW2 = video.videoWidth  || canvas.width;
            const vH2 = video.videoHeight || canvas.height;
            const sc  = Math.min(canvas.width / vW2, canvas.height / vH2);
            const dw2 = vW2 * sc, dh2 = vH2 * sc;
            const dx2 = (canvas.width  - dw2) / 2;
            const dy2 = (canvas.height - dh2) / 2;
            const nx  = (pos.x - dx2) / dw2;
            const ny  = (pos.y - dy2) / dh2;

            if (ballSampleModeRef.current && nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) {
              const det = ballDetectRef.current;
              if (det) {
                det.ctx.drawImage(video, 0, 0, det.canvas.width, det.canvas.height);
                try {
                  const px = Math.round(nx * det.canvas.width);
                  const py = Math.round(ny * det.canvas.height);
                  const px2 = Math.max(0, Math.min(det.canvas.width - 2, px));
                  const py2 = Math.max(0, Math.min(det.canvas.height - 2, py));
                  const d = det.ctx.getImageData(px2, py2, 3, 3).data;
                  let rSum = 0, gSum = 0, bSum = 0;
                  for (let k = 0; k < d.length; k += 4) { rSum += d[k]; gSum += d[k+1]; bSum += d[k+2]; }
                  const n9 = d.length / 4;
                  const r = rSum/n9, g = gSum/n9, b = bSum/n9;
                  const rn = r/255, gn = g/255, bn = b/255;
                  const max = Math.max(rn,gn,bn), min = Math.min(rn,gn,bn);
                  let h = 0;
                  if (max !== min) {
                    const d2 = max - min;
                    if (max === rn) h = ((gn-bn)/d2 + (gn < bn ? 6 : 0)) * 60;
                    else if (max === gn) h = ((bn-rn)/d2 + 2) * 60;
                    else h = ((rn-gn)/d2 + 4) * 60;
                  }
                  ballColorRef.current = { hMin: Math.max(0, h - 20), hMax: Math.min(360, h + 20) };
                  onProcessingStatus?.(`Ball color sampled: hue ${Math.round(h)}°`);
                } catch {
                  // cross-origin — ignore
                }
              }
            } else if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) {
              const fi = Math.round(video.currentTime * 30);
              cachedBallRef.current = [
                ...cachedBallRef.current.filter(p => p.frameIndex !== fi),
                { frameIndex: fi, timeSeconds: video.currentTime, nx, ny, radius: 10, confidence: 1 },
              ].sort((a, b) => a.frameIndex - b.frameIndex);
            }
          }
          break;
        }

        default:
          break;
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pushHistory, finishSwingPath, finishManualSwingPath, eraseAt, videoRef]);

    // ── Pointer move ───────────────────────────────────────────────────────

    const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      const pos  = getPos(e);
      const tool = activeToolRef.current;

      // ── Pan drag ────────────────────────────────────────────────────────
      if (isPanningRef.current && panStartRef.current) {
        const canvas = canvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const scaleX = canvas.width  / rect.width;
          const scaleY = canvas.height / rect.height;
          panXRef.current = panStartRef.current.px + (e.clientX - panStartRef.current.x) * scaleX;
          panYRef.current = panStartRef.current.py + (e.clientY - panStartRef.current.y) * scaleY;
        }
        return;
      }

      // ── StroMotion rubber-band drag ──────────────────────────────────────
      if (isSelectingStroRegionRef.current && isDraggingRef.current && stroRegionStartRef.current) {
        stroRegionCurrentRef.current = pos;
        return;
      }

      if (isCropSelectingRef.current && isDraggingRef.current) {
        cropSelectCurrentRef.current = pos;
        return;
      }

      // Select dragging
      if (tool === 'select' && isDraggingRef.current && selectionRef.current) {
        const sel = selectionRef.current;
        const dx = pos.x - sel.start.x;
        const dy = pos.y - sel.start.y;
        if (sel.kind === 'stroke') {
          const updated = translateStroke(sel.orig, dx, dy);
          strokesRef.current = [
            ...strokesRef.current.slice(0, sel.idx),
            updated,
            ...strokesRef.current.slice(sel.idx + 1),
          ];
        } else if (sel.kind === 'angle') {
          const m = sel.orig;
          const updated: AngleMeas = {
            ...m,
            v: { x: m.v.x + dx, y: m.v.y + dy },
            p1: { x: m.p1.x + dx, y: m.p1.y + dy },
            p2: { x: m.p2.x + dx, y: m.p2.y + dy },
          };
          angleMeasRef.current = [
            ...angleMeasRef.current.slice(0, sel.idx),
            updated,
            ...angleMeasRef.current.slice(sel.idx + 1),
          ];
        }
        return;
      }

      // Shape dragging
      if (dragCircleIdxRef.current >= 0 && isDraggingRef.current) {
        const idx = dragCircleIdxRef.current;
        const s = strokesRef.current[idx] as { cx: number; cy: number } & Stroke;
        if (s && 'cx' in s) {
          const off = dragCircleOffRef.current;
          const updated = { ...s, cx: pos.x - off.x, cy: pos.y - off.y };
          strokesRef.current = [
            ...strokesRef.current.slice(0, idx),
            updated,
            ...strokesRef.current.slice(idx + 1),
          ];
        }
        return;
      }

      // Angle live preview
      if (tool === 'angle' && liveAngleRef.current) {
        if (anglePhaseRef.current === 1) {
          liveAngleRef.current = { ...liveAngleRef.current, p1: pos };
        } else if (anglePhaseRef.current === 2) {
          liveAngleRef.current = { ...liveAngleRef.current, cursor: pos };
        }
        return;
      }

      if (!isDraggingRef.current) return;
      if (tool === 'erase') { eraseAt(pos); return; }

      const active = activeStrokeRef.current;
      if (!active) return;

      if (active.tool === 'pen') {
        (active as StrokePen).pts = [...(active as StrokePen).pts, pos];
      } else if (active.tool === 'line' || active.tool === 'arrow' || active.tool === 'arrowAngle') {
        (active as StrokeLine).p2 = pos;
      } else if (active.tool === 'circle' || active.tool === 'bodyCircle' || active.tool === 'rect' || active.tool === 'triangle') {
        const start = dragStartRef.current;
        if (!start) return;
        const el = active as StrokeEllipse;
        el.cx = (start.x + pos.x) / 2;
        el.cy = (start.y + pos.y) / 2;
        el.rx = Math.abs(pos.x - start.x) / 2;
        el.ry = Math.abs(pos.y - start.y) / 2;
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [eraseAt]);

    // ── Pointer up ─────────────────────────────────────────────────────────

    const onPointerUp = useCallback((_e: React.PointerEvent<HTMLCanvasElement>) => {
      // ── End pan ────────────────────────────────────────────────────────
      if (isPanningRef.current) {
        isPanningRef.current = false;
        panStartRef.current = null;
        return;
      }

      // ── Finalize Select drag ───────────────────────────────────────────
      if (selectionRef.current) {
        selectionRef.current = null;
        isDraggingRef.current = false;
        pushHistory();
        return;
      }

      // ── Finalize CropSelect ────────────────────────────────────────────────
      if (isCropSelectingRef.current) {
        const p1 = cropSelectStartRef.current;
        const p2 = cropSelectCurrentRef.current;
        if (p1 && p2) {
          const rw = Math.abs(p2.x - p1.x);
          const rh = Math.abs(p2.y - p1.y);
          if (rw > 10 && rh > 10) {
            const canvas = canvasRef.current;
            if (canvas) {
              const W = canvas.width;
              const H = canvas.height;
              const rx = Math.min(p1.x, p2.x);
              const ry = Math.min(p1.y, p2.y);
              cropRegionRef.current = {
                x: Math.max(0, Math.min(1, rx / W)),
                y: Math.max(0, Math.min(1, ry / H)),
                w: Math.max(0, Math.min(1, rw / W)),
                h: Math.max(0, Math.min(1, rh / H)),
              };
            }
          }
        }
        isCropSelectingRef.current = false;
        cropSelectStartRef.current = null;
        cropSelectCurrentRef.current = null;
        isDraggingRef.current = false;
        return;
      }

      // ── Finalize StroMotion region selection ───────────────────────────
      if (isSelectingStroRegionRef.current) {
        const p1 = stroRegionStartRef.current;
        const p2 = stroRegionCurrentRef.current;
        if (p1 && p2) {
          const { dx, dy, dw, dh } = videoBoundsRef.current;
          if (dw > 0 && dh > 0) {
            const x = Math.max(0, Math.min(1, (Math.min(p1.x, p2.x) - dx) / dw));
            const y = Math.max(0, Math.min(1, (Math.min(p1.y, p2.y) - dy) / dh));
            const w = Math.max(0, Math.min(1 - x, Math.abs(p2.x - p1.x) / dw));
            const h = Math.max(0, Math.min(1 - y, Math.abs(p2.y - p1.y) / dh));
            if (w > 0.01 && h > 0.01) {
              stroRegionCallbackRef.current?.({ x, y, w, h });
            }
          }
        }
        isSelectingStroRegionRef.current = false;
        stroRegionCallbackRef.current = null;
        stroRegionStartRef.current = null;
        stroRegionCurrentRef.current = null;
        isDraggingRef.current = false;
        return;
      }

      if (dragCircleIdxRef.current >= 0) {
        dragCircleIdxRef.current = -1;
        isDraggingRef.current = false;
        pushHistory();
        return;
      }
      isDraggingRef.current = false;
      const active = activeStrokeRef.current;
      activeStrokeRef.current = null;
      if (!active) return;
      if (active.tool === 'pen' && (active as StrokePen).pts.length < 2) return;
      // Don't commit zero-size shapes — check rx property via type narrowing
      if (active.tool === 'circle' || active.tool === 'bodyCircle') {
        if ((active as StrokeEllipse).rx < 2) return;
      } else if (active.tool === 'rect') {
        if ((active as StrokeRect).rx < 2) return;
      } else if (active.tool === 'triangle') {
        if ((active as StrokeTriangle).rx < 2) return;
      }
      strokesRef.current = [...strokesRef.current, active];
      pushHistory();
    }, [pushHistory]);

    // Double-click to finish swing path on desktop
    const onDoubleClick = useCallback((_e: React.MouseEvent) => {
      if (activeToolRef.current === 'swingPath' && swingDrawingRef.current) {
        finishSwingPath();
      }
      if (activeToolRef.current === 'manualSwing' && manualSwingActiveRef.current) {
        finishManualSwingPath();
      }
      if (activeToolRef.current === 'zoom') {
        zoomRef.current = 1.0;
        panXRef.current = 0;
        panYRef.current = 0;
      }
    }, [finishSwingPath, finishManualSwingPath]);

    const cursorFor: Partial<Record<ToolType, string>> = {
      pen: 'crosshair', erase: 'cell', text: 'text', line: 'crosshair',
      angle: 'crosshair', swingPath: 'crosshair', manualSwing: 'crosshair', ballShadow: 'crosshair',
      cropSelect: 'crosshair',
      zoom: isPanningRef.current
        ? 'grabbing'
        : spaceHeldRef.current
          ? 'grab'
          : zoomRef.current > 1.0 ? 'zoom-out' : 'zoom-in',
    };

    return (
      <canvas
        ref={canvasRef}
        width={containerWidth}
        height={containerHeight}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'block',
          touchAction: 'none',
          cursor: cursorFor[activeTool] ?? 'default',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onDoubleClick={onDoubleClick}
      />
    );
  },
);

export default CanvasOverlay;
