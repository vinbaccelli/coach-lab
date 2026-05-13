'use client';

import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { ToolType, DrawingOptions } from '@/lib/drawingTools';
import { calcAngleDeg } from '@/lib/drawingTools';
import type { CachedPoseFrame } from '@/lib/poseDetection';
import type { BallPosition } from '@/lib/ballDetection';
import type { BallTrailMode, WebcamPipMode } from '@/components/ToolPalette';
import type { SwingSegment } from '@/lib/swingDetection';
import { detectSwingSegments } from '@/lib/swingDetection';
import type { RacketTrail } from '@/lib/racketMultiplier';
import type { VideoController } from '@/lib/videoController';
import {
  bufferSmoothKeypoints,
  loadYoutubeThumbnailImage,
  smoothPoseKeypoints,
  type PoseKeypoint,
} from '@/lib/youtubeThumbnailPose';
import { WebcamSegmenter } from '@/lib/webcamSegmentation';
import { PoseWorkerBridge } from '@/lib/poseWorkerBridge';
import { Hand } from 'lucide-react';

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
/** Vertical offset (screen px) from finger to precision crosshair — tuned for one-handed phones */
const PRECISION_CURSOR_OFFSET_Y = 38;
/** Synthetic pointer id for injected precision clicks */
const PRECISION_SYNTHETIC_POINTER_ID = 91001;
/** Fade-out duration when anchor finger lifts (ms) */
const PRECISION_CURSOR_FADE_MS = 220;
/** Ripple duration at synthetic click (ms) */
const PRECISION_RIPPLE_MS = 420;

// ── Types ──────────────────────────────────────────────────────────────────

type Pt = { x: number; y: number };

interface StrokePen     { tool: 'pen';                              pts: Pt[]; color: string; lw: number; dashed?: boolean }
interface StrokeLine    { tool: 'line';                             p1: Pt; p2: Pt; color: string; lw: number; dashed?: boolean }
interface StrokeArrow   { tool: 'arrow' | 'arrowAngle';             p1: Pt; p2: Pt; color: string; lw: number; dashed?: boolean }
type EraserDot = { x: number; y: number; radius: number };
interface StrokeEllipse {
  tool: 'circle' | 'bodyCircle';
  cx: number; cy: number; rx: number; ry: number;
  color: string; lw: number; dashed?: boolean;
  spinning?: boolean;
  spinSpeed?: number;
  eraserStrokes?: EraserDot[];
}
interface StrokeRect {
  tool: 'rect';
  cx: number; cy: number; rx: number; ry: number;
  color: string; lw: number; dashed?: boolean;
  spinning?: boolean;
  is3d?: boolean;
  eraserStrokes?: EraserDot[];
}
interface StrokeTriangle {
  tool: 'triangle';
  cx: number; cy: number; rx: number; ry: number;
  color: string; lw: number; dashed?: boolean;
  spinning?: boolean;
  is3d?: boolean;
  eraserStrokes?: EraserDot[];
}
interface StrokeSwing   { tool: 'swingPath' | 'manualSwing';        pts: Pt[]; color: string; lw: number; dashed?: boolean; arrowAtEnd?: boolean }
interface StrokeText    { tool: 'text';                             pos: Pt; text: string; color: string; fontSize: number }

type Stroke = StrokePen | StrokeLine | StrokeArrow | StrokeEllipse | StrokeRect | StrokeTriangle | StrokeSwing | StrokeText;

interface AngleMeas { v: Pt; p1: Pt; p2: Pt; deg: number }
interface LiveAngle { phase: 1 | 2; v: Pt; p1: Pt; cursor: Pt }

type Selection =
  | { kind: 'stroke'; idx: number; start: Pt; orig: Stroke }
  | { kind: 'angle'; idx: number; start: Pt; orig: AngleMeas }
  | { kind: 'textResize'; idx: number; start: Pt; orig: StrokeText; corner: 'tl' | 'tr' | 'bl' | 'br' }
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
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoomPan: () => void;
  startObjMultiplierRegionSelect: () => void;
  getObjMultiplierRegion: () => { x: number; y: number; w: number; h: number } | null;
  runObjMultiplierCapture: (frameCount: number, duration: number, onProgress?: (done: number, total: number) => void) => Promise<number>;
  clearObjMultiplier: () => void;
  getObjMultiplierFrameCount: () => number;
}

// ── Props ──────────────────────────────────────────────────────────────────

export interface CanvasProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  webcamVideoRef?: React.RefObject<HTMLVideoElement | null>;
  /** When false, Canvas does NOT draw the video frame (overlay-only). */
  renderVideo?: boolean;
  activeTool: ToolType;
  drawingOptions: DrawingOptions;
  containerWidth: number;
  containerHeight: number;
  ballTrailMode?: BallTrailMode;
  skeletonEnabled?: boolean;
  ballTrailEnabled?: boolean;
  /** When false, skeleton pose may still run but overlay is not drawn. */
  skeletonDrawEnabled?: boolean;
  onProcessingStatus?: (msg: string | null) => void;
  isRecording?: boolean;
  circleSpinning?: boolean;
  outlineEraserSize?: number;
  webcamPipMode?: WebcamPipMode;
  webcamOpacity?: number;
  stroMotionGhosts?: ImageBitmap[];
  stroMotionOpacity?: number;
  /** Region (video-normalized 0..1) to display stro-motion ghosts in */
  stroMotionRegion?: { x: number; y: number; w: number; h: number };
  skeletonShowAngles?: boolean;
  skeletonShowHeadLine?: boolean;
  skeletonClassicColors?: boolean;
  skeletonParts?: SkeletonPartVisibility;
  ballSampleMode?: boolean;
  rect3d?: boolean;
  triangle3d?: boolean;
  /** When videoRef has no playable video (e.g. YouTube embed), keep canvas transparent */
  transparentWhenNoVideo?: boolean;
  /**
   * YouTube iframe mode: pose uses CDN thumbnail + playback timing (iframe pixels are not readable).
   */
  youtubePose?: {
    videoId: string;
    controllerRef: React.MutableRefObject<VideoController | null>;
  };
  /**
   * When tab-capture is recording a MediaStream into videoRef, drawing that stream on canvas
   * creates an infinite on-screen mirror. Skip painting the stream while still running pose on it.
   */
  suppressTabCaptureMirror?: boolean;
  /** Selfie segmentation mask for webcam PiP — coach-only cutout over the canvas */
  webcamCutout?: boolean;
  /** When true, webcam PiP is drawn whenever the stream is ready (not only while screen-recording). */
  webcamActive?: boolean;
  /**
   * Mobile/tablet: use crosshair offset from finger and second-finger tap to inject clicks at crosshair.
   * Ignored for mouse/pen; zoom tool bypasses precision routing.
   */
  precisionTouchDraw?: boolean;
  poseFrameSkip?: number;
  /** When true, one-finger touch / click-drag pans the canvas instead of drawing */
  panModeEnabled?: boolean;
  /** Callback to toggle pan mode from the on-canvas UI */
  onPanModeToggle?: () => void;
  /** Fires when a region is selected in objectMultiplier mode */
  onObjMultiplierRegionSelected?: () => void;
}

const WEBCAM_PIP_ASPECT = 11 / 9;
const WEBCAM_PIP_HANDLE = 16;

function clampWebcamPip(
  p: { x: number; y: number; w: number; h: number },
  cw: number,
  ch: number,
): { x: number; y: number; w: number; h: number } {
  const minW = 72;
  const maxW = Math.min(cw, ch) * 0.58;
  let { x, y, w, h } = p;
  w = Math.max(minW, Math.min(maxW, w));
  h = Math.round(w / WEBCAM_PIP_ASPECT);
  if (h > ch * 0.58) {
    h = Math.round(ch * 0.58);
    w = Math.round(h * WEBCAM_PIP_ASPECT);
  }
  x = Math.max(0, Math.min(cw - w, x));
  y = Math.max(0, Math.min(ch - h, y));
  return { x, y, w, h };
}

function defaultWebcamPipRect(cw: number, ch: number) {
  const margin = 12;
  const w = Math.round(cw * 0.18);
  const h = Math.round(w / WEBCAM_PIP_ASPECT);
  return clampWebcamPip({ x: cw - w - margin, y: ch - h - margin, w, h }, cw, ch);
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

/** Body-part visibility flags */
export type SkeletonPartVisibility = {
  rightArm?: boolean;
  leftArm?: boolean;
  rightLeg?: boolean;
  leftLeg?: boolean;
};

const RIGHT_ARM_JOINTS = new Set([6, 8, 10]);
const LEFT_ARM_JOINTS  = new Set([5, 7, 9]);
const RIGHT_LEG_JOINTS = new Set([12, 14, 16]);
const LEFT_LEG_JOINTS  = new Set([11, 13, 15]);

function isJointVisible(idx: number, parts: SkeletonPartVisibility, jointName?: string): boolean {
  const n = (jointName ?? '').toLowerCase();
  if (n) {
    if (/right_(shoulder|elbow|wrist)/.test(n) && parts.rightArm === false) return false;
    if (/left_(shoulder|elbow|wrist)/.test(n) && parts.leftArm === false) return false;
    if (/right_(hip|knee|ankle)/.test(n) && parts.rightLeg === false) return false;
    if (/left_(hip|knee|ankle)/.test(n) && parts.leftLeg === false) return false;
  }
  if (RIGHT_ARM_JOINTS.has(idx) && parts.rightArm === false) return false;
  if (LEFT_ARM_JOINTS.has(idx) && parts.leftArm === false) return false;
  if (RIGHT_LEG_JOINTS.has(idx) && parts.rightLeg === false) return false;
  if (LEFT_LEG_JOINTS.has(idx) && parts.leftLeg === false) return false;
  return true;
}

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
    parts?: SkeletonPartVisibility;
  },
): void {
  const sx = canvasW / nativeW;
  const sy = canvasH / nativeH;

  const showAngles    = opts?.showAngles   !== false;
  const showHeadLine  = opts?.showHeadLine === true;
  const classicColors = opts?.classicColors !== false;
  const showFootLine  = opts?.showFootLine !== false;
  const parts: SkeletonPartVisibility = opts?.parts ?? {};
  const jointRadius = Math.max(2, Math.min(7, Math.round(Math.min(canvasW, canvasH) / 180)));

  // Limb bones: solid yellow lines (arms + legs)
  const LIMB_BONES: [number, number][] = [
    [5, 7], [7, 9],   // left arm
    [6, 8], [8, 10],  // right arm
    [11, 13], [13, 15], // left leg
    [12, 14], [14, 16], // right leg
  ];
  // Structural bones: shoulders + hips (solid yellow, same as limbs)
  const STRUCT_BONES: [number, number][] = [
    [5, 6],   // shoulders
    [11, 12], // hips
  ];

  ctx.save();
  ctx.lineCap = 'round';

  // Draw limb + structural bones in solid yellow (or blue monochrome in alternative mode)
  ctx.strokeStyle = classicColors ? '#FFD700' : '#35679A';
  ctx.lineWidth = classicColors ? 2 : 1.5;

  for (const [a, b] of [...LIMB_BONES, ...STRUCT_BONES]) {
    if (!isJointVisible(a, parts, keypoints[a]?.name) || !isJointVisible(b, parts, keypoints[b]?.name)) continue;
    const ka = keypoints[a];
    const kb = keypoints[b];
    if (!ka || !kb || ka.score < 0.3 || kb.score < 0.3) continue;
    ctx.beginPath();
    ctx.moveTo(ka.x * sx, ka.y * sy);
    ctx.lineTo(kb.x * sx, kb.y * sy);
    ctx.stroke();
  }

  // Central spine: dotted green line from midpoint of shoulders to midpoint of hips
  const lShoulder = keypoints[5], rShoulder = keypoints[6];
  const lHip = keypoints[11], rHip = keypoints[12];
  if (
    lShoulder && rShoulder && lHip && rHip &&
    lShoulder.score >= 0.3 && rShoulder.score >= 0.3 &&
    lHip.score >= 0.3 && rHip.score >= 0.3
  ) {
    const midShoulderX = ((lShoulder.x + rShoulder.x) / 2) * sx;
    const midShoulderY = ((lShoulder.y + rShoulder.y) / 2) * sy;
    const midHipX = ((lHip.x + rHip.x) / 2) * sx;
    const midHipY = ((lHip.y + rHip.y) / 2) * sy;
    ctx.save();
    ctx.strokeStyle = classicColors ? '#39FF14' : '#35679A';
    ctx.lineWidth = classicColors ? 2 : 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(midShoulderX, midShoulderY);
    ctx.lineTo(midHipX, midHipY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Head line (off by default — checkbox in skeleton panel)
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
      ctx.lineWidth = 1.5;
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
      if (!isJointVisible(kneeIdx, parts, keypoints[kneeIdx]?.name) || !isJointVisible(ankleIdx, parts, keypoints[ankleIdx]?.name)) continue;
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
      ctx.strokeStyle = classicColors ? '#FFD700' : '#35679A';
      ctx.lineWidth = classicColors ? 2 : 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + dx2 * ext, ay + dy2 * ext);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  // Joint dots — skip head keypoints (0-4), respect body-part visibility
  for (let i = 5; i < keypoints.length; i++) {
    if (!isJointVisible(i, parts, keypoints[i]?.name)) continue;
    const kp = keypoints[i];
    if (!kp || kp.score < 0.3) continue;
    ctx.beginPath();
    ctx.arc(kp.x * sx, kp.y * sy, jointRadius, 0, Math.PI * 2);
    if (classicColors) {
      ctx.fillStyle = i % 2 === 0 ? '#FF4444' : '#4488FF';
    } else {
      ctx.fillStyle = '#F8F8F8';
    }
    ctx.fill();
    ctx.strokeStyle = classicColors ? (i % 2 === 0 ? '#FF4444' : '#4488FF') : '#35679A';
    ctx.lineWidth = 1.5;
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
      if (!isJointVisible(vi, parts, keypoints[vi]?.name) || !isJointVisible(ai, parts, keypoints[ai]?.name) || !isJointVisible(bi, parts, keypoints[bi]?.name)) continue;
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
  arrowAtEnd = false,
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

  if (arrowAtEnd && points.length >= 2) {
    const p1 = points[points.length - 2];
    const p2 = points[points.length - 1];
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const headLen = Math.max(12, width * 3);
    ctx.setLineDash([]);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(p2.x, p2.y);
    ctx.lineTo(p2.x - headLen * Math.cos(angle - Math.PI / 7), p2.y - headLen * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(p2.x - headLen * Math.cos(angle + Math.PI / 7), p2.y - headLen * Math.sin(angle + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

/** Returns true if point (px,py) falls within any eraser dot */
function isErasedAt(px: number, py: number, eraserStrokes: EraserDot[]): boolean {
  for (const d of eraserStrokes) {
    const dx = px - d.x;
    const dy = py - d.y;
    if (dx * dx + dy * dy <= d.radius * d.radius) return true;
  }
  return false;
}

function drawCircleStroke(
  ctx: CanvasRenderingContext2D,
  s: StrokeEllipse,
  _animFrame: number,
): void {
  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.lw;
  if (s.spinning) {
    ctx.setLineDash([2, 8]);
    ctx.lineDashOffset = -((Date.now() / 20) % 1000);
  } else if (s.dashed) {
    ctx.setLineDash([8, 6]);
  }

  const rx = Math.max(1, s.rx);
  const ry = Math.max(1, s.ry);
  const eraser = s.eraserStrokes;

  if (eraser && eraser.length > 0) {
    const steps = Math.max(120, Math.ceil(Math.PI * (rx + ry)));
    let inStroke = false;
    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      const px = s.cx + rx * Math.cos(angle);
      const py = s.cy + ry * Math.sin(angle);
      if (isErasedAt(px, py, eraser)) {
        if (inStroke) { ctx.stroke(); inStroke = false; }
      } else {
        if (!inStroke) { ctx.beginPath(); ctx.moveTo(px, py); inStroke = true; }
        else ctx.lineTo(px, py);
      }
    }
    if (inStroke) ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.ellipse(s.cx, s.cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

function rectOutlineArcLen(rx: number, ry: number): number {
  return 4 * rx + 4 * ry;
}

/** Arc length u from top-left corner, clockwise */
function rectPointAtArcU(cx: number, cy: number, rx: number, ry: number, u: number): Pt {
  const P = rectOutlineArcLen(rx, ry);
  let uu = ((u % P) + P) % P;
  const top = 2 * rx;
  const right = 2 * ry;
  const bottom = 2 * rx;
  if (uu <= top) return { x: cx - rx + uu, y: cy - ry };
  uu -= top;
  if (uu <= right) return { x: cx + rx, y: cy - ry + uu };
  uu -= right;
  if (uu <= bottom) return { x: cx + rx - uu, y: cy + ry };
  uu -= bottom;
  return { x: cx - rx, y: cy + ry - uu };
}


function triEdgeLens(rx: number, ry: number): { e0: number; e1: number; e2: number; P: number } {
  const rxr = Math.max(1e-6, rx);
  const ryr = Math.max(1e-6, ry);
  const e0 = Math.hypot(rxr, 2 * ryr);
  const e1 = 2 * rxr;
  const e2 = Math.hypot(rxr, 2 * ryr);
  return { e0, e1, e2, P: e0 + e1 + e2 };
}

function triPointAtArcU(cx: number, cy: number, rx: number, ry: number, u: number): Pt {
  const rxr = Math.max(1e-6, rx);
  const ryr = Math.max(1e-6, ry);
  const { e0, e1, e2, P } = triEdgeLens(rxr, ryr);
  const v0 = { x: cx, y: cy - ryr };
  const v1 = { x: cx + rxr, y: cy + ryr };
  const v2 = { x: cx - rxr, y: cy + ryr };
  let uu = ((u % P) + P) % P;
  if (uu <= e0) {
    const t = uu / e0;
    return { x: v0.x + t * (v1.x - v0.x), y: v0.y + t * (v1.y - v0.y) };
  }
  uu -= e0;
  if (uu <= e1) {
    const t = uu / e1;
    return { x: v1.x + t * (v2.x - v1.x), y: v1.y + t * (v2.y - v1.y) };
  }
  uu -= e1;
  const t = uu / e2;
  return { x: v2.x + t * (v0.x - v2.x), y: v2.y + t * (v0.y - v2.y) };
}



function drawRectStroke(
  ctx: CanvasRenderingContext2D,
  s: StrokeRect,
  _animFrame: number,
): void {
  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.lw;
  if (s.spinning) {
    ctx.setLineDash([2, 10]);
    ctx.lineDashOffset = -((Date.now() / 18) % 1000);
  } else if (s.dashed) {
    ctx.setLineDash([8, 6]);
  }

  const drawRectAt = (cx: number, cy: number) => {
    ctx.strokeRect(cx - s.rx, cy - s.ry, s.rx * 2, s.ry * 2);
  };

  const eraser = s.eraserStrokes;
  if (eraser && eraser.length > 0) {
    const P = rectOutlineArcLen(Math.max(1, s.rx), Math.max(1, s.ry));
    const steps = Math.max(80, Math.ceil(P / 2));
    let inStroke = false;
    for (let i = 0; i <= steps; i++) {
      const u = (i / steps) * P;
      const pt = rectPointAtArcU(s.cx, s.cy, Math.max(1, s.rx), Math.max(1, s.ry), u);
      if (isErasedAt(pt.x, pt.y, eraser)) {
        if (inStroke) { ctx.stroke(); inStroke = false; }
      } else {
        if (!inStroke) { ctx.beginPath(); ctx.moveTo(pt.x, pt.y); inStroke = true; }
        else ctx.lineTo(pt.x, pt.y);
      }
    }
    if (inStroke) ctx.stroke();
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
  if (s.spinning) {
    ctx.setLineDash([2, 10]);
    ctx.lineDashOffset = -((Date.now() / 18) % 1000);
  } else if (s.dashed) {
    ctx.setLineDash([8, 6]);
  }

  ctx.translate(s.cx, s.cy);
  const drawTri = (ox: number, oy: number) => {
    ctx.beginPath();
    ctx.moveTo(ox, oy - s.ry);
    ctx.lineTo(ox + s.rx, oy + s.ry);
    ctx.lineTo(ox - s.rx, oy + s.ry);
    ctx.closePath();
    ctx.stroke();
  };

  const eraser = s.eraserStrokes;
  if (eraser && eraser.length > 0) {
    const { P } = triEdgeLens(Math.max(1, s.rx), Math.max(1, s.ry));
    const steps = Math.max(80, Math.ceil(P / 2));
    let inStroke = false;
    for (let i = 0; i <= steps; i++) {
      const u = (i / steps) * P;
      const pt = triPointAtArcU(0, 0, Math.max(1, s.rx), Math.max(1, s.ry), u);
      const worldX = s.cx + pt.x;
      const worldY = s.cy + pt.y;
      if (isErasedAt(worldX, worldY, eraser)) {
        if (inStroke) { ctx.stroke(); inStroke = false; }
      } else {
        if (!inStroke) { ctx.beginPath(); ctx.moveTo(pt.x, pt.y); inStroke = true; }
        else ctx.lineTo(pt.x, pt.y);
      }
    }
    if (inStroke) ctx.stroke();
  } else {
    drawTri(0, 0);
  }

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
    drawSmoothPath(ctx, s.pts, s.color, s.lw, 1, s.dashed ?? false, s.arrowAtEnd === true);
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
      renderVideo = true,
      activeTool,
      drawingOptions,
      containerWidth,
      containerHeight,
      ballTrailMode = 'comet',
      skeletonEnabled = false,
      skeletonDrawEnabled = true,
      ballTrailEnabled = false,
      onProcessingStatus,
      isRecording = false,
      circleSpinning = false,
      outlineEraserSize = 0,
      webcamPipMode = 'rectangle',
      webcamOpacity = 1,
      stroMotionGhosts,
      stroMotionOpacity = 0.3,
      stroMotionRegion,
      skeletonShowAngles = true,
      skeletonShowHeadLine = false,
      skeletonClassicColors = true,
      skeletonParts,
      ballSampleMode = false,
      rect3d = false,
      triangle3d = false,
      transparentWhenNoVideo = false,
      youtubePose,
      suppressTabCaptureMirror = false,
      webcamCutout = false,
      webcamActive = false,
      precisionTouchDraw = false,
      poseFrameSkip = 0,
      panModeEnabled = false,
      onPanModeToggle,
      onObjMultiplierRegionSelected,
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

    // Precision touch drawing (mobile): anchor finger moves crosshair; second finger injects events at crosshair
    const precisionTouchDrawRef = useRef(false);
    useEffect(() => {
      precisionTouchDrawRef.current = precisionTouchDraw;
      if (!precisionTouchDraw) {
        precisionAnchorPointerIdRef.current = null;
        precisionCrosshairTargetRef.current = null;
        precisionCrosshairDisplayRef.current = null;
        precisionFadeStartRef.current = null;
        precisionRippleRef.current = null;
      }
    }, [precisionTouchDraw]);
    const precisionAnchorPointerIdRef = useRef<number | null>(null);
    const precisionCrosshairTargetRef = useRef<Pt | null>(null);
    const precisionCrosshairDisplayRef = useRef<Pt | null>(null);
    const precisionFadeStartRef = useRef<number | null>(null);
    const precisionRippleRef = useRef<{ x: number; y: number; t0: number } | null>(null);

    // Dragging circle
    const dragCircleIdxRef = useRef<number>(-1);
    const dragCircleOffRef = useRef<Pt>({ x: 0, y: 0 });
    const selectionRef     = useRef<Selection>(null);

    // Text editing state
    const textEditingIdxRef = useRef<number>(-1);
    const textEditInputRef  = useRef<HTMLTextAreaElement | null>(null);
    const [textEditing, setTextEditing] = useState<{
      idx: number; left: number; top: number; width: number; fontSize: number; value: string; color: string;
    } | null>(null);
    /** CSS-pixel selection rect on the object-multiplier overlay (relative to overlay box). */
    const [objMultOverlayPx, setObjMultOverlayPx] = useState<{ l: number; t: number; w: number; h: number } | null>(null);
    const objMultOverlayDownRef = useRef<{ cx: number; cy: number } | null>(null);
    const [showFinePointerPanBtn, setShowFinePointerPanBtn] = useState(true);
    const lastTextTapRef = useRef<{ idx: number; t: number; x: number; y: number } | null>(null);

    // Outline eraser: tracks which shape is being erased and the cursor position
    const outlineErasingIdxRef = useRef<number>(-1);
    const outlineEraserPosRef  = useRef<Pt | null>(null);

    // Racket multiplier trail
    const racketTrailRef   = useRef<RacketTrail | null>(null);

    // Real-time skeleton detection
    const detectorRef         = useRef<any>(null);
    const latestKeypointsRef  = useRef<Array<{ x: number; y: number; score: number; name: string }> | null>(null);
    const poseLoopActiveRef   = useRef(false);
    const skeletonFramesRef   = useRef<Array<{ timeSeconds: number; keypoints: Array<{ x: number; y: number; score: number; name: string }> }>>([]);
    // When true, skeleton overlay + detection is temporarily suppressed (e.g. after Clear All / Undo).
    const skeletonSuppressedRef = useRef(false);
    const poseBridgeRef = useRef<PoseWorkerBridge | null>(null);
    const renderDirtyRef = useRef(true);
    const lastRenderVideoTimeRef = useRef(-1);
    const lastRenderZoomRef = useRef(1);
    const lastRenderPanRef = useRef({ x: 0, y: 0 });

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
    const skeletonDrawEnabledRef = useRef(skeletonDrawEnabled);
    const ballTrailEnabledRef = useRef(ballTrailEnabled);
    const ballTrailModeRef    = useRef(ballTrailMode);
    const isRecordingRef      = useRef(isRecording);
    const circleSpinningRef   = useRef(circleSpinning);
    const outlineEraserSizeRef = useRef(outlineEraserSize);
    const webcamPipModeRef    = useRef(webcamPipMode);
    const webcamOpacityRef    = useRef(webcamOpacity);
    const stroMotionGhostsRef = useRef<ImageBitmap[]>(stroMotionGhosts ?? []);
    const stroMotionOpacityRef = useRef(stroMotionOpacity);
    const stroMotionRegionRef = useRef(stroMotionRegion);
    const skeletonShowAnglesRef   = useRef(skeletonShowAngles);
    const skeletonShowHeadLineRef = useRef(skeletonShowHeadLine);
    const skeletonClassicColorsRef = useRef(skeletonClassicColors);
    const skeletonPartsRef = useRef(skeletonParts);
    const ballSampleModeRef = useRef(ballSampleMode);
    const rect3dRef = useRef(rect3d);
    const triangle3dRef = useRef(triangle3d);
    const transparentWhenNoVideoRef = useRef(transparentWhenNoVideo);
    const renderVideoRef = useRef(renderVideo);
    const youtubePoseRef = useRef(youtubePose);
    const youtubePoseDimsRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
    const youtubeSmoothBufRef = useRef<PoseKeypoint[][]>([]);
    const youtubePoseCacheRef = useRef<Map<number, PoseKeypoint[]>>(new Map());

    const suppressTabCaptureMirrorRef = useRef(false);
    const poseSmoothPrevRef = useRef<Array<{ x: number; y: number; score: number; name: string }> | null>(null);
    const poseScheduleRef = useRef<{ kind: 'rvfc' | 'raf'; id: number } | null>(null);
    const poseFrameSkipRef = useRef(poseFrameSkip);
    useEffect(() => { poseFrameSkipRef.current = poseFrameSkip; }, [poseFrameSkip]);

    useEffect(() => {
      if (typeof window === 'undefined' || !window.matchMedia) return;
      const mq = window.matchMedia('(pointer: fine)');
      const fn = () => setShowFinePointerPanBtn(!!mq.matches);
      fn();
      mq.addEventListener?.('change', fn);
      return () => mq.removeEventListener?.('change', fn);
    }, []);

    useEffect(() => {
      if (activeTool !== 'objectMultiplier') {
        setObjMultOverlayPx(null);
        objMultOverlayDownRef.current = null;
      }
    }, [activeTool]);

    const webcamCutoutRef = useRef(false);
    const webcamSegmenterRef = useRef<{ dispose: () => void } | null>(null);
    const webcamMaskRef = useRef<HTMLCanvasElement | null>(null);
    const webcamActiveRef = useRef(webcamActive);
    const panModeEnabledRef = useRef(panModeEnabled);
    /** Pixel rect on the backing canvas; (0,0,0,0) means “use default lower-right” */
    const webcamPipRectRef = useRef({ x: 0, y: 0, w: 0, h: 0 });
    type WebcamPipDrag =
      | { kind: 'move'; sx: number; sy: number; orig: { x: number; y: number; w: number; h: number } }
      | {
          kind: 'resize-br' | 'resize-bl' | 'resize-tr' | 'resize-tl';
          sx: number;
          sy: number;
          orig: { x: number; y: number; w: number; h: number };
        };
    const webcamPipDragRef = useRef<WebcamPipDrag | null>(null);
    const webcamPinchRef = useRef<{ dist: number; w: number; cx: number; cy: number } | null>(null);
    const lastPipContainerRef = useRef<{ w: number; h: number } | null>(null);

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

    // Object Multiplier rubber-band region selection
    const isSelectingObjMultRegionRef = useRef(false);
    const objMultRegionStartRef       = useRef<Pt | null>(null);
    const objMultRegionCurrentRef     = useRef<Pt | null>(null);
    const objMultRegionRef            = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
    const objMultiplierRef            = useRef<import('@/lib/objectMultiplier').ObjectMultiplier | null>(null);
    const onObjMultRegionSelectedRef  = useRef(onObjMultiplierRegionSelected);

    const cropRegionRef         = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

    // Manual swing state
    const manualSwingPtsRef     = useRef<Pt[]>([]);
    const manualSwingActiveRef  = useRef(false);
    const lastClickTimeRef      = useRef(0);
    const lastClickPosRef       = useRef<Pt | null>(null);

    useEffect(() => { drawingOptsRef.current      = drawingOptions; },  [drawingOptions]);
    useEffect(() => { activeToolRef.current        = activeTool; },      [activeTool]);
    useEffect(() => { skeletonEnabledRef.current   = skeletonEnabled; }, [skeletonEnabled]);
    useEffect(() => { skeletonDrawEnabledRef.current = skeletonDrawEnabled; }, [skeletonDrawEnabled]);
    useEffect(() => { ballTrailEnabledRef.current  = ballTrailEnabled; }, [ballTrailEnabled]);
    useEffect(() => { ballTrailModeRef.current     = ballTrailMode; },   [ballTrailMode]);
    useEffect(() => { isRecordingRef.current       = isRecording; },     [isRecording]);
    useEffect(() => { circleSpinningRef.current    = circleSpinning; },  [circleSpinning]);
    useEffect(() => { outlineEraserSizeRef.current  = outlineEraserSize; }, [outlineEraserSize]);
    useEffect(() => { webcamPipModeRef.current     = webcamPipMode; },   [webcamPipMode]);
    useEffect(() => { webcamOpacityRef.current     = webcamOpacity; },   [webcamOpacity]);
    useEffect(() => { stroMotionGhostsRef.current  = stroMotionGhosts ?? []; }, [stroMotionGhosts]);
    useEffect(() => { stroMotionOpacityRef.current = stroMotionOpacity; },      [stroMotionOpacity]);
    useEffect(() => { stroMotionRegionRef.current  = stroMotionRegion; },        [stroMotionRegion]);
    useEffect(() => { skeletonShowAnglesRef.current   = skeletonShowAngles; },   [skeletonShowAngles]);
    useEffect(() => { skeletonShowHeadLineRef.current  = skeletonShowHeadLine; },  [skeletonShowHeadLine]);
    useEffect(() => { skeletonClassicColorsRef.current = skeletonClassicColors; }, [skeletonClassicColors]);
    useEffect(() => { skeletonPartsRef.current = skeletonParts; }, [skeletonParts]);
    useEffect(() => { ballSampleModeRef.current = ballSampleMode; }, [ballSampleMode]);
    useEffect(() => { rect3dRef.current = rect3d; }, [rect3d]);
    useEffect(() => { triangle3dRef.current = triangle3d; }, [triangle3d]);
    useEffect(() => { transparentWhenNoVideoRef.current = transparentWhenNoVideo; }, [transparentWhenNoVideo]);
    useEffect(() => { renderVideoRef.current = renderVideo; }, [renderVideo]);
    useEffect(() => { youtubePoseRef.current = youtubePose; }, [youtubePose]);
    useEffect(() => { suppressTabCaptureMirrorRef.current = suppressTabCaptureMirror; }, [suppressTabCaptureMirror]);
    useEffect(() => { webcamCutoutRef.current = webcamCutout; }, [webcamCutout]);
    useEffect(() => { webcamActiveRef.current = webcamActive; }, [webcamActive]);
    useEffect(() => { panModeEnabledRef.current = panModeEnabled; }, [panModeEnabled]);
    useEffect(() => { onObjMultRegionSelectedRef.current = onObjMultiplierRegionSelected; }, [onObjMultiplierRegionSelected]);

    useEffect(() => {
      if (!webcamActive) {
        webcamPipRectRef.current = { x: 0, y: 0, w: 0, h: 0 };
        webcamPipDragRef.current = null;
      }
    }, [webcamActive]);

    /** Scale PiP when analysis panel resizes so it stays proportionally placed */
    useEffect(() => {
      const prev = lastPipContainerRef.current;
      const pip = webcamPipRectRef.current;
      if (prev && pip.w > 0 && pip.h > 0 && prev.w > 0 && prev.h > 0) {
        const sx = containerWidth / prev.w;
        const sy = containerHeight / prev.h;
        webcamPipRectRef.current = clampWebcamPip(
          {
            x: pip.x * sx,
            y: pip.y * sy,
            w: pip.w * sx,
            h: pip.h * sy,
          },
          containerWidth,
          containerHeight,
        );
      }
      lastPipContainerRef.current = { w: containerWidth, h: containerHeight };
    }, [containerWidth, containerHeight]);

    // ── Touch pinch: webcam PiP resize when pinch centroid is over PiP; else canvas zoom ───
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      let lastDist = 0;
      let pinchWebcam = false;
      let baseDist = 0;
      let baseW = 0;
      let cx0 = 0;
      let cy0 = 0;

      const onTouchStart = (e: TouchEvent) => {
        if (
          precisionTouchDrawRef.current &&
          precisionAnchorPointerIdRef.current !== null &&
          e.touches.length >= 2
        ) {
          e.preventDefault();
          return;
        }
        if (e.touches.length === 2) {
          const t1 = e.touches[0], t2 = e.touches[1];
          const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
          lastDist = dist;
          const rect = canvas.getBoundingClientRect();
          const mx = ((t1.clientX + t2.clientX) / 2 - rect.left) * (canvas.width / rect.width);
          const my = ((t1.clientY + t2.clientY) / 2 - rect.top) * (canvas.height / rect.height);
          pinchWebcam = false;
          baseDist = 0;
          if (webcamActiveRef.current) {
            let pip = webcamPipRectRef.current;
            if (!pip.w || !pip.h) pip = defaultWebcamPipRect(canvas.width, canvas.height);
            pip = clampWebcamPip(pip, canvas.width, canvas.height);
            webcamPipRectRef.current = pip;
            pinchWebcam =
              mx >= pip.x && mx <= pip.x + pip.w && my >= pip.y && my <= pip.y + pip.h;
            if (pinchWebcam) {
              baseDist = dist;
              baseW = pip.w;
              cx0 = pip.x + pip.w / 2;
              cy0 = pip.y + pip.h / 2;
            }
          }
          e.preventDefault();
        }
      };
      const onTouchMove = (e: TouchEvent) => {
        if (
          precisionTouchDrawRef.current &&
          precisionAnchorPointerIdRef.current !== null &&
          e.touches.length >= 2
        ) {
          e.preventDefault();
          return;
        }
        if (e.touches.length === 2) {
          const t1 = e.touches[0], t2 = e.touches[1];
          const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
          if (pinchWebcam && baseDist > 0 && webcamActiveRef.current) {
            const factor = dist / baseDist;
            const nw = Math.max(72, Math.round(baseW * factor));
            const nh = Math.round(nw / WEBCAM_PIP_ASPECT);
            const nx = cx0 - nw / 2;
            const ny = cy0 - nh / 2;
            webcamPipRectRef.current = clampWebcamPip(
              { x: nx, y: ny, w: nw, h: nh },
              canvas.width,
              canvas.height,
            );
          } else if (!pinchWebcam && lastDist > 0) {
            const factor = dist / lastDist;
            zoomRef.current = Math.max(0.25, Math.min(8, zoomRef.current * factor));
          }
          lastDist = dist;
          e.preventDefault();
        } else if (
          e.touches.length === 1 &&
          zoomRef.current > 1 &&
          !pinchWebcam
        ) {
          const t = activeToolRef.current;
          const isDrawTool =
            t === 'pen' || t === 'line' || t === 'arrow' || t === 'arrowAngle' ||
            t === 'circle' || t === 'bodyCircle' || t === 'rect' || t === 'triangle' ||
            t === 'angle' || t === 'text' || t === 'erase' || t === 'ballShadow' ||
            t === 'swingPath' || t === 'manualSwing';
          if (!isDrawTool || panModeEnabledRef.current) {
            e.preventDefault();
          }
        }
      };
      const onTouchEnd = () => {
        lastDist = 0;
        pinchWebcam = false;
        baseDist = 0;
      };

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
      renderDirtyRef.current = true;
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
        renderDirtyRef.current = true;
        anglePhaseRef.current = 0;
        angleVRef.current = null;
        angleP1Ref.current = null;
        // ClearAll should remove *everything* including AI overlays.
        skeletonSuppressedRef.current = true;
        cachedPosesRef.current = [];
        poseProcessingRef.current = false;
        skeletonFramesRef.current = [];
        latestKeypointsRef.current = null;
        poseSmoothPrevRef.current = null;
        youtubePoseCacheRef.current.clear();
        youtubeSmoothBufRef.current = [];
        cachedBallRef.current = [];
        ballProcessingRef.current = false;
        ballTrackRef.current = [];
        isBallDetectingRef.current = false;
        cropRegionRef.current = null;
        onProcessingStatus?.(null);
        pushHistory();
      },
      resetSkeleton: () => {
        skeletonSuppressedRef.current = false;
        cachedPosesRef.current = [];
        poseProcessingRef.current = false;
        skeletonFramesRef.current = [];
        latestKeypointsRef.current = null;
        poseSmoothPrevRef.current = null;
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
        skeletonSuppressedRef.current = true;
        cachedPosesRef.current = [];
        poseProcessingRef.current = false;
        skeletonFramesRef.current = [];
        latestKeypointsRef.current = null;
        cachedBallRef.current = [];
        ballProcessingRef.current = false;
        renderDirtyRef.current = true;
        ballTrackRef.current = [];
        isBallDetectingRef.current = false;
        onProcessingStatus?.(null);

        if (historyIdxRef.current > 0) {
          historyIdxRef.current--;
          strokesRef.current = [...historyRef.current[historyIdxRef.current]];
        }
      },
      redo: () => {
        if (historyIdxRef.current < historyRef.current.length - 1) {
          historyIdxRef.current++;
          strokesRef.current = [...historyRef.current[historyIdxRef.current]];
          renderDirtyRef.current = true;
        }
      },
      getDetectedSwings: () => {
        const frames = skeletonFramesRef.current;
        const video = videoRef.current;
        const vw = video && video.videoWidth > 0 ? video.videoWidth : youtubePoseDimsRef.current.w;
        const vh = video && video.videoHeight > 0 ? video.videoHeight : youtubePoseDimsRef.current.h;
        if (frames.length === 0 || vw <= 0 || vh <= 0) return [];
        return detectSwingSegments(frames, vw, vh);
      },
      drawSwingFromSegment: (segment: SwingSegment, color: string) => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!canvas) return;

        const vW2 = (video && video.videoWidth > 0 ? video.videoWidth : youtubePoseDimsRef.current.w) || canvas.width;
        const vH2 = (video && video.videoHeight > 0 ? video.videoHeight : youtubePoseDimsRef.current.h) || canvas.height;
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
          arrowAtEnd: drawingOptsRef.current.arrowAtEnd === true,
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
      clearCropRegion: () => {
        cropRegionRef.current = null;
        zoomRef.current = 1.0;
        panXRef.current = 0;
        panYRef.current = 0;
      },
      zoomIn: () => {
        zoomRef.current = Math.min(5, zoomRef.current + 0.25);
      },
      zoomOut: () => {
        const next = Math.max(1, zoomRef.current - 0.25);
        zoomRef.current = next;
        if (next <= 1) { panXRef.current = 0; panYRef.current = 0; }
      },
      resetZoomPan: () => {
        zoomRef.current = 1.0;
        panXRef.current = 0;
        panYRef.current = 0;
      },
      startObjMultiplierRegionSelect: () => {
        isSelectingObjMultRegionRef.current = true;
        objMultRegionStartRef.current = null;
        objMultRegionCurrentRef.current = null;
      },
      getObjMultiplierRegion: () => objMultRegionRef.current,
      runObjMultiplierCapture: async (frameCount, duration, onProgress) => {
        const video = videoRef.current;
        if (!video || !objMultRegionRef.current) return 0;
        const { ObjectMultiplier } = await import('@/lib/objectMultiplier');
        if (!objMultiplierRef.current) {
          objMultiplierRef.current = new ObjectMultiplier();
        }
        objMultiplierRef.current.clear();
        await objMultiplierRef.current.autoCaptureSequence(
          video,
          objMultRegionRef.current,
          frameCount,
          duration,
          onProgress,
        );
        return objMultiplierRef.current.getFrameCount();
      },
      clearObjMultiplier: () => {
        objMultiplierRef.current?.clear();
        objMultiplierRef.current = null;
        objMultRegionRef.current = null;
      },
      getObjMultiplierFrameCount: () => objMultiplierRef.current?.getFrameCount() ?? 0,
    }), [onProcessingStatus, pushHistory, videoRef]);

    // ── Skeleton: PoseWorkerBridge lifecycle ───────────────────────────────
    // Creates/disposes the bridge when skeleton is toggled. The bridge handles
    // worker-vs-main-thread fallback internally; the render loop just calls
    // bridge.sendFrame(video) and receives keypoints via callback.

    useEffect(() => {
      if (!skeletonEnabled) {
        poseLoopActiveRef.current = false;
        skeletonSuppressedRef.current = false;
        latestKeypointsRef.current = null;
        poseBridgeRef.current?.dispose();
        poseBridgeRef.current = null;
        return;
      }
      ensurePoseRender();
      if (typeof window === 'undefined') return;
      if (youtubePoseRef.current) {
        poseBridgeRef.current?.dispose();
        poseBridgeRef.current = null;
        poseLoopActiveRef.current = false;
        return;
      }

      const bridge = new PoseWorkerBridge({
        frameSkip: poseFrameSkipRef.current,
        onStatus: onProcessingStatus ?? undefined,
      });
      poseBridgeRef.current = bridge;
      poseLoopActiveRef.current = true;

      bridge.onResult((keypoints) => {
        if (skeletonSuppressedRef.current) {
          latestKeypointsRef.current = null;
          return;
        }
        if (keypoints) {
          latestKeypointsRef.current = keypoints;
          renderDirtyRef.current = true;

          const v = videoRef.current;
          if (v && !v.paused) {
            const nowT = v.currentTime;
            const lastFrame = skeletonFramesRef.current.at(-1);
            if (!lastFrame || nowT !== lastFrame.timeSeconds) {
              skeletonFramesRef.current.push({ timeSeconds: nowT, keypoints });
              if (skeletonFramesRef.current.length > MAX_SKELETON_FRAMES) {
                skeletonFramesRef.current = skeletonFramesRef.current.slice(-MAX_SKELETON_FRAMES);
              }
            }
          }
        }
      });

      bridge.onReady(() => {
        detectorRef.current = true; // signal to YouTube path that a detector exists
        onProcessingStatus?.('Skeleton ready — press play');
      });

      return () => {
        poseLoopActiveRef.current = false;
        bridge.dispose();
        poseBridgeRef.current = null;
      };
    }, [skeletonEnabled, onProcessingStatus, videoRef]);

    // ── Pose detection scheduling — sends frames to bridge ───────────────
    // Uses requestVideoFrameCallback when playing for frame-accurate sync;
    // falls back to rAF. The bridge handles frame skipping + in-flight guard.

    useEffect(() => {
      if (!skeletonEnabled) return;
      if (youtubePoseRef.current) return;
      if (!renderVideoRef.current) return;
      const video = videoRef.current;
      if (!video) return;

      poseLoopActiveRef.current = true;
      let pausedTimer: number | undefined;

      const cancelScheduled = () => {
        if (pausedTimer !== undefined) {
          window.clearTimeout(pausedTimer as number);
          pausedTimer = undefined;
        }
        const v = videoRef.current;
        const s = poseScheduleRef.current;
        if (!s) return;
        if (s.kind === 'rvfc' && v && typeof v.cancelVideoFrameCallback === 'function') {
          try { v.cancelVideoFrameCallback(s.id); } catch { /* noop */ }
        } else {
          cancelAnimationFrame(s.id);
        }
        poseScheduleRef.current = null;
      };

      const scheduleNext = () => {
        if (!poseLoopActiveRef.current) return;
        const v = videoRef.current;
        if (!v) return;

        if (v.paused) {
          pausedTimer = window.setTimeout(() => {
            pausedTimer = undefined;
            sendFrame();
          }, 118) as unknown as number;
          return;
        }

        if (typeof v.requestVideoFrameCallback !== 'function') {
          const id = requestAnimationFrame(() => { poseScheduleRef.current = null; sendFrame(); });
          poseScheduleRef.current = { kind: 'raf', id };
          return;
        }

        const id = v.requestVideoFrameCallback(() => {
          poseScheduleRef.current = null;
          sendFrame();
        });
        poseScheduleRef.current = { kind: 'rvfc', id };
      };

      const sendFrame = () => {
        if (!poseLoopActiveRef.current) return;
        const bridge = poseBridgeRef.current;
        const v = videoRef.current;
        if (bridge && v) {
          bridge.frameSkip = poseFrameSkipRef.current;
          bridge.sendFrame(v);
        }
        scheduleNext();
      };

      scheduleNext();

      return () => {
        poseLoopActiveRef.current = false;
        cancelScheduled();
      };
    }, [skeletonEnabled, videoRef]);

    /** Reset temporal smoothing when the HTML video source changes */
    useEffect(() => {
      const v = videoRef.current;
      if (!v) return;
      const onReload = () => {
        poseSmoothPrevRef.current = null;
        poseBridgeRef.current?.resetSmoothing();
      };
      v.addEventListener('loadeddata', onReload);
      return () => v.removeEventListener('loadeddata', onReload);
    }, [videoRef]);

    // ── Webcam selfie mask for cutout PiP (MediaPipe CDN) ──
    useEffect(() => {
      if (!webcamCutout || !webcamActive) {
        webcamSegmenterRef.current?.dispose();
        webcamSegmenterRef.current = null;
        webcamMaskRef.current = null;
        return;
      }

      let cancelled = false;
      const segmenter = new WebcamSegmenter();

      (async () => {
        try {
          await segmenter.init();
          if (cancelled) { segmenter.dispose(); return; }

          const wc = webcamVideoRef?.current;
          if (wc && wc.readyState >= 2) {
            segmenter.start(wc);
          } else if (wc) {
            const onReady = () => {
              wc.removeEventListener('loadeddata', onReady);
              if (!cancelled) segmenter.start(wc);
            };
            wc.addEventListener('loadeddata', onReady);
          }

          webcamSegmenterRef.current = segmenter;
          webcamMaskRef.current = segmenter.getOutputCanvas();
        } catch {
          onProcessingStatus?.('Webcam cutout unavailable — showing normal PiP');
        }
      })();

      return () => {
        cancelled = true;
        segmenter.dispose();
        webcamSegmenterRef.current = null;
        webcamMaskRef.current = null;
      };
    }, [webcamCutout, webcamActive, webcamVideoRef, onProcessingStatus]);

    useEffect(() => {
      youtubePoseCacheRef.current.clear();
      youtubeSmoothBufRef.current = [];
      youtubePoseDimsRef.current = youtubePose?.videoId ? { w: 1280, h: 720 } : { w: 0, h: 0 };
    }, [youtubePose?.videoId]);

    // YouTube iframe: pose from thumbnail + time sync (no iframe pixel access).
    useEffect(() => {
      if (!skeletonEnabled) return;
      const yp = youtubePoseRef.current;
      if (!yp) return;

      let rafId: number;
      poseLoopActiveRef.current = true;
      let thumb: HTMLImageElement | null = null;
      let lastGood: PoseKeypoint[] | null = null;
      let baseEstimated = false;

      const ensureThumb = async () => {
        if (thumb?.complete) return;
        const img = await loadYoutubeThumbnailImage(yp.videoId);
        if (!img) return;
        thumb = img;
        youtubePoseDimsRef.current = {
          w: img.naturalWidth || 1280,
          h: img.naturalHeight || 720,
        };
      };

      const poseLoop = async () => {
        if (!poseLoopActiveRef.current) return;
        if (skeletonSuppressedRef.current) {
          if (lastGood?.length) latestKeypointsRef.current = lastGood;
          rafId = requestAnimationFrame(poseLoop);
          return;
        }

        await ensureThumb();
        const ctrl = yp.controllerRef.current;
        const det = detectorRef.current;
        const now = ctrl?.getCurrentTime() ?? 0;

        if (det && thumb && thumb.complete) {
          try {
            if (!baseEstimated) {
              const poses = await det.estimatePoses(thumb, { flipHorizontal: false });
              const raw = poses?.[0]?.keypoints as PoseKeypoint[] | undefined;
              if (raw?.length) {
                lastGood = raw;
                youtubePoseCacheRef.current.set(0, raw);
                baseEstimated = true;
              }
            }
            if (lastGood?.length) {
              const merged = smoothPoseKeypoints(
                latestKeypointsRef.current as PoseKeypoint[] | null,
                lastGood,
                { alpha: 0.35, minScore: 0.22 },
              );
              const buf = bufferSmoothKeypoints(youtubeSmoothBufRef.current, merged, 5);
              latestKeypointsRef.current = buf;

              const playing = ctrl?.isPlaying?.() ?? false;
              const lastFrame = skeletonFramesRef.current.at(-1);
              if (playing && (!lastFrame || Math.abs(now - lastFrame.timeSeconds) > 1 / 120)) {
                skeletonFramesRef.current.push({ timeSeconds: now, keypoints: buf });
                if (skeletonFramesRef.current.length > MAX_SKELETON_FRAMES) {
                  skeletonFramesRef.current = skeletonFramesRef.current.slice(-MAX_SKELETON_FRAMES);
                }
              }
            }
          } catch {
            if (lastGood?.length) latestKeypointsRef.current = lastGood;
          }
        }

        rafId = requestAnimationFrame(poseLoop);
      };

      rafId = requestAnimationFrame(poseLoop);
      return () => {
        poseLoopActiveRef.current = false;
        cancelAnimationFrame(rafId);
      };
    }, [skeletonEnabled, youtubePose?.videoId]);

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

        const video = videoRef.current;
        const curVideoTime = video?.currentTime ?? -1;
        const videoTimeChanged = curVideoTime !== lastRenderVideoTimeRef.current;
        lastRenderVideoTimeRef.current = curVideoTime;

        const zoomChanged =
          zoomRef.current !== lastRenderZoomRef.current ||
          panXRef.current !== lastRenderPanRef.current.x ||
          panYRef.current !== lastRenderPanRef.current.y;
        lastRenderZoomRef.current = zoomRef.current;
        lastRenderPanRef.current = { x: panXRef.current, y: panYRef.current };

        const hasActiveInteraction =
          !!activeStrokeRef.current ||
          !!selectionRef.current ||
          !!liveAngleRef.current ||
          isSelectingStroRegionRef.current ||
          precisionAnchorPointerIdRef.current !== null ||
          precisionFadeStartRef.current !== null ||
          circleSpinningRef.current ||
          outlineErasingIdxRef.current >= 0;

        const needsRender =
          videoTimeChanged ||
          zoomChanged ||
          renderDirtyRef.current ||
          hasActiveInteraction ||
          webcamActiveRef.current ||
          (video && !video.paused);

        if (!needsRender) return;
        renderDirtyRef.current = false;

        ctx.clearRect(0, 0, W, H);

        // ── Apply zoom/pan transform ──────────────────────────────────────
        ctx.save();
        ctx.translate(W / 2 + panXRef.current, H / 2 + panYRef.current);
        ctx.scale(zoomRef.current, zoomRef.current);
        ctx.translate(-W / 2, -H / 2);

        // Video frame (letterboxed to preserve aspect ratio)
        const yt = youtubePoseRef.current;
        const ytDim = youtubePoseDimsRef.current;
        let dx = 0, dy = 0, dw = W, dh = H, vW = W, vH = H;

        if (renderVideoRef.current && video && video.readyState >= 2 && video.videoWidth > 0) {
          vW = video.videoWidth;
          vH = video.videoHeight;
          const scale = Math.min(W / vW, H / vH);
          dw = vW * scale;
          dh = vH * scale;
          dx = (W - dw) / 2;
          dy = (H - dh) / 2;
          // Store for rubber-band region selection coordinate mapping
          videoBoundsRef.current = { dx, dy, dw, dh };
          const hideStreamMirror =
            suppressTabCaptureMirrorRef.current &&
            !!video.srcObject &&
            typeof MediaStream !== 'undefined' &&
            video.srcObject instanceof MediaStream;
          if (!hideStreamMirror) {
            ctx.drawImage(video, dx, dy, dw, dh);
          }

          // ── Real-time ball detection (only when video frame changed) ────────
          if (videoTimeChanged && renderVideoRef.current && ballTrailEnabledRef.current && !isBallDetectingRef.current) {
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
        } else if (yt && ytDim.w > 0 && ytDim.h > 0) {
          vW = ytDim.w;
          vH = ytDim.h;
          const scale = Math.min(W / vW, H / vH);
          dw = vW * scale;
          dh = vH * scale;
          dx = (W - dw) / 2;
          dy = (H - dh) / 2;
          videoBoundsRef.current = { dx, dy, dw, dh };
        } else if (!renderVideoRef.current) {
          dx = 0; dy = 0; dw = W; dh = H; vW = W; vH = H;
          videoBoundsRef.current = { dx, dy, dw, dh };
        } else {
          if (transparentWhenNoVideoRef.current) {
            ctx.clearRect(0, 0, W, H);
          } else {
            ctx.fillStyle = '#111';
            ctx.fillRect(0, 0, W, H);
          }
          dx = 0; dy = 0; dw = W; dh = H; vW = W; vH = H;
          videoBoundsRef.current = { dx, dy, dw, dh };
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

        // ── Object Multiplier overlay ───────────────────────────────────
        if (objMultiplierRef.current && objMultiplierRef.current.getFrameCount() > 0 && dw > 0 && dh > 0) {
          ctx.save();
          ctx.translate(dx, dy);
          objMultiplierRef.current.drawOverlay(ctx, dw, dh);
          ctx.restore();
        }

        if (
          activeToolRef.current === 'objectMultiplier' &&
          dw > 0 &&
          dh > 0 &&
          (!objMultiplierRef.current || objMultiplierRef.current.getFrameCount() === 0)
        ) {
          ctx.save();
          ctx.translate(dx, dy);
          const msg = isSelectingObjMultRegionRef.current
            ? 'Release to confirm selection'
            : 'Drag to select the object you want to multiply across frames';
          ctx.font = '600 15px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
          const tw = ctx.measureText(msg).width;
          const padX = 14;
          const padY = 10;
          const bx = (dw - tw - padX * 2) / 2;
          const by = dh - 52;
          ctx.fillStyle = 'rgba(0,0,0,0.62)';
          ctx.beginPath();
          if (typeof (ctx as CanvasRenderingContext2D & { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect === 'function') {
            (ctx as CanvasRenderingContext2D & { roundRect: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect(bx, by, tw + padX * 2, 40, 10);
          } else {
            ctx.rect(bx, by, tw + padX * 2, 40);
          }
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.fillText(msg, bx + padX, by + 26);
          ctx.restore();
        }

        const playbackT =
          yt?.controllerRef.current?.getCurrentTime?.() ??
          video?.currentTime ??
          0;

        // ── Skeleton overlay ─────────────────────────────────────────────
        const skeletonDimsOk =
          (video && video.readyState >= 2 && video.videoWidth > 0) ||
          (yt && ytDim.w > 0 && ytDim.h > 0);

        if (
          skeletonEnabledRef.current &&
          skeletonDrawEnabledRef.current &&
          !skeletonSuppressedRef.current &&
          skeletonDimsOk
        ) {
          if (latestKeypointsRef.current && latestKeypointsRef.current.length > 0 && vW > 0 && vH > 0) {
            ctx.save();
            ctx.translate(dx, dy);
            drawSkeletonOverlay(ctx, latestKeypointsRef.current, vW, vH, dw, dh, {
              showAngles: skeletonShowAnglesRef.current,
              showHeadLine: skeletonShowHeadLineRef.current,
              classicColors: skeletonClassicColorsRef.current,
              parts: skeletonPartsRef.current,
            });
            ctx.restore();
          } else if (cachedPosesRef.current.length > 0 && poseRenderFns && video) {
            // Fallback to legacy cached poses
            const pf = poseRenderFns.getPoseAtTime(cachedPosesRef.current, playbackT);
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

        // Webcam PiP — default lower-right; move/resize with Select tool or pinch (touch)
        const webcam = webcamVideoRef?.current;
        const showWebcamPip =
          webcamActiveRef.current &&
          webcam &&
          webcam.readyState >= 2 &&
          webcamPipModeRef.current !== 'hidden';
        if (showWebcamPip) {
          let pip = webcamPipRectRef.current;
          if (!pip.w || !pip.h) {
            pip = defaultWebcamPipRect(W, H);
            webcamPipRectRef.current = pip;
          }
          pip = clampWebcamPip(pip, W, H);
          webcamPipRectRef.current = pip;
          const cx2 = pip.x;
          const cy2 = pip.y;
          const camW = pip.w;
          const camH = pip.h;
          ctx.save();
          ctx.globalAlpha = webcamOpacityRef.current;

          const maskCanvas = webcamMaskRef.current;
          const useCutout =
            webcamCutoutRef.current && maskCanvas && maskCanvas.width > 0 && maskCanvas.height > 0;

          const drawPipPixels = () => {
            if (useCutout) {
              ctx.save();
              ctx.translate(cx2 + camW, cy2);
              ctx.scale(-1, 1);
              ctx.drawImage(maskCanvas, 0, 0, camW, camH);
              ctx.restore();
            } else {
              ctx.drawImage(webcam, cx2, cy2, camW, camH);
            }
          };

          if (useCutout) {
            drawPipPixels();
          } else if (webcamPipModeRef.current === 'circle') {
            const r = Math.min(camW, camH) / 2;
            const centerX = cx2 + camW / 2;
            const centerY = cy2 + camH / 2;
            ctx.beginPath();
            ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
            ctx.clip();
            drawPipPixels();
          } else {
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(cx2, cy2, camW, camH, 10);
            else ctx.rect(cx2, cy2, camW, camH);
            ctx.clip();
            drawPipPixels();
            ctx.globalAlpha = 1;
            ctx.strokeStyle = 'rgba(255,255,255,0.35)';
            ctx.lineWidth = 2;
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
          drawSmoothPath(ctx, pts, opts.color, opts.lineWidth, 0.8, opts.dashed ?? false, opts.arrowAtEnd === true);
        }

        // Manual swing path being drawn
        if (manualSwingActiveRef.current && manualSwingPtsRef.current.length > 0) {
          const pts = manualSwingPtsRef.current;
          const opts = drawingOptsRef.current;
          drawSmoothPath(ctx, pts, opts.color, opts.lineWidth, 0.8, opts.dashed ?? false, opts.arrowAtEnd === true);
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

        // Webcam PiP corner handles (select tool) — drawn above strokes
        if (
          webcamActiveRef.current &&
          activeToolRef.current === 'select' &&
          webcamVideoRef?.current &&
          webcamVideoRef.current.readyState >= 2 &&
          webcamPipModeRef.current !== 'hidden'
        ) {
          let pipH = webcamPipRectRef.current;
          if (pipH.w > 0 && pipH.h > 0) {
            pipH = clampWebcamPip(pipH, W, H);
            const hsz = WEBCAM_PIP_HANDLE / 2;
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.strokeStyle = 'rgba(0,0,0,0.25)';
            ctx.lineWidth = 1;
            const corners: Array<[number, number]> = [
              [pipH.x, pipH.y],
              [pipH.x + pipH.w, pipH.y],
              [pipH.x, pipH.y + pipH.h],
              [pipH.x + pipH.w, pipH.y + pipH.h],
            ];
            for (const [hx, hy] of corners) {
              ctx.fillRect(hx - hsz, hy - hsz, WEBCAM_PIP_HANDLE, WEBCAM_PIP_HANDLE);
              ctx.strokeRect(hx - hsz, hy - hsz, WEBCAM_PIP_HANDLE, WEBCAM_PIP_HANDLE);
            }
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
          } else if (sel.kind === 'textResize') {
            const s = strokesRef.current[sel.idx];
            if (s && s.tool === 'text') {
              const bb = getTextBBox(s as StrokeText);
              x0 = bb.x0; y0 = bb.y0;
              x1 = bb.x1; y1 = bb.y1;
            }
          }
          if (x1 > x0 || y1 > y0) {
            ctx.save();
            ctx.strokeStyle = 'rgba(255,215,0,0.95)';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.strokeRect(x0 - 6, y0 - 6, (x1 - x0) + 12, (y1 - y0) + 12);
            ctx.setLineDash([]);
            // Draw corner resize handles for text strokes
            const isTextSel = (sel.kind === 'stroke' || sel.kind === 'textResize') &&
              strokesRef.current[sel.idx]?.tool === 'text';
            if (isTextSel) {
              const HANDLE_SZ = 7;
              ctx.fillStyle = '#FFD700';
              ctx.strokeStyle = '#000';
              ctx.lineWidth = 1;
              const corners = [
                [x0 - 6, y0 - 6], [x1 + 6, y0 - 6],
                [x0 - 6, y1 + 6], [x1 + 6, y1 + 6],
              ];
              for (const [hx, hy] of corners) {
                ctx.fillRect(hx - HANDLE_SZ / 2, hy - HANDLE_SZ / 2, HANDLE_SZ, HANDLE_SZ);
                ctx.strokeRect(hx - HANDLE_SZ / 2, hy - HANDLE_SZ / 2, HANDLE_SZ, HANDLE_SZ);
              }
            }
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

        // ── Active crop region (for export/recording) ─────────────────────
        if (cropRegionRef.current) {
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

        // ── Precision touch cursor + ripple (inside zoom/pan transform) ───
        if (precisionTouchDrawRef.current) {
          const tgt = precisionCrosshairTargetRef.current;
          let disp = precisionCrosshairDisplayRef.current;
          if (tgt && precisionAnchorPointerIdRef.current !== null) {
            if (!disp) {
              disp = { ...tgt };
              precisionCrosshairDisplayRef.current = disp;
            } else {
              const k = 0.42;
              disp.x += (tgt.x - disp.x) * k;
              disp.y += (tgt.y - disp.y) * k;
            }
          }

          let cursorAlpha = 0;
          if (precisionAnchorPointerIdRef.current !== null) {
            cursorAlpha = 1;
          } else if (precisionFadeStartRef.current !== null) {
            cursorAlpha = Math.max(
              0,
              1 - (performance.now() - precisionFadeStartRef.current) / PRECISION_CURSOR_FADE_MS,
            );
            if (cursorAlpha <= 0.02) {
              precisionFadeStartRef.current = null;
              precisionCrosshairDisplayRef.current = null;
              precisionCrosshairTargetRef.current = null;
            }
          }

          const drawPt = disp ?? tgt;
          if (drawPt && cursorAlpha > 0.04) {
            const px = drawPt.x;
            const py = drawPt.y;
            ctx.save();
            ctx.globalAlpha = cursorAlpha;
            ctx.strokeStyle = 'rgba(0,0,0,0.45)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(px, py, 14, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(255,255,255,0.95)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(px, py, 14, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(px - 22, py);
            ctx.lineTo(px + 22, py);
            ctx.moveTo(px, py - 22);
            ctx.lineTo(px, py + 22);
            ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.95)';
            ctx.beginPath();
            ctx.arc(px, py, 2.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }

          const rip = precisionRippleRef.current;
          if (rip) {
            const elapsed = performance.now() - rip.t0;
            if (elapsed > PRECISION_RIPPLE_MS) {
              precisionRippleRef.current = null;
            } else {
              const t = elapsed / PRECISION_RIPPLE_MS;
              const r = 12 + t * 36;
              const a = (1 - t) * 0.55 * cursorAlpha;
              ctx.save();
              ctx.globalAlpha = a;
              ctx.strokeStyle = 'rgba(255,255,255,0.9)';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.arc(rip.x, rip.y, r, 0, Math.PI * 2);
              ctx.stroke();
              ctx.restore();
            }
          }
        }

        // ── Outline eraser cursor preview ──────────────────────────────────
        const eraserR = outlineEraserSizeRef.current;
        const eraserPos = outlineEraserPosRef.current;
        const eraserTool = activeToolRef.current;
        if (eraserR > 0 && eraserPos && (eraserTool === 'circle' || eraserTool === 'bodyCircle' || eraserTool === 'rect' || eraserTool === 'triangle')) {
          ctx.save();
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = 'rgba(255, 59, 48, 0.25)';
          ctx.beginPath();
          ctx.arc(eraserPos.x, eraserPos.y, eraserR, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 0.8;
          ctx.strokeStyle = 'rgba(255, 59, 48, 0.7)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(eraserPos.x, eraserPos.y, eraserR, 0, Math.PI * 2);
          ctx.stroke();
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
      /** Match precision crosshair mapping so finger drawing lands where the offset crosshair would. */
      const yAdj = e.pointerType === 'touch' ? PRECISION_CURSOR_OFFSET_Y : 0;
      const sx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const sy = (e.clientY - yAdj - rect.top) * (canvas.height / rect.height);
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

    const getPosFromClientXY = (clientX: number, clientY: number): Pt => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const sx = (clientX - rect.left) * (canvas.width / rect.width);
      const sy = (clientY - rect.top) * (canvas.height / rect.height);
      const W = canvas.width;
      const H = canvas.height;
      return {
        x: (sx - (W / 2 + panXRef.current)) / zoomRef.current + W / 2,
        y: (sy - (H / 2 + panYRef.current)) / zoomRef.current + H / 2,
      };
    };

    const commitObjectMultiplierFromPts = useCallback((p1: Pt, p2: Pt) => {
      const { dx, dy, dw, dh } = videoBoundsRef.current;
      if (dw > 0 && dh > 0) {
        const x = Math.max(0, Math.min(1, (Math.min(p1.x, p2.x) - dx) / dw));
        const y = Math.max(0, Math.min(1, (Math.min(p1.y, p2.y) - dy) / dh));
        const w = Math.max(0, Math.min(1 - x, Math.abs(p2.x - p1.x) / dw));
        const h = Math.max(0, Math.min(1 - y, Math.abs(p2.y - p1.y) / dh));
        if (w > 0.01 && h > 0.01) {
          objMultRegionRef.current = { x, y, w, h };
          onObjMultRegionSelectedRef.current?.();
        }
      }
      isSelectingObjMultRegionRef.current = false;
      objMultRegionStartRef.current = null;
      objMultRegionCurrentRef.current = null;
      isDraggingRef.current = false;
      setObjMultOverlayPx(null);
      objMultOverlayDownRef.current = null;
      renderDirtyRef.current = true;
    }, []);

    const logicalPtToClient = (pt: Pt): { clientX: number; clientY: number } => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const W = canvas.width;
      const H = canvas.height;
      const sx = (pt.x - W / 2) * zoomRef.current + W / 2 + panXRef.current;
      const sy = (pt.y - H / 2) * zoomRef.current + H / 2 + panYRef.current;
      return {
        clientX: rect.left + (sx * rect.width) / W,
        clientY: rect.top + (sy * rect.height) / H,
      };
    };

    const precisionToolUsesToggleDownUp = (t: ToolType): boolean =>
      t === 'pen' ||
      t === 'erase' ||
      t === 'line' ||
      t === 'arrow' ||
      t === 'arrowAngle' ||
      t === 'circle' ||
      t === 'bodyCircle' ||
      t === 'rect' ||
      t === 'triangle';

    const dispatchPrecisionSynthetic = (type: 'pointerdown' | 'pointerup', logicalPt: Pt) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const { clientX, clientY } = logicalPtToClient(logicalPt);
      try {
        canvas.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX,
            clientY,
            pointerId: PRECISION_SYNTHETIC_POINTER_ID,
            pointerType: 'mouse',
            isPrimary: true,
            button: 0,
            buttons: type === 'pointerup' ? 0 : 1,
            pressure: 0.5,
          }),
        );
      } catch {
        /* noop */
      }
    };

    // ── Finish swing path ──────────────────────────────────────────────────

    const finishSwingPath = useCallback(() => {
      if (longPressRef.current) clearTimeout(longPressRef.current);
      const pts = swingPtsRef.current;
      if (pts.length > 0) {
        const opts = drawingOptsRef.current;
        strokesRef.current = [
          ...strokesRef.current,
          {
            tool: 'swingPath',
            pts: [...pts],
            color: opts.color,
            lw: opts.lineWidth,
            dashed: opts.dashed ?? false,
            arrowAtEnd: opts.arrowAtEnd === true,
          },
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
          {
            tool: 'manualSwing',
            pts: [...pts],
            color: opts.color,
            lw: opts.lineWidth,
            dashed: opts.dashed ?? false,
            arrowAtEnd: opts.arrowAtEnd === true,
          },
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

    const getTextBBox = (tx: StrokeText): { x0: number; y0: number; x1: number; y1: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x0: tx.pos.x, y0: tx.pos.y - tx.fontSize, x1: tx.pos.x + 100, y1: tx.pos.y };
      const ctx = canvas.getContext('2d')!;
      ctx.font = `bold ${tx.fontSize}px Inter, sans-serif`;
      const metrics = ctx.measureText(tx.text || ' ');
      const w = metrics.width;
      const h = tx.fontSize;
      return { x0: tx.pos.x, y0: tx.pos.y - h, x1: tx.pos.x + w, y1: tx.pos.y };
    };

    const textResizeHandleHit = (tx: StrokeText, pos: Pt): 'tl' | 'tr' | 'bl' | 'br' | null => {
      const bb = getTextBBox(tx);
      const HANDLE_R = 8;
      const corners: Array<{ id: 'tl' | 'tr' | 'bl' | 'br'; x: number; y: number }> = [
        { id: 'tl', x: bb.x0, y: bb.y0 },
        { id: 'tr', x: bb.x1, y: bb.y0 },
        { id: 'bl', x: bb.x0, y: bb.y1 },
        { id: 'br', x: bb.x1, y: bb.y1 },
      ];
      for (const c of corners) {
        if (Math.hypot(pos.x - c.x, pos.y - c.y) <= HANDLE_R) return c.id;
      }
      return null;
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
        const v1: Pt = { x: t.cx, y: t.cy - t.ry };
        const v2: Pt = { x: t.cx + t.rx, y: t.cy + t.ry };
        const v3: Pt = { x: t.cx - t.rx, y: t.cy + t.ry };
        return Math.min(
          distToSegment(pos, v1, v2),
          distToSegment(pos, v2, v3),
          distToSegment(pos, v3, v1),
        );
      }
      if (s.tool === 'text') {
        const tx = s as StrokeText;
        const bb = getTextBBox(tx);
        const cx = Math.max(bb.x0, Math.min(bb.x1, pos.x));
        const cy = Math.max(bb.y0, Math.min(bb.y1, pos.y));
        const inside = pos.x >= bb.x0 && pos.x <= bb.x1 && pos.y >= bb.y0 && pos.y <= bb.y1;
        return inside ? 0 : Math.hypot(pos.x - cx, pos.y - cy);
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

    const webcamPipHitTest = useCallback((pos: Pt): 'tl' | 'tr' | 'bl' | 'br' | 'inside' | 'miss' => {
      if (!webcamActiveRef.current || !webcamVideoRef?.current || webcamVideoRef.current.readyState < 2) {
        return 'miss';
      }
      const canvas = canvasRef.current;
      if (!canvas) return 'miss';
      const cw = canvas.width;
      const ch = canvas.height;
      let pip = webcamPipRectRef.current;
      if (!pip.w || !pip.h) pip = defaultWebcamPipRect(cw, ch);
      pip = clampWebcamPip(pip, cw, ch);
      const hTol = WEBCAM_PIP_HANDLE / 2 + 4;
      const corners: Array<{ id: 'tl' | 'tr' | 'bl' | 'br'; x: number; y: number }> = [
        { id: 'tl', x: pip.x, y: pip.y },
        { id: 'tr', x: pip.x + pip.w, y: pip.y },
        { id: 'bl', x: pip.x, y: pip.y + pip.h },
        { id: 'br', x: pip.x + pip.w, y: pip.y + pip.h },
      ];
      for (const c of corners) {
        if (Math.abs(pos.x - c.x) <= hTol && Math.abs(pos.y - c.y) <= hTol) return c.id;
      }
      if (pos.x >= pip.x && pos.x <= pip.x + pip.w && pos.y >= pip.y && pos.y <= pip.y + pip.h) return 'inside';
      return 'miss';
    }, [webcamVideoRef]);

    const eraseAt = useCallback((pos: Pt) => {
      const T = 22;
      // Same distance-to-stroke test as the Select tool so erasing hits outlines,
      // including circles/rects/triangles (not just their center).
      strokesRef.current = strokesRef.current.filter((s) => {
        const d = hitTestStroke(s, pos);
        const lw = typeof (s as { lw?: number }).lw === 'number' ? (s as { lw: number }).lw : 2;
        return d > T + lw * 0.6;
      });
      angleMeasRef.current = angleMeasRef.current.filter(
        m => Math.hypot(m.v.x - pos.x, m.v.y - pos.y) > T,
      );
    }, []);

    // ── Pointer down ───────────────────────────────────────────────────────

    const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvasEl = e.target as HTMLCanvasElement;
      const toolEarly = activeToolRef.current;
      const precisionEligible =
        precisionTouchDrawRef.current &&
        e.pointerType === 'touch' &&
        toolEarly !== 'zoom' &&
        toolEarly !== 'objectMultiplier';

      if (precisionEligible) {
        const anchor = precisionAnchorPointerIdRef.current;
        if (anchor === null) {
          precisionAnchorPointerIdRef.current = e.pointerId;
          const ch = getPosFromClientXY(e.clientX, e.clientY - PRECISION_CURSOR_OFFSET_Y);
          precisionCrosshairTargetRef.current = ch;
          precisionCrosshairDisplayRef.current = { ...ch };
          precisionFadeStartRef.current = null;
          canvasEl.setPointerCapture(e.pointerId);
          e.preventDefault();
          return;
        }
        if (e.pointerId !== anchor) {
          const ch =
            precisionCrosshairDisplayRef.current ??
            precisionCrosshairTargetRef.current;
          if (!ch) {
            e.preventDefault();
            return;
          }
          precisionRippleRef.current = { x: ch.x, y: ch.y, t0: performance.now() };
          const useToggle = precisionToolUsesToggleDownUp(toolEarly);
          const dragging = isDraggingRef.current && activeStrokeRef.current !== null;
          if (useToggle && dragging) {
            dispatchPrecisionSynthetic('pointerup', ch);
          } else {
            dispatchPrecisionSynthetic('pointerdown', ch);
          }
          e.preventDefault();
          return;
        }
      }

      canvasEl.setPointerCapture(e.pointerId);
      const pos  = getPos(e);
      const lw   = pressureWidth(e);
      const tool = activeToolRef.current;
      const opts = drawingOptsRef.current;

      // ── StroMotion rubber-band region selection ──────────────────────────
      if (isSelectingStroRegionRef.current) {
        stroRegionStartRef.current = pos;
        stroRegionCurrentRef.current = pos;
        isDraggingRef.current = true;
        return;
      }

      // Object multiplier selection is handled by a dedicated overlay (see JSX).

      // ── Pan: activates immediately on pointer-down with no delay ────────
      // Triggers: middle-click, Space+drag, zoom tool while zoomed,
      // select/skeleton tool while zoomed, or panMode enabled while zoomed.
      // When panMode is on and zoomed, ALL tools become pan (drawing is suppressed).
      const zoomed = zoomRef.current > 1;
      const isDrawingTool =
        tool === 'pen' || tool === 'line' || tool === 'arrow' || tool === 'arrowAngle' ||
        tool === 'circle' || tool === 'bodyCircle' || tool === 'rect' || tool === 'triangle' ||
        tool === 'angle' || tool === 'text' || tool === 'erase' || tool === 'ballShadow' ||
        tool === 'swingPath' || tool === 'manualSwing';
      const shouldPan =
        e.button === 1 ||
        spaceHeldRef.current ||
        (tool === 'zoom' && e.button === 0 && zoomed) ||
        (zoomed && panModeEnabledRef.current) ||
        (zoomed && !isDrawingTool);
      if (shouldPan) {
        isPanningRef.current = true;
        panStartRef.current = { x: e.clientX, y: e.clientY, px: panXRef.current, py: panYRef.current };
        e.preventDefault();
        return;
      }

      // ── Select tool: webcam PiP drag / resize first ─────────────────────
      if (tool === 'select') {
        const pipHit = webcamPipHitTest(pos);
        if (pipHit !== 'miss') {
          const canvas = canvasRef.current;
          const cw = canvas?.width ?? 0;
          const ch = canvas?.height ?? 0;
          let pip = webcamPipRectRef.current;
          if (!pip.w || !pip.h) pip = defaultWebcamPipRect(cw, ch);
          pip = clampWebcamPip(pip, cw, ch);
          webcamPipRectRef.current = pip;
          if (pipHit === 'inside') {
            webcamPipDragRef.current = { kind: 'move', sx: pos.x, sy: pos.y, orig: { ...pip } };
          } else {
            const rk: WebcamPipDrag['kind'] =
              pipHit === 'tl' ? 'resize-tl' : pipHit === 'tr' ? 'resize-tr' : pipHit === 'bl' ? 'resize-bl' : 'resize-br';
            webcamPipDragRef.current = { kind: rk, sx: pos.x, sy: pos.y, orig: { ...pip } };
          }
          isDraggingRef.current = true;
          return;
        }

        // Check if clicking on a text resize handle of a currently-selected text stroke
        const prevSel = selectionRef.current;
        if (prevSel && prevSel.kind === 'stroke') {
          const prevS = strokesRef.current[prevSel.idx];
          if (prevS && prevS.tool === 'text') {
            const corner = textResizeHandleHit(prevS as StrokeText, pos);
            if (corner) {
              selectionRef.current = { kind: 'textResize', idx: prevSel.idx, start: pos, orig: prevS as StrokeText, corner };
              isDraggingRef.current = true;
              return;
            }
          }
        }

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
          if (best.kind === 'stroke' && strokesRef.current[best.idx]?.tool === 'text' && e.pointerType === 'touch') {
            const now = performance.now();
            const lt = lastTextTapRef.current;
            if (
              lt &&
              lt.idx === best.idx &&
              now - lt.t < 420 &&
              Math.hypot(pos.x - lt.x, pos.y - lt.y) < 48
            ) {
              lastTextTapRef.current = null;
              const tx = strokesRef.current[best.idx] as StrokeText;
              const bb = getTextBBox(tx);
              const canvas = canvasRef.current!;
              const rect = canvas.getBoundingClientRect();
              const W = canvas.width;
              const H = canvas.height;
              const logX = bb.x0;
              const logY = bb.y0;
              const screenX = ((logX - W / 2) * zoomRef.current + W / 2 + panXRef.current) * (rect.width / canvas.width);
              const screenY = ((logY - H / 2) * zoomRef.current + H / 2 + panYRef.current) * (rect.height / canvas.height);
              const scaledFontSize = tx.fontSize * zoomRef.current * (rect.height / canvas.height);
              const bbW = (bb.x1 - bb.x0) * zoomRef.current * (rect.width / canvas.width);
              textEditingIdxRef.current = best.idx;
              setTextEditing({
                idx: best.idx,
                left: screenX,
                top: screenY,
                width: Math.max(100, bbW + 20),
                fontSize: scaledFontSize,
                value: tx.text,
                color: tx.color,
              });
              e.preventDefault();
              return;
            }
            lastTextTapRef.current = { idx: best.idx, t: now, x: pos.x, y: pos.y };
          }
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
        const eraserR = outlineEraserSizeRef.current;
        const touchShapePad =
          e.pointerType === 'touch' && eraserR > 0 ? Math.max(36, eraserR * 1.35) : 0;
        const hitShape = (pad: number) =>
          strokesRef.current.findIndex((s) => {
            if (s.tool !== 'circle' && s.tool !== 'bodyCircle' && s.tool !== 'rect' && s.tool !== 'triangle') return false;
            const el = s as StrokeEllipse;
            const rx = Math.max(el.rx, 1) + CIRCLE_DRAG_THRESHOLD + pad;
            const ry = Math.max(el.ry, 1) + CIRCLE_DRAG_THRESHOLD + pad;
            const dx2 = pos.x - el.cx;
            const dy2 = pos.y - el.cy;
            return (dx2 * dx2) / (rx * rx) + (dy2 * dy2) / (ry * ry) <= 1;
          });
        let idx = hitShape(0);
        if (idx < 0 && touchShapePad > 0) idx = hitShape(touchShapePad);

        // Outline eraser: start dragging to erase outline segments
        if (idx >= 0 && eraserR > 0) {
          const hitStroke = strokesRef.current[idx];
          const isEligible =
            (hitStroke.tool === 'circle' || hitStroke.tool === 'bodyCircle') ||
            (hitStroke.tool === 'rect' && (hitStroke as StrokeRect).is3d) ||
            (hitStroke.tool === 'triangle' && (hitStroke as StrokeTriangle).is3d);
          if (isEligible) {
            const dot: EraserDot = { x: pos.x, y: pos.y, radius: eraserR };
            const prev = (hitStroke as StrokeEllipse | StrokeRect | StrokeTriangle).eraserStrokes ?? [];
            const updated = { ...hitStroke, eraserStrokes: [...prev, dot] };
            strokesRef.current = [
              ...strokesRef.current.slice(0, idx),
              updated,
              ...strokesRef.current.slice(idx + 1),
            ];
            outlineErasingIdxRef.current = idx;
            outlineEraserPosRef.current = pos;
            isDraggingRef.current = true;
            return;
          }
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
    }, [pushHistory, finishSwingPath, finishManualSwingPath, eraseAt, videoRef, webcamPipHitTest]);

    // ── Pointer move ───────────────────────────────────────────────────────

    const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      let pos = getPos(e);
      if (
        precisionTouchDrawRef.current &&
        precisionAnchorPointerIdRef.current === e.pointerId &&
        e.pointerType === 'touch' &&
        activeToolRef.current !== 'zoom'
      ) {
        pos = getPosFromClientXY(e.clientX, e.clientY - PRECISION_CURSOR_OFFSET_Y);
        precisionCrosshairTargetRef.current = pos;
        e.preventDefault();
      }
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

      // ── Webcam PiP drag / resize ─────────────────────────────────────────
      const pipDrag = webcamPipDragRef.current;
      if (pipDrag) {
        const canvas = canvasRef.current;
        const cw = canvas?.width ?? 0;
        const ch = canvas?.height ?? 0;
        const o = pipDrag.orig;
        let pip: { x: number; y: number; w: number; h: number };
        if (pipDrag.kind === 'move') {
          pip = clampWebcamPip(
            {
              ...o,
              x: o.x + (pos.x - pipDrag.sx),
              y: o.y + (pos.y - pipDrag.sy),
            },
            cw,
            ch,
          );
        } else if (pipDrag.kind === 'resize-br') {
          const nw = Math.max(72, pos.x - o.x);
          const nh = Math.round(nw / WEBCAM_PIP_ASPECT);
          pip = clampWebcamPip({ x: o.x, y: o.y, w: nw, h: nh }, cw, ch);
        } else if (pipDrag.kind === 'resize-bl') {
          const nw = Math.max(72, o.x + o.w - pos.x);
          const nh = Math.round(nw / WEBCAM_PIP_ASPECT);
          const nx = o.x + o.w - nw;
          pip = clampWebcamPip({ x: nx, y: o.y, w: nw, h: nh }, cw, ch);
        } else if (pipDrag.kind === 'resize-tr') {
          const nw = Math.max(72, pos.x - o.x);
          const nh = Math.round(nw / WEBCAM_PIP_ASPECT);
          const ny = o.y + o.h - nh;
          pip = clampWebcamPip({ x: o.x, y: ny, w: nw, h: nh }, cw, ch);
        } else {
          const nw = Math.max(72, o.x + o.w - pos.x);
          const nh = Math.round(nw / WEBCAM_PIP_ASPECT);
          const nx = o.x + o.w - nw;
          const ny = o.y + o.h - nh;
          pip = clampWebcamPip({ x: nx, y: ny, w: nw, h: nh }, cw, ch);
        }
        webcamPipRectRef.current = pip;
        return;
      }

      // ── StroMotion rubber-band drag ──────────────────────────────────────
      if (isSelectingStroRegionRef.current && isDraggingRef.current && stroRegionStartRef.current) {
        stroRegionCurrentRef.current = pos;
        return;
      }

      // Select dragging
      if (tool === 'select' && isDraggingRef.current && selectionRef.current) {
        const sel = selectionRef.current;
        const dx = pos.x - sel.start.x;
        const dy = pos.y - sel.start.y;
        if (sel.kind === 'textResize') {
          const origBB = getTextBBox(sel.orig);
          const origW = origBB.x1 - origBB.x0;
          const origH = origBB.y1 - origBB.y0;
          let scaleX = 1;
          if (sel.corner === 'tr' || sel.corner === 'br') {
            scaleX = Math.max(0.25, (origW + dx) / Math.max(1, origW));
          } else {
            scaleX = Math.max(0.25, (origW - dx) / Math.max(1, origW));
          }
          let scaleY = 1;
          if (sel.corner === 'bl' || sel.corner === 'br') {
            scaleY = Math.max(0.25, (origH + dy) / Math.max(1, origH));
          } else {
            scaleY = Math.max(0.25, (origH - dy) / Math.max(1, origH));
          }
          const scale = Math.max(scaleX, scaleY);
          const newFontSize = Math.max(8, Math.round(sel.orig.fontSize * scale));
          const updated: StrokeText = { ...sel.orig, fontSize: newFontSize };
          strokesRef.current = [
            ...strokesRef.current.slice(0, sel.idx),
            updated,
            ...strokesRef.current.slice(sel.idx + 1),
          ];
          return;
        }
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

      // Outline eraser dragging
      if (outlineErasingIdxRef.current >= 0 && isDraggingRef.current) {
        const idx = outlineErasingIdxRef.current;
        const s = strokesRef.current[idx];
        if (s && (s.tool === 'circle' || s.tool === 'bodyCircle' || s.tool === 'rect' || s.tool === 'triangle')) {
          const eraserR = outlineEraserSizeRef.current;
          const dot: EraserDot = { x: pos.x, y: pos.y, radius: eraserR };
          const prev = (s as StrokeEllipse | StrokeRect | StrokeTriangle).eraserStrokes ?? [];
          const updated = { ...s, eraserStrokes: [...prev, dot] };
          strokesRef.current = [
            ...strokesRef.current.slice(0, idx),
            updated,
            ...strokesRef.current.slice(idx + 1),
          ];
          outlineEraserPosRef.current = pos;
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

      // Track cursor position for outline eraser preview (even when not dragging)
      if (outlineEraserSizeRef.current > 0 && (tool === 'circle' || tool === 'bodyCircle' || tool === 'rect' || tool === 'triangle')) {
        outlineEraserPosRef.current = pos;
        renderDirtyRef.current = true;
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

    const onPointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      if (
        precisionTouchDrawRef.current &&
        precisionAnchorPointerIdRef.current === e.pointerId &&
        e.pointerType === 'touch'
      ) {
        const ch =
          precisionCrosshairTargetRef.current ??
          precisionCrosshairDisplayRef.current;
        const toolUp = activeToolRef.current;
        if (
          ch &&
          precisionToolUsesToggleDownUp(toolUp) &&
          isDraggingRef.current &&
          activeStrokeRef.current !== null
        ) {
          dispatchPrecisionSynthetic('pointerup', ch);
        }
        precisionAnchorPointerIdRef.current = null;
        precisionFadeStartRef.current = performance.now();
        try {
          (e.target as HTMLCanvasElement).releasePointerCapture(e.pointerId);
        } catch {
          /* noop */
        }
        return;
      }

      if (webcamPipDragRef.current) {
        webcamPipDragRef.current = null;
        isDraggingRef.current = false;
        return;
      }

      // ── End pan ────────────────────────────────────────────────────────
      if (isPanningRef.current) {
        isPanningRef.current = false;
        panStartRef.current = null;
        return;
      }

      // ── Finalize Select drag ───────────────────────────────────────────
      if (selectionRef.current) {
        const finSel = selectionRef.current;
        if (finSel.kind === 'textResize') {
          // Keep the text stroke selected so resize handles remain visible
          const s = strokesRef.current[finSel.idx];
          selectionRef.current = s ? { kind: 'stroke', idx: finSel.idx, start: finSel.start, orig: s } : null;
        } else {
          selectionRef.current = null;
        }
        isDraggingRef.current = false;
        pushHistory();
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

      // Finalize outline eraser drag
      if (outlineErasingIdxRef.current >= 0) {
        outlineErasingIdxRef.current = -1;
        outlineEraserPosRef.current = null;
        isDraggingRef.current = false;
        pushHistory();
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

    // Commit text editing changes
    const commitTextEdit = useCallback(() => {
      const idx = textEditingIdxRef.current;
      if (idx < 0) return;
      const val = textEditInputRef.current?.value ?? '';
      if (val && strokesRef.current[idx]?.tool === 'text') {
        const tx = strokesRef.current[idx] as StrokeText;
        if (val !== tx.text) {
          strokesRef.current = [
            ...strokesRef.current.slice(0, idx),
            { ...tx, text: val },
            ...strokesRef.current.slice(idx + 1),
          ];
          pushHistory();
        }
      }
      textEditingIdxRef.current = -1;
      setTextEditing(null);
    }, [pushHistory]);

    // Double-click to finish swing path on desktop OR edit text
    const onDoubleClick = useCallback((e: React.MouseEvent) => {
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

      // Double-click/tap to edit text stroke
      const tool = activeToolRef.current;
      if (tool === 'select' || tool === 'text') {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const sx = (e.clientX - rect.left) * (canvas.width / rect.width);
        const sy = (e.clientY - rect.top) * (canvas.height / rect.height);
        const W = canvas.width;
        const H = canvas.height;
        const pos: Pt = {
          x: (sx - (W / 2 + panXRef.current)) / zoomRef.current + W / 2,
          y: (sy - (H / 2 + panYRef.current)) / zoomRef.current + H / 2,
        };
        for (let i = strokesRef.current.length - 1; i >= 0; i--) {
          const s = strokesRef.current[i];
          if (s.tool === 'text') {
            const tx = s as StrokeText;
            const bb = getTextBBox(tx);
            if (pos.x >= bb.x0 - 10 && pos.x <= bb.x1 + 10 && pos.y >= bb.y0 - 10 && pos.y <= bb.y1 + 10) {
              // Convert canvas coords back to screen coords for overlay positioning
              const logX = bb.x0;
              const logY = bb.y0;
              const screenX = ((logX - W / 2) * zoomRef.current + W / 2 + panXRef.current) * (rect.width / canvas.width);
              const screenY = ((logY - H / 2) * zoomRef.current + H / 2 + panYRef.current) * (rect.height / canvas.height);
              const scaledFontSize = tx.fontSize * zoomRef.current * (rect.height / canvas.height);
              const bbW = (bb.x1 - bb.x0) * zoomRef.current * (rect.width / canvas.width);
              textEditingIdxRef.current = i;
              setTextEditing({
                idx: i,
                left: screenX,
                top: screenY,
                width: Math.max(100, bbW + 20),
                fontSize: scaledFontSize,
                value: tx.text,
                color: tx.color,
              });
              e.preventDefault();
              return;
            }
          }
        }
      }
    }, [finishSwingPath, finishManualSwingPath]);

    const cursorFor: Partial<Record<ToolType, string>> = {
      pen: 'crosshair', erase: 'cell', text: 'text', line: 'crosshair',
      angle: 'crosshair', swingPath: 'crosshair', manualSwing: 'crosshair', ballShadow: 'crosshair',
      objectMultiplier: 'crosshair',
      zoom: isPanningRef.current
        ? 'grabbing'
        : spaceHeldRef.current
          ? 'grab'
          : zoomRef.current > 1.0 ? 'zoom-out' : 'zoom-in',
      select: zoomRef.current > 1 ? (isPanningRef.current ? 'grabbing' : 'grab') : 'default',
    };
    if (panModeEnabled && zoomRef.current > 1) {
      Object.keys(cursorFor).forEach((k) => {
        if (k === 'objectMultiplier') return;
        (cursorFor as Record<string, string>)[k] = isPanningRef.current ? 'grabbing' : 'grab';
      });
    }
    if (outlineEraserSizeRef.current > 0) {
      cursorFor.circle = 'none';
      cursorFor.bodyCircle = 'none';
      cursorFor.rect = 'none';
      cursorFor.triangle = 'none';
    }

    const onWheelCanvas = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
      if (!webcamActiveRef.current) return;
      if (!e.ctrlKey && !e.metaKey) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (canvas.height / rect.height);
      let pip = webcamPipRectRef.current;
      if (!pip.w || !pip.h) pip = defaultWebcamPipRect(canvas.width, canvas.height);
      if (x < pip.x || x > pip.x + pip.w || y < pip.y || y > pip.y + pip.h) return;
      const cx = pip.x + pip.w / 2;
      const cy = pip.y + pip.h / 2;
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      const nw = Math.max(72, Math.round(pip.w * factor));
      const nh = Math.round(nw / WEBCAM_PIP_ASPECT);
      const nx = cx - nw / 2;
      const ny = cy - nh / 2;
      webcamPipRectRef.current = clampWebcamPip({ x: nx, y: ny, w: nw, h: nh }, canvas.width, canvas.height);
      e.preventDefault();
      e.stopPropagation();
    }, []);

    const zoomControlBtnStyle: React.CSSProperties = {
      width: 36,
      height: 36,
      borderRadius: 8,
      border: 'none',
      background: 'rgba(0,0,0,0.55)',
      color: '#fff',
      fontSize: 18,
      fontWeight: 700,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      WebkitTapHighlightColor: 'transparent',
      touchAction: 'manipulation',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
    };

    return (
      <div style={{ position: 'absolute', inset: 0 }}>
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
            cursor:
              activeTool === 'objectMultiplier'
                ? 'default'
                : panModeEnabled && zoomRef.current > 1
                  ? (isPanningRef.current ? 'grabbing' : 'grab')
                  : (cursorFor[activeTool] ?? 'default'),
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onDoubleClick={onDoubleClick}
          onWheel={onWheelCanvas}
        />

        {activeTool === 'objectMultiplier' ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 25,
              touchAction: 'none',
              cursor: 'crosshair',
              pointerEvents: 'auto',
            }}
            onPointerDown={(e) => {
              if (activeToolRef.current !== 'objectMultiplier' && !isSelectingObjMultRegionRef.current) return;
              console.log('[ObjectMultiplierOverlay] pointerdown', e.pointerType, e.clientX, e.clientY);
              isSelectingObjMultRegionRef.current = true;
              objMultOverlayDownRef.current = { cx: e.clientX, cy: e.clientY };
              (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
              const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
              setObjMultOverlayPx({
                l: e.clientX - r.left,
                t: e.clientY - r.top,
                w: 0,
                h: 0,
              });
              isDraggingRef.current = true;
            }}
            onPointerMove={(e) => {
              if (!isDraggingRef.current || !objMultOverlayDownRef.current) return;
              console.log('[ObjectMultiplierOverlay] pointermove', e.clientX, e.clientY);
              const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
              const xd = objMultOverlayDownRef.current.cx - r.left;
              const yd = objMultOverlayDownRef.current.cy - r.top;
              const xn = e.clientX - r.left;
              const yn = e.clientY - r.top;
              setObjMultOverlayPx({
                l: Math.min(xd, xn),
                t: Math.min(yd, yn),
                w: Math.abs(xn - xd),
                h: Math.abs(yn - yd),
              });
            }}
            onPointerUp={(e) => {
              if (!objMultOverlayDownRef.current) {
                setObjMultOverlayPx(null);
                return;
              }
              console.log('[ObjectMultiplierOverlay] pointerup', e.pointerType, e.clientX, e.clientY);
              try {
                (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
              } catch {
                /* noop */
              }
              const s = objMultOverlayDownRef.current;
              objMultOverlayDownRef.current = null;
              setObjMultOverlayPx(null);
              const p1 = getPosFromClientXY(s.cx, s.cy);
              const p2 = getPosFromClientXY(e.clientX, e.clientY);
              commitObjectMultiplierFromPts(p1, p2);
            }}
            onPointerCancel={(e) => {
              objMultOverlayDownRef.current = null;
              setObjMultOverlayPx(null);
              isDraggingRef.current = false;
              try {
                (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
              } catch {
                /* noop */
              }
            }}
          >
            {objMultOverlayPx && objMultOverlayPx.w > 1 && objMultOverlayPx.h > 1 ? (
              <div
                style={{
                  position: 'absolute',
                  left: objMultOverlayPx.l,
                  top: objMultOverlayPx.t,
                  width: objMultOverlayPx.w,
                  height: objMultOverlayPx.h,
                  border: '2px dashed rgba(147,51,234,0.95)',
                  background: 'rgba(147,51,234,0.1)',
                  boxSizing: 'border-box',
                  pointerEvents: 'none',
                }}
              />
            ) : null}
          </div>
        ) : null}

        {/* Zoom / Pan controls — bottom-right corner above playback */}
        <div
          style={{
            position: 'absolute',
            bottom: 80,
            right: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            zIndex: 90,
            pointerEvents: 'auto',
          }}
        >
          <button
            type="button"
            onClick={() => {
              zoomRef.current = Math.min(5, zoomRef.current + 0.25);
            }}
            style={zoomControlBtnStyle}
            title="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => {
              const next = Math.max(1, zoomRef.current - 0.25);
              zoomRef.current = next;
              if (next <= 1) { panXRef.current = 0; panYRef.current = 0; }
            }}
            style={zoomControlBtnStyle}
            title="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => {
              zoomRef.current = 1.0;
              panXRef.current = 0;
              panYRef.current = 0;
            }}
            style={{
              ...zoomControlBtnStyle,
              fontSize: 14,
            }}
            title="Reset zoom & pan"
          >
            ⌂
          </button>
          {onPanModeToggle && showFinePointerPanBtn && (
            <button
              type="button"
              onClick={onPanModeToggle}
              style={{
                ...zoomControlBtnStyle,
                fontSize: 13,
                background: panModeEnabled ? 'rgba(53,103,154,0.85)' : 'rgba(0,0,0,0.55)',
                border: panModeEnabled ? '2px solid #5ba3e0' : 'none',
              }}
              title={panModeEnabled ? 'Pan mode on — click to use drawing tools' : 'Pan mode — drag the video while zoomed'}
            >
              <Hand size={20} strokeWidth={2.25} />
            </button>
          )}
        </div>
        {textEditing && (
          <textarea
            ref={textEditInputRef}
            autoFocus
            defaultValue={textEditing.value}
            style={{
              position: 'absolute',
              left: textEditing.left,
              top: textEditing.top,
              width: textEditing.width,
              minHeight: textEditing.fontSize * 1.4,
              fontSize: textEditing.fontSize,
              fontWeight: 'bold',
              fontFamily: 'Inter, sans-serif',
              color: textEditing.color,
              background: 'rgba(0,0,0,0.65)',
              border: '2px solid #FFD700',
              borderRadius: 4,
              padding: '2px 4px',
              outline: 'none',
              resize: 'none',
              zIndex: 9999,
              lineHeight: 1.25,
              whiteSpace: 'pre-wrap',
              overflow: 'auto',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                textEditingIdxRef.current = -1;
                setTextEditing(null);
              }
            }}
            onBlur={commitTextEdit}
          />
        )}
      </div>
    );
  },
);

export default CanvasOverlay;
