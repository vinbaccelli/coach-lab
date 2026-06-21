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
import { getPoseDetector } from '@/lib/poseDetection';
import { HelpCircle } from 'lucide-react';
import { renderStroMotionComposite, exportStroMotionVideo, canvasSupportsVideoExport, temporalGhostOpacity, hashCanvasContent, recordExportParity, setStroMotionPreviewHash, type StroMotionResult, type StroMotionSubjectBox } from '@/lib/stroMotion';
import { renderStroMotionDraftComposite, captureVideoFrameAtTime, type StroMotionDraft } from '@/lib/stroMotionDraft';
import type { ContextualStyleSnapshot } from '@/components/ContextualStyleBar';

/** Poll interval while waiting for a ref-backed <video> to mount. */
const WEBCAM_VIDEO_REF_RETRY_MS = 50;
const WEBCAM_VIDEO_REF_RETRY_MAX = 200;

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
/** Vertical offset (screen px) from finger to precision crosshair — tuned for one-handed phones */
const PRECISION_CURSOR_OFFSET_Y = 120;
/** Fade-out duration when anchor finger lifts (ms) */
const PRECISION_CURSOR_FADE_MS = 220;
/** Ripple duration at synthetic click (ms) */
const PRECISION_RIPPLE_MS = 420;

// ── Types ──────────────────────────────────────────────────────────────────

type Pt = { x: number; y: number };

interface StrokePen     { tool: 'pen';                              pts: Pt[]; color: string; lw: number; opacity?: number; dashed?: boolean; spinning?: boolean; eraserStrokes?: EraserDot[] }
interface StrokeLine    { tool: 'line';                             p1: Pt; p2: Pt; color: string; lw: number; opacity?: number; dashed?: boolean; spinning?: boolean; eraserStrokes?: EraserDot[] }
interface StrokeArrow   { tool: 'arrow' | 'arrowAngle';             p1: Pt; p2: Pt; color: string; lw: number; opacity?: number; dashed?: boolean; spinning?: boolean; eraserStrokes?: EraserDot[] }
type EraserDot = { x: number; y: number; radius: number };
interface StrokeEllipse {
  tool: 'circle' | 'bodyCircle';
  cx: number; cy: number; rx: number; ry: number;
  color: string; lw: number; opacity?: number; dashed?: boolean;
  spinning?: boolean;
  spinSpeed?: number;
  eraserStrokes?: EraserDot[];
}
interface StrokeRect {
  tool: 'rect';
  cx: number; cy: number; rx: number; ry: number;
  color: string; lw: number; opacity?: number; dashed?: boolean;
  spinning?: boolean;
  eraserStrokes?: EraserDot[];
}
interface StrokeTriangle {
  tool: 'triangle';
  cx: number; cy: number; rx: number; ry: number;
  color: string; lw: number; opacity?: number; dashed?: boolean;
  spinning?: boolean;
  eraserStrokes?: EraserDot[];
}
interface StrokeSwing   { tool: 'swingPath' | 'manualSwing';        pts: Pt[]; color: string; lw: number; dashed?: boolean; arrowAtEnd?: boolean; spinning?: boolean }
interface StrokeJointChain {
  tool: 'jointChain';
  nodes: Pt[];
  color: string;
  lw: number;
  opacity?: number;
  dashed?: boolean;
  /** Animated kinetic-flow along the chain (dashed flow + pulsing joint balls). */
  spinning?: boolean;
}
interface StrokeText    { tool: 'text';                             pos: Pt; text: string; color: string; fontSize: number }

type Stroke = StrokePen | StrokeLine | StrokeArrow | StrokeEllipse | StrokeRect | StrokeTriangle | StrokeSwing | StrokeJointChain | StrokeText;

interface AngleMeas {
  v: Pt; p1: Pt; p2: Pt; deg: number;
  color?: string; lw?: number; opacity?: number;
  dashed?: boolean; spinning?: boolean;
}
interface LiveAngle { phase: 1 | 2; v: Pt; p1: Pt; cursor: Pt }

type Selection =
  | { kind: 'stroke'; idx: number; start: Pt; orig: Stroke }
  | { kind: 'angle'; idx: number; start: Pt; orig: AngleMeas }
  | { kind: 'jointNode'; idx: number; nodeIdx: number; start: Pt; orig: StrokeJointChain }
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
  /** Begin rubber-band region selection for StroMotion; callback receives region in video-normalized 0..1 coords, or null if cancelled/too small */
  startStroMotionRegionSelect: (cb: (region: { x: number; y: number; w: number; h: number } | null) => void) => void;
  /** Cancel an in-progress StroMotion region selection; fires the pending callback with null */
  cancelStroMotionRegionSelect: () => void;
  /** Enable skeleton click-to-focus mode (next click on video sets focus point) */
  setSkeletonWaitingForClick: (v: boolean) => void;
  resetCropZoom: () => void;
  /** Crop region (canvas-normalized 0..1) for export/recording */
  getCropRegion: () => { x: number; y: number; w: number; h: number } | null;
  clearCropRegion: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoomPan: () => void;
  startObjMultiplierRegionSelect: () => void;
  getObjMultiplierRegion: () => { x: number; y: number; w: number; h: number } | null;
  runObjMultiplierCapture: (frameCount: number, onProgress?: (done: number, total: number) => void) => Promise<number>;
  clearObjMultiplier: () => void;
  getObjMultiplierFrameCount: () => number;
  /** Wait until the next canvas paint completes */
  waitForRender: () => Promise<void>;
  /**
   * Stamp auto-generated angle/line measurements from skeleton keypoints onto
   * the drawing canvas. Each line/angle is a regular editable stroke/angle-meas.
   * Keypoints use MediaPipe pixel coords (relative to videoNativeW/H).
   */
  stampAutoMeasurements: (
    keypoints: Array<{ x: number; y: number; score: number; name: string }>,
    videoNativeW: number,
    videoNativeH: number,
  ) => void;
  /** Export current strokes as a serializable JSON array for per-frame persistence */
  exportStrokes: () => string;
  /** Import strokes from a previously exported JSON string, replacing current strokes */
  importStrokes: (json: string) => void;
  /** Record animated Stromotion build-up to a downloadable video (Chrome/desktop) */
  exportStroMotionVideo: () => Promise<{ ok: boolean; reason?: string; blob?: Blob; url?: string }>;
  canvasSupportsStroMotionVideoExport: () => boolean;
  /** Set visible ghost count immediately (bypasses React prop lag for export) */
  setStroMotionVisibleCount: (count: number | undefined) => void;
  /** Force canvas preview mode on/off immediately (bypasses React prop lag during video export) */
  setStroMotionCanvasPreview: (on: boolean) => void;
}

// ── Props ──────────────────────────────────────────────────────────────────

export interface CanvasProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  webcamVideoRef?: React.RefObject<HTMLVideoElement | null>;
  /** When false, Canvas does NOT draw the video frame (overlay-only). */
  renderVideo?: boolean;
  /** Uploaded HTML5 file plays in a native <video> under this canvas — skip canvas video compositing. */
  nativeVideoUnderlay?: boolean;
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
  onSkeletonFocusSet?: () => void;
  /** Called when a drawing measurement is committed (angle, ruler, etc.) */
  onMeasurementCommit?: (measurement: { type: 'angle' | 'ruler' | 'arrowAngle'; value: number; unit: string }) => void;
  /** Measurements to render in the right-side column overlay */
  measurementColumnItems?: Array<{ id: string; label: string; value: number; unit: string }> | null;
  /** Position of the measurement column (normalized 0-1). Default: top-right */
  measurementColumnPos?: { x: number; y: number };
  onMeasurementColumnDrag?: (pos: { x: number; y: number }) => void;
  onMeasurementAdd?: () => void;
  onMeasurementRemoveLast?: () => void;
  /** When true, skeleton click-to-focus works even when skeleton isn't the active tool */
  skeletonKeepAlive?: boolean;
  /** When true, skeleton is locked on player — clicks don't change focus */
  skeletonLocked?: boolean;
  isRecording?: boolean;
  circleSpinning?: boolean;
  outlineEraserSize?: number;
  onOutlineEraserSizeChange?: (size: number) => void;
  webcamPipMode?: WebcamPipMode;
  webcamOpacity?: number;
  stroMotionResult?: StroMotionResult | null;
  /** Coach-editable draft — preferred over raw result when present */
  stroMotionDraft?: StroMotionDraft | null;
  /** When false, always paint the live video even if StroMotion output exists */
  stroMotionCanvasPreview?: boolean;
  /** When true, composite uses export-ready masks only (post-Generate). */
  stroMotionUseExportMasks?: boolean;
  /** Background plate selection for composite ('start' = first frame, 'end' = last frame). */
  stroMotionBackground?: 'start' | 'end';
  /** Animation order for composite frames. */
  stroMotionVideoOrder?: 'forward' | 'reverse';
  /** End-frame bitmap — required when stroMotionBackground === 'end'. */
  stroMotionEndPlate?: ImageBitmap | null;
  /** Subject box preview before generate (video-normalized 0..1) */
  stroMotionSubjectBox?: StroMotionSubjectBox | null;
  /** Per-frame object boxes during coach verification */
  stroMotionFrameStops?: Array<{
    box: StroMotionSubjectBox;
    active: boolean;
    autoDetected: boolean;
    userConfirmed: boolean;
  }> | null;
  stroMotionVisibleCount?: number;
  /** Overlay skeleton on each StroMotion ghost position */
  stroMotionShowSkeleton?: boolean;
  skeletonShowAngles?: boolean;
  skeletonShowHeadLine?: boolean;
  skeletonClassicColors?: boolean;
  skeletonParts?: SkeletonPartVisibility;
  ballSampleMode?: boolean;
  /** When videoRef has no playable video (e.g. YouTube embed), keep canvas transparent */
  transparentWhenNoVideo?: boolean;
  /** Changes when the HTML video src changes — triggers first-frame redraw */
  videoSourceKey?: string | null;
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
  /** Mobile: DOM PiP layer above playback controls for touch + visibility. */
  webcamPipMobileChrome?: boolean;
  /** Keep PiP above playback dock (logical canvas px). */
  webcamPipBottomInsetPx?: number;
  /**
   * Precision draw: crosshair offset (touch) and visible cursor; second-finger tap injects at crosshair.
   * Zoom / object-multiplier bypass precision routing.
   */
  precisionTouchDraw?: boolean;
  /** Fires after a drawable shape is committed — parent opens toolbar draw-context mode. */
  onDrawCommitted?: () => void;
  poseFrameSkip?: number;
  /** When true, one-finger touch / click-drag pans the canvas instead of drawing */
  panModeEnabled?: boolean;
  /** Callback to toggle pan mode from the on-canvas UI */
  onPanModeToggle?: () => void;
  /** When true, render guided-tour ? at top of zoom cluster (analysis mobile/desktop). */
  showTourHelpInZoomCluster?: boolean;
  /** Fires when a region is selected in objectMultiplier mode */
  onObjMultiplierRegionSelected?: () => void;
}

const WEBCAM_PIP_ASPECT = 11 / 9;
const WEBCAM_PIP_HANDLE = 16;
/** Invisible hit target for corner resize (larger than visible handle). */
const WEBCAM_PIP_HANDLE_HIT = 24;

function clampWebcamPip(
  p: { x: number; y: number; w: number; h: number },
  cw: number,
  ch: number,
  bottomInset = 0,
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
  const maxY = Math.max(0, ch - h - bottomInset);
  x = Math.max(0, Math.min(cw - w, x));
  y = Math.max(0, Math.min(maxY, y));
  return { x, y, w, h };
}

function defaultWebcamPipRect(cw: number, ch: number, bottomInset = 0) {
  const margin = 12;
  const w = Math.round(cw * 0.18);
  const h = Math.round(w / WEBCAM_PIP_ASPECT);
  const y = Math.max(margin, ch - h - margin - bottomInset);
  return clampWebcamPip({ x: cw - w - margin, y, w, h }, cw, ch, bottomInset);
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
  const jointRadius = Math.max(3, Math.min(8, Math.round(Math.min(canvasW, canvasH) / 150)));
  const scoreThreshold = 0.2;

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
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 2;

  // Draw limb + structural bones in solid yellow (or blue monochrome in alternative mode)
  ctx.strokeStyle = classicColors ? '#FFD700' : '#007AFF';
  ctx.lineWidth = classicColors ? 2.5 : 2;

  for (const [a, b] of [...LIMB_BONES, ...STRUCT_BONES]) {
    if (!isJointVisible(a, parts, keypoints[a]?.name) || !isJointVisible(b, parts, keypoints[b]?.name)) continue;
    const ka = keypoints[a];
    const kb = keypoints[b];
    if (!ka || !kb || ka.score < scoreThreshold || kb.score < scoreThreshold) continue;
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
    lShoulder.score >= scoreThreshold && rShoulder.score >= scoreThreshold &&
    lHip.score >= scoreThreshold && rHip.score >= scoreThreshold
  ) {
    const midShoulderX = ((lShoulder.x + rShoulder.x) / 2) * sx;
    const midShoulderY = ((lShoulder.y + rShoulder.y) / 2) * sy;
    const midHipX = ((lHip.x + rHip.x) / 2) * sx;
    const midHipY = ((lHip.y + rHip.y) / 2) * sy;
    ctx.save();
    ctx.strokeStyle = classicColors ? '#39FF14' : '#007AFF';
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
      .filter((kp) => kp && kp.score >= scoreThreshold)
      .map((kp) => kp.y * sy);
    if (ys.length > 0) {
      const headY = Math.min(...ys);
      ctx.save();
      ctx.strokeStyle = classicColors ? '#39FF14' : '#007AFF';
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
      if (!knee || !ankle || knee.score < scoreThreshold || ankle.score < scoreThreshold) continue;
      const kx = knee.x  * sx, ky = knee.y  * sy;
      const ax = ankle.x * sx, ay = ankle.y * sy;
      const dist = Math.hypot(ax - kx, ay - ky);
      if (dist < 1) continue;
      const dx2 = (ax - kx) / dist;
      const dy2 = (ay - ky) / dist;
      const ext = dist * 0.4;
      ctx.save();
      ctx.strokeStyle = classicColors ? '#FFD700' : '#007AFF';
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
    if (!kp || kp.score < scoreThreshold) continue;
    ctx.beginPath();
    ctx.arc(kp.x * sx, kp.y * sy, jointRadius, 0, Math.PI * 2);
    if (classicColors) {
      ctx.fillStyle = i % 2 === 0 ? '#FF4444' : '#4488FF';
    } else {
      ctx.fillStyle = '#007AFF';
    }
    ctx.fill();
    if (classicColors) {
      ctx.strokeStyle = i % 2 === 0 ? '#FF4444' : '#4488FF';
    } else {
      ctx.strokeStyle = '#234978';
    }
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  if (showAngles) {
    const ANGLE_DEFS: { indices: [number, number, number]; label: string }[] = [
      { indices: [7, 5, 9], label: 'L Elbow' },
      { indices: [8, 6, 10], label: 'R Elbow' },
      { indices: [13, 11, 15], label: 'L Knee' },
      { indices: [14, 12, 16], label: 'R Knee' },
    ];

    // Find rightmost keypoint to position the measurement column
    let maxX = 0;
    for (const kp of keypoints) {
      if (kp && kp.score >= scoreThreshold) maxX = Math.max(maxX, kp.x * sx);
    }
    const colX = Math.min(maxX + 50, canvasW - 110);
    let colY = 0;
    // Find top of player
    for (const kp of keypoints) {
      if (kp && kp.score >= scoreThreshold && (colY === 0 || kp.y * sy < colY)) colY = kp.y * sy;
    }
    colY = Math.max(10, colY - 10);

    const measurements: { name: string; value: string }[] = [];

    for (const { indices: [vi, ai, bi], label } of ANGLE_DEFS) {
      if (!isJointVisible(vi, parts, keypoints[vi]?.name) || !isJointVisible(ai, parts, keypoints[ai]?.name) || !isJointVisible(bi, parts, keypoints[bi]?.name)) continue;
      const v = keypoints[vi];
      const a = keypoints[ai];
      const b = keypoints[bi];
      if (!v || !a || !b || v.score < scoreThreshold || a.score < scoreThreshold || b.score < scoreThreshold) continue;

      const vx = v.x * sx, vy = v.y * sy;
      const ax = a.x * sx, ay = a.y * sy;
      const bx = b.x * sx, by = b.y * sy;

      const v1 = { x: ax - vx, y: ay - vy };
      const v2 = { x: bx - vx, y: by - vy };
      const dot = v1.x * v2.x + v1.y * v2.y;
      const mag = Math.sqrt(v1.x ** 2 + v1.y ** 2) * Math.sqrt(v2.x ** 2 + v2.y ** 2);
      if (mag < 1) continue;

      const deg = Math.round(Math.acos(Math.min(1, Math.max(-1, dot / mag))) * 180 / Math.PI);

      // Draw thin line from joint to column
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(vx, vy);
      ctx.lineTo(colX, colY + measurements.length * 22 + 8);
      ctx.stroke();
      ctx.setLineDash([]);

      measurements.push({ name: label, value: `${deg}°` });
    }

    // Draw measurement column panel
    if (measurements.length > 0) {
      const panelH = measurements.length * 22 + 12;
      const panelW = 90;

      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 4;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.beginPath();
      ctx.roundRect(colX - 4, colY - 6, panelW, panelH, 8);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.font = 'bold 11px -apple-system, sans-serif';
      for (let i = 0; i < measurements.length; i++) {
        const y = colY + i * 22 + 12;
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillText(measurements[i].name, colX + 2, y);
        ctx.fillStyle = classicColors ? '#FFD700' : '#93C5FD';
        ctx.font = 'bold 13px -apple-system, sans-serif';
        ctx.fillText(measurements[i].value, colX + 55, y);
        ctx.font = 'bold 11px -apple-system, sans-serif';
      }
    }
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
  spinning = false,
): void {
  if (points.length < 2) return;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (spinning) {
    ctx.setLineDash([3, 10]);
    ctx.lineDashOffset = -((Date.now() / 20) % 1000);
  } else if (dashed) ctx.setLineDash([8, 6]);

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

function drawJointChainStroke(
  ctx: CanvasRenderingContext2D,
  s: StrokeJointChain,
  _animFrame: number,
): void {
  const { nodes, color, lw, dashed, spinning } = s;
  if (nodes.length === 0) return;

  ctx.save();
  const alpha = strokeOpacity(s);

  if (nodes.length >= 2) {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'miter';
    if (spinning) {
      ctx.setLineDash([3, 10]);
      ctx.lineDashOffset = -((Date.now() / 20) % 1000);
    } else if (dashed) {
      ctx.setLineDash([8, 6]);
    } else {
      ctx.setLineDash([]);
    }
    ctx.beginPath();
    ctx.moveTo(nodes[0].x, nodes[0].y);
    for (let i = 1; i < nodes.length; i++) {
      ctx.lineTo(nodes[i].x, nodes[i].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const baseR = Math.max(JOINT_NODE_RADIUS, lw * 1.5 + 4);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const pulse = spinning ? 1 + 0.1 * Math.sin(Date.now() / 110 + i * 0.75) : 1;
    const r = baseR * pulse;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
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

function drawThickSegmentWithEraser(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  eraser: EraserDot[] | undefined,
): void {
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 0.25) return;
  if (!eraser?.length) {
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    return;
  }
  const steps = Math.max(16, Math.ceil(len / 2));
  let inStroke = false;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = ax + (bx - ax) * t;
    const py = ay + (by - ay) * t;
    if (isErasedAt(px, py, eraser)) {
      if (inStroke) {
        ctx.stroke();
        inStroke = false;
      }
    } else if (!inStroke) {
      ctx.beginPath();
      ctx.moveTo(px, py);
      inStroke = true;
    } else {
      ctx.lineTo(px, py);
    }
  }
  if (inStroke) ctx.stroke();
}

function strokeHasSpinning(s: Stroke | null | undefined): boolean {
  if (!s) return false;
  return (s as { spinning?: boolean }).spinning === true;
}

function strokeOpacity(s: { opacity?: number }): number {
  const o = s.opacity;
  return o !== undefined && o > 0 ? Math.min(1, o) : 1;
}

const CONTEXTUAL_STROKE_TOOLS = new Set([
  'line', 'arrow', 'arrowAngle', 'circle', 'bodyCircle', 'rect', 'triangle', 'jointChain',
]);

/** Visual radius of a joint ball (logical px). */
const JOINT_NODE_RADIUS = 8;
/** Hit target for dragging a joint (touch gets a larger target). */
const JOINT_NODE_HIT_TOUCH = 24;
const JOINT_NODE_HIT_POINTER = 16;

function isContextualStrokeTool(tool: string): boolean {
  return CONTEXTUAL_STROKE_TOOLS.has(tool);
}

type ContextualTarget =
  | { kind: 'stroke'; idx: number }
  | { kind: 'angle'; idx: number };

const DEFAULT_CONTEXTUAL_SNAPSHOT: ContextualStyleSnapshot = {
  color: '#FFFFFF',
  lineWidth: 3,
  opacity: 1,
  dashed: false,
  spinning: false,
  outlineEraserEnabled: false,
  outlineEraserSize: 0,
};

const ZOOM_MIN = 1;
const ZOOM_MAX = 5;
/** Trackpad-friendly wheel zoom gain (exp(delta * gain)). */
const ZOOM_WHEEL_GAIN = 0.0011;
const ZOOM_BUTTON_STEP = 0.2;

/** Keep pan inside the zoomed video rect — no letterbox gutters, full edge reach. */
function clampPanToLetterbox(
  panX: number,
  panY: number,
  zoom: number,
  W: number,
  H: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): { x: number; y: number } {
  if (zoom <= ZOOM_MIN + 0.001 || dw <= 1 || dh <= 1) {
    return { x: 0, y: 0 };
  }

  const clampAxis = (
    pan: number,
    origin: number,
    size: number,
    viewport: number,
  ): number => {
    const leading = (origin - viewport / 2) * zoom + viewport / 2;
    const trailing = (origin + size - viewport / 2) * zoom + viewport / 2;
    const panMax = -leading;
    const panMin = viewport - trailing;
    // When span <= viewport, panMax < panMin — valid slide range is [panMax, panMin].
    const lo = Math.min(panMax, panMin);
    const hi = Math.max(panMax, panMin);
    return Math.max(lo, Math.min(hi, pan));
  };

  return {
    x: clampAxis(panX, dx, dw, W),
    y: clampAxis(panY, dy, dh, H),
  };
}

function applyZoomPanAt(
  zoomRef: { current: number },
  panXRef: { current: number },
  panYRef: { current: number },
  videoBounds: { dx: number; dy: number; dw: number; dh: number },
  W: number,
  H: number,
  nextZoom: number,
  focalX: number,
  focalY: number,
): void {
  const oldZoom = zoomRef.current;
  const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, nextZoom));
  if (Math.abs(z - oldZoom) < 0.0001) return;

  if (z <= ZOOM_MIN + 0.001) {
    zoomRef.current = ZOOM_MIN;
    panXRef.current = 0;
    panYRef.current = 0;
    return;
  }

  const lx = (focalX - W / 2 - panXRef.current) / oldZoom + W / 2;
  const ly = (focalY - H / 2 - panYRef.current) / oldZoom + H / 2;
  zoomRef.current = z;
  panXRef.current = focalX - (lx - W / 2) * z - W / 2;
  panYRef.current = focalY - (ly - H / 2) * z - H / 2;
  const c = clampPanToLetterbox(
    panXRef.current,
    panYRef.current,
    z,
    W,
    H,
    videoBounds.dx,
    videoBounds.dy,
    videoBounds.dw,
    videoBounds.dh,
  );
  panXRef.current = c.x;
  panYRef.current = c.y;
}

function drawCircleStroke(
  ctx: CanvasRenderingContext2D,
  s: StrokeEllipse,
  _animFrame: number,
): void {
  ctx.save();
  ctx.globalAlpha = strokeOpacity(s);
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
  ctx.globalAlpha = strokeOpacity(s);
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

  ctx.restore();
}

function drawTriangleStroke(
  ctx: CanvasRenderingContext2D,
  s: StrokeTriangle,
  _animFrame: number,
): void {
  ctx.save();
  ctx.globalAlpha = strokeOpacity(s);
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

  ctx.restore();
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, animFrame = 0): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.tool !== 'text') {
    ctx.globalAlpha = strokeOpacity(s as { opacity?: number });
  }

  if (s.tool === 'pen') {
    const sp = s as StrokePen;
    const { pts, color, lw, dashed, spinning, eraserStrokes } = sp;
    if (pts.length === 0) { ctx.restore(); return; }
    if (pts.length === 1) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, lw / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      if (spinning) {
        ctx.setLineDash([3, 10]);
        ctx.lineDashOffset = -((Date.now() / 20) % 1000);
      } else if (dashed) ctx.setLineDash([8, 6]);
      for (let i = 0; i < pts.length - 1; i++) {
        drawThickSegmentWithEraser(ctx, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, eraserStrokes);
      }
      ctx.setLineDash([]);
    }

  } else if (s.tool === 'line') {
    const sl = s as StrokeLine;
    const { p1, p2, color, lw, dashed, spinning, eraserStrokes } = sl;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    if (spinning) {
      ctx.setLineDash([3, 10]);
      ctx.lineDashOffset = -((Date.now() / 20) % 1000);
    } else if (dashed) ctx.setLineDash([8, 6]);
    drawThickSegmentWithEraser(ctx, p1.x, p1.y, p2.x, p2.y, eraserStrokes);
    ctx.setLineDash([]);

  } else if (s.tool === 'swingPath' || s.tool === 'manualSwing') {
    const sw = s as StrokeSwing;
    drawSmoothPath(ctx, sw.pts, sw.color, sw.lw, 1, sw.dashed ?? false, sw.arrowAtEnd === true, sw.spinning === true);
    ctx.restore();
    return;

  } else if (s.tool === 'jointChain') {
    ctx.restore();
    drawJointChainStroke(ctx, s as StrokeJointChain, animFrame);
    return;

  } else if (s.tool === 'arrow' || s.tool === 'arrowAngle') {
    const sa = s as StrokeArrow;
    const { p1, p2, color, lw, dashed, spinning, eraserStrokes } = sa;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    if (spinning) {
      ctx.setLineDash([3, 10]);
      ctx.lineDashOffset = -((Date.now() / 20) % 1000);
    } else if (dashed) ctx.setLineDash([8, 6]);
    drawThickSegmentWithEraser(ctx, p1.x, p1.y, p2.x, p2.y, eraserStrokes);
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
  const color = m.color ?? '#FFD700';
  const lw = m.lw ?? 2;
  const a1 = Math.atan2(p1.y - v.y, p1.x - v.x);
  const a2 = Math.atan2(p2.y - v.y, p2.x - v.x);
  const alpha = strokeOpacity(m);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  if (m.spinning) {
    ctx.setLineDash([3, 10]);
    ctx.lineDashOffset = -((Date.now() / 20) % 1000);
  } else if (m.dashed) {
    ctx.setLineDash([8, 6]);
  }
  ctx.beginPath();
  ctx.moveTo(v.x, v.y);
  ctx.arc(v.x, v.y, 30, a1, a2, false);
  ctx.closePath();
  ctx.globalAlpha = alpha * 0.12;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = alpha;
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
      nativeVideoUnderlay = false,
      activeTool,
      drawingOptions,
      containerWidth,
      containerHeight,
      ballTrailMode = 'comet',
      skeletonEnabled = false,
      skeletonDrawEnabled = true,
      ballTrailEnabled = false,
      onProcessingStatus,
      onSkeletonFocusSet,
      onMeasurementCommit,
      measurementColumnItems,
      measurementColumnPos,
      onMeasurementColumnDrag,
      onMeasurementAdd,
      onMeasurementRemoveLast,
      skeletonKeepAlive = false,
      skeletonLocked = false,
      isRecording = false,
      circleSpinning = false,
      outlineEraserSize = 0,
      onOutlineEraserSizeChange,
      webcamPipMode = 'rectangle',
      webcamOpacity = 1,
      stroMotionResult,
      stroMotionDraft,
      stroMotionCanvasPreview = false,
      stroMotionUseExportMasks = false,
      stroMotionBackground = 'start',
      stroMotionVideoOrder = 'forward',
      stroMotionEndPlate,
      stroMotionSubjectBox,
      stroMotionFrameStops,
      stroMotionVisibleCount,
      stroMotionShowSkeleton = false,
      skeletonShowAngles = true,
      skeletonShowHeadLine = false,
      skeletonClassicColors = true,
      skeletonParts,
      ballSampleMode = false,
      transparentWhenNoVideo = false,
      videoSourceKey = null,
      youtubePose,
      suppressTabCaptureMirror = false,
      webcamCutout = false,
      webcamActive = false,
      webcamPipMobileChrome = false,
      webcamPipBottomInsetPx = 0,
      precisionTouchDraw = false,
      onDrawCommitted,
      poseFrameSkip = 0,
      panModeEnabled = false,
      onPanModeToggle,
      onObjMultiplierRegionSelected,
      showTourHelpInZoomCluster = false,
    },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const watermarkRef = useRef<HTMLImageElement | null>(null);
    const watermarkLoadedRef = useRef(false);
    const measurementColumnRef = useRef<Array<{ id: string; label: string; value: number; unit: string }> | null>(null);
    const mcPosRef = useRef<{ x: number; y: number }>({ x: 0.85, y: 0.02 });
    const mcDraggingRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
    const skeletonWaitingForClickRef = useRef(false);
    const skeletonKeepAliveRef = useRef(skeletonKeepAlive);
    useEffect(() => { skeletonKeepAliveRef.current = skeletonKeepAlive; }, [skeletonKeepAlive]);
    const skeletonLockedRef = useRef(skeletonLocked);
    useEffect(() => { skeletonLockedRef.current = skeletonLocked; }, [skeletonLocked]);
    const onMeasurementCommitRef = useRef(onMeasurementCommit);
    useEffect(() => { onMeasurementCommitRef.current = onMeasurementCommit; }, [onMeasurementCommit]);
    const onMeasurementAddRef = useRef(onMeasurementAdd);
    useEffect(() => { onMeasurementAddRef.current = onMeasurementAdd; }, [onMeasurementAdd]);
    const onMeasurementRemoveLastRef = useRef(onMeasurementRemoveLast);
    useEffect(() => { onMeasurementRemoveLastRef.current = onMeasurementRemoveLast; }, [onMeasurementRemoveLast]);

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
        precisionHoverActiveRef.current = false;
      } else {
        precisionHoverActiveRef.current = true;
        precisionFadeStartRef.current = null;
      }
    }, [precisionTouchDraw]);
    const precisionAnchorPointerIdRef = useRef<number | null>(null);
    const precisionCrosshairTargetRef = useRef<Pt | null>(null);
    const precisionCrosshairDisplayRef = useRef<Pt | null>(null);
    const precisionFadeStartRef = useRef<number | null>(null);
    const precisionRippleRef = useRef<{ x: number; y: number; t0: number } | null>(null);
    /** Mouse/pen hover: show crosshair without touch anchor. */
    const precisionHoverActiveRef = useRef(false);
    const onDrawCommittedRef = useRef(onDrawCommitted);
    useEffect(() => {
      onDrawCommittedRef.current = onDrawCommitted;
    }, [onDrawCommitted]);
    /** Precision second-finger tap → synchronous commit at the crosshair. */
    const precisionCommitRef = useRef<((ch: Pt) => void) | null>(null);

    // Dragging circle
    const selectionRef     = useRef<Selection>(null);

    // Text editing state
    const textEditingIdxRef = useRef<number>(-1);
    const textEditInputRef  = useRef<HTMLTextAreaElement | null>(null);
    const [textEditing, setTextEditing] = useState<{
      idx: number; left: number; top: number; width: number; fontSize: number; value: string; color: string;
    } | null>(null);
    const [newTextDraft, setNewTextDraft] = useState<{
      pos: Pt; left: number; top: number; fontSize: number; color: string;
    } | null>(null);
    const newTextInputRef = useRef<HTMLTextAreaElement | null>(null);
    const [angleUiPhase, setAngleUiPhase] = useState<0 | 1 | 2>(0);
    const [jointChainUiActive, setJointChainUiActive] = useState(false);

    const contextualTargetRef = useRef<ContextualTarget | null>(null);
    const [contextualOpen, setContextualOpen] = useState(false);
    const [contextualAnchor, setContextualAnchor] = useState({ x: 0, y: 0 });
    const [contextualSnapshot, setContextualSnapshot] = useState<ContextualStyleSnapshot>(
      DEFAULT_CONTEXTUAL_SNAPSHOT,
    );
    /** CSS-pixel selection rect on the object-multiplier overlay (relative to overlay box). */
    const [objMultOverlayPx, setObjMultOverlayPx] = useState<{ l: number; t: number; w: number; h: number } | null>(null);
    const objMultOverlayDownRef = useRef<{ cx: number; cy: number } | null>(null);
    const lastTextTapRef = useRef<{ idx: number; t: number; x: number; y: number } | null>(null);

    // Outline eraser: tracks which shape is being erased and the cursor position
    const outlineErasingIdxRef = useRef<number>(-1);
    const outlineEraserPosRef  = useRef<Pt | null>(null);

    // Racket multiplier trail
    const racketTrailRef   = useRef<RacketTrail | null>(null);

    // Real-time skeleton detection (HTML5 bridge path)
    const youtubePoseDetectorRef = useRef<Awaited<ReturnType<typeof getPoseDetector>> | null>(null);
    const latestKeypointsRef  = useRef<Array<{ x: number; y: number; score: number; name: string }> | null>(null);
    const poseLoopActiveRef   = useRef(false);
    const skeletonFramesRef   = useRef<Array<{ timeSeconds: number; keypoints: Array<{ x: number; y: number; score: number; name: string }> }>>([]);
    // When true, skeleton overlay + detection is temporarily suppressed (e.g. after Clear All / Undo).
    const skeletonSuppressedRef = useRef(false);
    const poseBridgeRef = useRef<PoseWorkerBridge | null>(null);
    const renderDirtyRef = useRef(true);
    const renderWaitersRef = useRef<Array<() => void>>([]);
    const lastRenderVideoTimeRef = useRef(-1);
    const lastRenderZoomRef = useRef(1);
    const lastRenderPanRef = useRef({ x: 0, y: 0 });
    // Frame-accurate "a new video frame was presented" signal. currentTime
    // advances continuously while playing, so it cannot gate to the decoded
    // frame rate; requestVideoFrameCallback fires once per presented frame
    // (playback and seek-while-paused). videoFrameRvfcActiveRef tells the render
    // loop whether RVFC is driving us (so the currentTime delta is only used as
    // a fallback on browsers without RVFC).
    const videoFrameDirtyRef = useRef(false);
    const videoFrameRvfcActiveRef = useRef(false);

    // Real-time ball detection
    const isBallDetectingRef  = useRef(false);
    const ballTrackRef        = useRef<Array<{ timeSeconds: number; x: number; y: number }>>([]);
    const ballDetectRef       = useRef<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null>(null);
    const ballColorRef = useRef<{ hMin: number; hMax: number } | null>(null);

    // Legacy AI detection caches (for manual ball shadow tool)
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
    const stroMotionResultRef = useRef<StroMotionResult | null>(stroMotionResult ?? null);
    const stroMotionDraftRef = useRef<StroMotionDraft | null>(stroMotionDraft ?? null);
    const stroMotionCanvasPreviewRef = useRef(stroMotionCanvasPreview);
    const stroMotionUseExportMasksRef = useRef(stroMotionUseExportMasks);
    const stroMotionBackgroundRef = useRef(stroMotionBackground);
    const stroMotionVideoOrderRef = useRef(stroMotionVideoOrder);
    const stroMotionEndPlateRef = useRef<ImageBitmap | null>(stroMotionEndPlate ?? null);
    // Overlay mode: ghost frames drawn over live video (no background plate). Used during video export.
    const stroMotionOverlayModeRef = useRef(false);
    const stroMotionSubjectBoxRef = useRef<StroMotionSubjectBox | null>(stroMotionSubjectBox ?? null);
    const stroMotionFrameStopsRef = useRef(stroMotionFrameStops ?? null);
    const stroMotionVisibleCountRef = useRef(stroMotionVisibleCount);
    const stroMotionShowSkeletonRef = useRef(stroMotionShowSkeleton);
    const skeletonShowAnglesRef   = useRef(skeletonShowAngles);
    const skeletonShowHeadLineRef = useRef(skeletonShowHeadLine);
    const skeletonClassicColorsRef = useRef(skeletonClassicColors);
    const skeletonPartsRef = useRef(skeletonParts);
    const ballSampleModeRef = useRef(ballSampleMode);
    const transparentWhenNoVideoRef = useRef(transparentWhenNoVideo);
    const renderVideoRef = useRef(renderVideo);
    const nativeVideoUnderlayRef = useRef(nativeVideoUnderlay);
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
      if (activeTool !== 'objectMultiplier') {
        setObjMultOverlayPx(null);
        objMultOverlayDownRef.current = null;
      }
    }, [activeTool]);

    const webcamCutoutRef = useRef(false);
    const webcamSegmenterRef = useRef<{ dispose: () => void } | null>(null);
    const webcamMaskRef = useRef<HTMLCanvasElement | null>(null);
    const webcamActiveRef = useRef(webcamActive);
    // Set true when a new webcam frame (or a fresh cutout mask) is available so
    // the render loop composites at the webcam's fps instead of display rate.
    const webcamFrameDirtyRef = useRef(false);
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
    const webcamPipSelectedRef = useRef(false);
    const webcamPipHoveredRef = useRef(false);
    const webcamPinchRef = useRef<{ dist: number; w: number; cx: number; cy: number } | null>(null);
    // ── Unified input pipeline state ─────────────────────────────────────────
    // Single record of every live pointer (reconstructs multi-touch from
    // concurrent pointer events — touchAction:'none' delivers touch as pointers).
    const activePointersRef = useRef<Map<number, { clientX: number; clientY: number; pointerType: string }>>(new Map());
    // Canvas-zoom pinch consumer; non-null only while a 2-finger zoom owns the gesture.
    const canvasPinchRef = useRef<{ lastDist: number; focalX: number; focalY: number } | null>(null);
    const applyZoomAtRef = useRef<(nextZoom: number, focalX: number, focalY: number) => void>(() => {});
    applyZoomAtRef.current = (nextZoom, focalX, focalY) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      applyZoomPanAt(
        zoomRef,
        panXRef,
        panYRef,
        videoBoundsRef.current,
        canvas.width,
        canvas.height,
        nextZoom,
        focalX,
        focalY,
      );
      renderDirtyRef.current = true;
    };
    const webcamPipBottomInsetRef = useRef(webcamPipBottomInsetPx);
    const webcamPipMobileChromeRef = useRef(webcamPipMobileChrome);
    const pipMirrorVideoRef = useRef<HTMLVideoElement>(null);
    const pipUiSyncPendingRef = useRef(false);
    const [pipUiRect, setPipUiRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
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
    const stroRegionCallbackRef      = useRef<((r: { x: number; y: number; w: number; h: number } | null) => void) | null>(null);
    const stroRegionStartRef         = useRef<Pt | null>(null);
    const stroRegionCurrentRef       = useRef<Pt | null>(null);

    // Object Multiplier rubber-band region selection
    const isSelectingObjMultRegionRef = useRef(false);
    const objMultRegionStartRef       = useRef<Pt | null>(null);
    const objMultRegionCurrentRef     = useRef<Pt | null>(null);
    const objMultRegionRef            = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
    const objMultiplierRef            = useRef<import('@/lib/objectMultiplier').ObjectMultiplier | null>(null);
    const onObjMultRegionSelectedRef  = useRef(onObjMultiplierRegionSelected);
    /** COCO-SSD suggested racket box (video-normalized); cleared after confirm or manual draw */
    const racketSuggestNormRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
    const racketSuggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [racketHudOpen, setRacketHudOpen] = useState(false);

    const cropRegionRef         = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

    // Manual swing state
    const manualSwingPtsRef     = useRef<Pt[]>([]);
    const manualSwingActiveRef  = useRef(false);
    const jointChainPtsRef      = useRef<Pt[]>([]);
    const jointChainActiveRef   = useRef(false);
    const jointChainCursorRef   = useRef<Pt | null>(null);
    const lastClickTimeRef      = useRef(0);
    const lastClickPosRef       = useRef<Pt | null>(null);

    useEffect(() => { drawingOptsRef.current      = drawingOptions; },  [drawingOptions]);
    useEffect(() => { activeToolRef.current        = activeTool; },      [activeTool]);
    useEffect(() => {
      if (activeTool !== 'angle') setAngleUiPhase(0);
    }, [activeTool]);
    useEffect(() => {
      if (newTextDraft && newTextInputRef.current) {
        newTextInputRef.current.focus();
      }
    }, [newTextDraft]);
    useEffect(() => {
      if (activeTool !== 'jointChain' && jointChainActiveRef.current) {
        jointChainPtsRef.current = [];
        jointChainActiveRef.current = false;
        jointChainCursorRef.current = null;
        setJointChainUiActive(false);
        renderDirtyRef.current = true;
      }
    }, [activeTool]);
    useEffect(() => { skeletonEnabledRef.current   = skeletonEnabled; }, [skeletonEnabled]);
    useEffect(() => { skeletonDrawEnabledRef.current = skeletonDrawEnabled; }, [skeletonDrawEnabled]);
    useEffect(() => { ballTrailEnabledRef.current  = ballTrailEnabled; }, [ballTrailEnabled]);
    useEffect(() => { ballTrailModeRef.current     = ballTrailMode; },   [ballTrailMode]);
    useEffect(() => { isRecordingRef.current       = isRecording; },     [isRecording]);
    useEffect(() => { circleSpinningRef.current    = circleSpinning; },  [circleSpinning]);
    useEffect(() => { outlineEraserSizeRef.current  = outlineEraserSize; }, [outlineEraserSize]);

    /** Pulse toggle applies to the selected stroke/angle, not only the next mark. */
    useEffect(() => {
      const sel = selectionRef.current;
      if (!sel || (sel.kind !== 'stroke' && sel.kind !== 'angle')) return;
      if (sel.kind === 'stroke') {
        const raw = strokesRef.current[sel.idx];
        if (!raw || raw.tool === 'text' || raw.tool === 'swingPath' || raw.tool === 'manualSwing') return;
        const next = { ...(raw as StrokeLine), spinning: circleSpinning || undefined } as Stroke;
        strokesRef.current = [
          ...strokesRef.current.slice(0, sel.idx),
          next,
          ...strokesRef.current.slice(sel.idx + 1),
        ];
        selectionRef.current = { ...sel, orig: next };
      } else {
        const angles = [...angleMeasRef.current];
        const m = angles[sel.idx];
        if (!m) return;
        angles[sel.idx] = { ...m, spinning: circleSpinning || undefined };
        angleMeasRef.current = angles;
        selectionRef.current = { ...sel, orig: angles[sel.idx] };
      }
      renderDirtyRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [circleSpinning]);
    useEffect(() => { webcamPipModeRef.current     = webcamPipMode; },   [webcamPipMode]);
    useEffect(() => { webcamOpacityRef.current     = webcamOpacity; },   [webcamOpacity]);
    useEffect(() => { stroMotionResultRef.current = stroMotionResult ?? null; renderDirtyRef.current = true; }, [stroMotionResult]);
    useEffect(() => { stroMotionDraftRef.current = stroMotionDraft ?? null; renderDirtyRef.current = true; }, [stroMotionDraft]);
    useEffect(() => { stroMotionCanvasPreviewRef.current = stroMotionCanvasPreview; renderDirtyRef.current = true; }, [stroMotionCanvasPreview]);
    useEffect(() => { stroMotionUseExportMasksRef.current = stroMotionUseExportMasks; renderDirtyRef.current = true; }, [stroMotionUseExportMasks]);
    useEffect(() => { stroMotionBackgroundRef.current = stroMotionBackground; renderDirtyRef.current = true; }, [stroMotionBackground]);
    useEffect(() => { stroMotionVideoOrderRef.current = stroMotionVideoOrder; renderDirtyRef.current = true; }, [stroMotionVideoOrder]);
    useEffect(() => { stroMotionEndPlateRef.current = stroMotionEndPlate ?? null; renderDirtyRef.current = true; }, [stroMotionEndPlate]);
    useEffect(() => { stroMotionSubjectBoxRef.current = stroMotionSubjectBox ?? null; renderDirtyRef.current = true; }, [stroMotionSubjectBox]);
    useEffect(() => { stroMotionFrameStopsRef.current = stroMotionFrameStops ?? null; renderDirtyRef.current = true; }, [stroMotionFrameStops]);
    useEffect(() => { stroMotionVisibleCountRef.current = stroMotionVisibleCount; renderDirtyRef.current = true; }, [stroMotionVisibleCount]);
    useEffect(() => { stroMotionShowSkeletonRef.current = stroMotionShowSkeleton; renderDirtyRef.current = true; }, [stroMotionShowSkeleton]);
    useEffect(() => { skeletonShowAnglesRef.current   = skeletonShowAngles; },   [skeletonShowAngles]);
    useEffect(() => { skeletonShowHeadLineRef.current  = skeletonShowHeadLine; },  [skeletonShowHeadLine]);
    useEffect(() => { skeletonClassicColorsRef.current = skeletonClassicColors; }, [skeletonClassicColors]);
    useEffect(() => { skeletonPartsRef.current = skeletonParts; }, [skeletonParts]);
    useEffect(() => { ballSampleModeRef.current = ballSampleMode; }, [ballSampleMode]);
    useEffect(() => { transparentWhenNoVideoRef.current = transparentWhenNoVideo; }, [transparentWhenNoVideo]);
    useEffect(() => { renderVideoRef.current = renderVideo; if (renderVideo) renderDirtyRef.current = true; }, [renderVideo]);
    useEffect(() => { nativeVideoUnderlayRef.current = nativeVideoUnderlay; }, [nativeVideoUnderlay]);

    useEffect(() => { youtubePoseRef.current = youtubePose; }, [youtubePose]);
    useEffect(() => { suppressTabCaptureMirrorRef.current = suppressTabCaptureMirror; }, [suppressTabCaptureMirror]);
    useEffect(() => { webcamCutoutRef.current = webcamCutout; }, [webcamCutout]);
    useEffect(() => { webcamActiveRef.current = webcamActive; }, [webcamActive]);
    useEffect(() => { webcamPipBottomInsetRef.current = webcamPipBottomInsetPx; }, [webcamPipBottomInsetPx]);
    useEffect(() => { webcamPipMobileChromeRef.current = webcamPipMobileChrome; }, [webcamPipMobileChrome]);
    useEffect(() => {
      if (activeTool !== 'select') {
        if (webcamPipSelectedRef.current || webcamPipHoveredRef.current) {
          webcamPipSelectedRef.current = false;
          webcamPipHoveredRef.current = false;
          renderDirtyRef.current = true;
        }
      }
    }, [activeTool]);
    useEffect(() => {
      if (webcamActive) renderDirtyRef.current = true;
    }, [webcamActive]);
    useEffect(() => {
      const src = webcamVideoRef?.current?.srcObject ?? null;
      const mirror = pipMirrorVideoRef.current;
      if (!mirror || !src) return;
      if (mirror.srcObject !== src) {
        mirror.srcObject = src;
        void mirror.play().catch(() => {});
      }
      // webcamCutout toggles whether the mirror <video> is mounted; re-run so the
      // stream is (re)attached when it remounts after cutout is turned off.
    }, [webcamActive, webcamVideoRef, webcamCutout]);
    useEffect(() => { panModeEnabledRef.current = panModeEnabled; }, [panModeEnabled]);
    useEffect(() => { onObjMultRegionSelectedRef.current = onObjMultiplierRegionSelected; }, [onObjMultiplierRegionSelected]);

    useEffect(() => {
      if (!skeletonDrawEnabled) {
        latestKeypointsRef.current = null;
        renderDirtyRef.current = true;
      }
    }, [skeletonDrawEnabled]);

    useEffect(() => {
      renderDirtyRef.current = true;
    }, [skeletonClassicColors]);

    /** Racket multiplier: auto-detect tennis racket (COCO-SSD) once per tool activation */
    useEffect(() => {
      if (racketSuggestTimerRef.current) {
        clearTimeout(racketSuggestTimerRef.current);
        racketSuggestTimerRef.current = null;
      }
      racketSuggestNormRef.current = null;
      setRacketHudOpen(false);

      if (activeTool !== 'objectMultiplier') return;
      if (objMultRegionRef.current) return;

      let cancelled = false;
      const v0 = videoRef.current;

      const run = async () => {
        const v = videoRef.current;
        if (!v || v.readyState < 2 || v.videoWidth < 32) return;
        if (cancelled || activeToolRef.current !== 'objectMultiplier' || objMultRegionRef.current) return;
        onProcessingStatus?.('Scanning for racket…');
        try {
          const { detectTennisRacketNorm } = await import('@/lib/racketCocoDetect');
          const r = await detectTennisRacketNorm(v);
          if (cancelled || activeToolRef.current !== 'objectMultiplier' || objMultRegionRef.current) return;
          if (r) {
            racketSuggestNormRef.current = r;
            setRacketHudOpen(true);
            renderDirtyRef.current = true;
            racketSuggestTimerRef.current = setTimeout(() => {
              racketSuggestTimerRef.current = null;
              if (
                cancelled ||
                activeToolRef.current !== 'objectMultiplier' ||
                objMultRegionRef.current ||
                !racketSuggestNormRef.current
              ) {
                return;
              }
              const picked = racketSuggestNormRef.current;
              objMultRegionRef.current = { ...picked };
              racketSuggestNormRef.current = null;
              setRacketHudOpen(false);
              onObjMultRegionSelectedRef.current?.();
              renderDirtyRef.current = true;
            }, 2000);
          }
        } catch {
          onProcessingStatus?.('Racket auto-detect unavailable — drag a box on the video.');
        } finally {
          if (!cancelled) onProcessingStatus?.(null);
        }
      };

      const kick = window.setTimeout(() => void run(), 140);
      const onLoaded = () => void run();
      v0?.addEventListener('loadeddata', onLoaded);

      return () => {
        cancelled = true;
        clearTimeout(kick);
        v0?.removeEventListener('loadeddata', onLoaded);
        if (racketSuggestTimerRef.current) {
          clearTimeout(racketSuggestTimerRef.current);
          racketSuggestTimerRef.current = null;
        }
      };
    }, [activeTool, onProcessingStatus, renderVideo, videoRef]);

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
          webcamPipBottomInsetRef.current,
        );
      }
      lastPipContainerRef.current = { w: containerWidth, h: containerHeight };
    }, [containerWidth, containerHeight]);

    const queuePipUiSync = useCallback(() => {
      if (!webcamPipMobileChromeRef.current) return;
      if (pipUiSyncPendingRef.current) return;
      pipUiSyncPendingRef.current = true;
      requestAnimationFrame(() => {
        pipUiSyncPendingRef.current = false;
        const pip = webcamPipRectRef.current;
        if (pip.w > 0 && pip.h > 0) {
          setPipUiRect((prev) =>
            prev && prev.x === pip.x && prev.y === pip.y && prev.w === pip.w && prev.h === pip.h
              ? prev
              : { x: pip.x, y: pip.y, w: pip.w, h: pip.h },
          );
        }
      });
    }, []);

    const applyWebcamPipDragMove = useCallback((pos: Pt) => {
      const pipDrag = webcamPipDragRef.current;
      if (!pipDrag) return;
      const canvas = canvasRef.current;
      const cw = canvas?.width ?? 0;
      const ch = canvas?.height ?? 0;
      const inset = webcamPipBottomInsetRef.current;
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
          inset,
        );
      } else if (pipDrag.kind === 'resize-br') {
        const nw = Math.max(72, pos.x - o.x);
        const nh = Math.round(nw / WEBCAM_PIP_ASPECT);
        pip = clampWebcamPip({ x: o.x, y: o.y, w: nw, h: nh }, cw, ch, inset);
      } else if (pipDrag.kind === 'resize-bl') {
        const nw = Math.max(72, o.x + o.w - pos.x);
        const nh = Math.round(nw / WEBCAM_PIP_ASPECT);
        const nx = o.x + o.w - nw;
        pip = clampWebcamPip({ x: nx, y: o.y, w: nw, h: nh }, cw, ch, inset);
      } else if (pipDrag.kind === 'resize-tr') {
        const nw = Math.max(72, pos.x - o.x);
        const nh = Math.round(nw / WEBCAM_PIP_ASPECT);
        const ny = o.y + o.h - nh;
        pip = clampWebcamPip({ x: o.x, y: ny, w: nw, h: nh }, cw, ch, inset);
      } else {
        const nw = Math.max(72, o.x + o.w - pos.x);
        const nh = Math.round(nw / WEBCAM_PIP_ASPECT);
        const nx = o.x + o.w - nw;
        const ny = o.y + o.h - nh;
        pip = clampWebcamPip({ x: nx, y: ny, w: nw, h: nh }, cw, ch, inset);
      }
      webcamPipRectRef.current = pip;
      renderDirtyRef.current = true;
      queuePipUiSync();
    }, [queuePipUiSync]);

    const beginWebcamPipDragAt = useCallback((pos: Pt, pipHit: 'tl' | 'tr' | 'bl' | 'br' | 'inside') => {
      const canvas = canvasRef.current;
      const cw = canvas?.width ?? 0;
      const ch = canvas?.height ?? 0;
      let pip = webcamPipRectRef.current;
      if (!pip.w || !pip.h) pip = defaultWebcamPipRect(cw, ch, webcamPipBottomInsetRef.current);
      pip = clampWebcamPip(pip, cw, ch, webcamPipBottomInsetRef.current);
      webcamPipRectRef.current = pip;
      if (pipHit === 'inside') {
        webcamPipDragRef.current = { kind: 'move', sx: pos.x, sy: pos.y, orig: { ...pip } };
      } else {
        const rk: WebcamPipDrag['kind'] =
          pipHit === 'tl' ? 'resize-tl' : pipHit === 'tr' ? 'resize-tr' : pipHit === 'bl' ? 'resize-bl' : 'resize-br';
        webcamPipDragRef.current = { kind: rk, sx: pos.x, sy: pos.y, orig: { ...pip } };
      }
      isDraggingRef.current = true;
      renderDirtyRef.current = true;
      queuePipUiSync();
    }, [queuePipUiSync]);

    const applyWebcamPinchScale = useCallback((factor: number) => {
      const pinch = webcamPinchRef.current;
      const canvas = canvasRef.current;
      if (!pinch || !canvas || factor <= 0) return;
      const nw = Math.max(72, Math.round(pinch.w * factor));
      const nh = Math.round(nw / WEBCAM_PIP_ASPECT);
      const nx = pinch.cx - nw / 2;
      const ny = pinch.cy - nh / 2;
      webcamPipRectRef.current = clampWebcamPip(
        { x: nx, y: ny, w: nw, h: nh },
        canvas.width,
        canvas.height,
        webcamPipBottomInsetRef.current,
      );
      renderDirtyRef.current = true;
      queuePipUiSync();
    }, [queuePipUiSync]);

    const tryStartWebcamPinch = useCallback((t1: Touch, t2: Touch, canvas: HTMLCanvasElement) => {
      if (!webcamActiveRef.current) return false;
      const rect = canvas.getBoundingClientRect();
      const mx = ((t1.clientX + t2.clientX) / 2 - rect.left) * (canvas.width / rect.width);
      const my = ((t1.clientY + t2.clientY) / 2 - rect.top) * (canvas.height / rect.height);
      let pip = webcamPipRectRef.current;
      if (!pip.w || !pip.h) pip = defaultWebcamPipRect(canvas.width, canvas.height, webcamPipBottomInsetRef.current);
      pip = clampWebcamPip(pip, canvas.width, canvas.height, webcamPipBottomInsetRef.current);
      webcamPipRectRef.current = pip;
      const inside = mx >= pip.x && mx <= pip.x + pip.w && my >= pip.y && my <= pip.y + pip.h;
      if (!inside) return false;
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      webcamPinchRef.current = { dist, w: pip.w, cx: pip.x + pip.w / 2, cy: pip.y + pip.h / 2 };
      return true;
    }, []);

    // NOTE: The legacy native touch listeners (touchstart/move/end/cancel) that
    // used to live here have been retired as part of the Unified Input Pipeline.
    // The canvas carries `touchAction: 'none'`, so touch is delivered as pointer
    // events and ALL multi-touch (canvas pinch + webcam PiP pinch), precision
    // anchoring, and pan are reconstructed from concurrent pointers inside the
    // single pointer pipeline (onPointerDown/Move/Up/Cancel). Keeping a parallel
    // native path here caused double dispatch (double pinch-zoom, duplicate
    // precision commits), which the pipeline now eliminates.

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
        contextualTargetRef.current = null;
        setContextualOpen(false);
        strokesRef.current = [];
        angleMeasRef.current = [];
        activeStrokeRef.current = null;
        swingPtsRef.current = [];
        swingDrawingRef.current = false;
        manualSwingPtsRef.current = [];
        manualSwingActiveRef.current = false;
        jointChainPtsRef.current = [];
        jointChainActiveRef.current = false;
        jointChainCursorRef.current = null;
        liveAngleRef.current = null;
        renderDirtyRef.current = true;
        anglePhaseRef.current = 0;
        angleVRef.current = null;
        angleP1Ref.current = null;
        // ClearAll should remove *everything* including AI overlays.
        skeletonSuppressedRef.current = true;
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
        skeletonFramesRef.current = [];
        latestKeypointsRef.current = null;
        poseSmoothPrevRef.current = null;
        renderDirtyRef.current = true;
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
          skeletonSuppressedRef.current = true;
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
          spinning: circleSpinningRef.current || undefined,
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
      cancelStroMotionRegionSelect: () => {
        if (!isSelectingStroRegionRef.current) return;
        stroRegionCallbackRef.current?.(null);
        isSelectingStroRegionRef.current = false;
        stroRegionCallbackRef.current = null;
        stroRegionStartRef.current = null;
        stroRegionCurrentRef.current = null;
        renderDirtyRef.current = true;
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
        const canvas = canvasRef.current;
        const next = Math.min(ZOOM_MAX, zoomRef.current + ZOOM_BUTTON_STEP);
        if (!canvas) {
          zoomRef.current = next;
          return;
        }
        applyZoomPanAt(
          zoomRef,
          panXRef,
          panYRef,
          videoBoundsRef.current,
          canvas.width,
          canvas.height,
          next,
          canvas.width / 2,
          canvas.height / 2,
        );
        renderDirtyRef.current = true;
      },
      zoomOut: () => {
        const canvas = canvasRef.current;
        const next = Math.max(ZOOM_MIN, zoomRef.current - ZOOM_BUTTON_STEP);
        if (!canvas) {
          zoomRef.current = next;
          if (next <= ZOOM_MIN) { panXRef.current = 0; panYRef.current = 0; }
          return;
        }
        applyZoomPanAt(
          zoomRef,
          panXRef,
          panYRef,
          videoBoundsRef.current,
          canvas.width,
          canvas.height,
          next,
          canvas.width / 2,
          canvas.height / 2,
        );
        renderDirtyRef.current = true;
      },
      resetZoomPan: () => {
        zoomRef.current = ZOOM_MIN;
        panXRef.current = 0;
        panYRef.current = 0;
        renderDirtyRef.current = true;
      },
      startObjMultiplierRegionSelect: () => {
        isSelectingObjMultRegionRef.current = true;
        objMultRegionStartRef.current = null;
        objMultRegionCurrentRef.current = null;
      },
      getObjMultiplierRegion: () => objMultRegionRef.current,
      runObjMultiplierCapture: async (frameCount, onProgress) => {
        const video = videoRef.current;
        if (!video || !objMultRegionRef.current) return 0;
        try {
          const { ObjectMultiplier } = await import('@/lib/objectMultiplier');
          if (!objMultiplierRef.current) {
            objMultiplierRef.current = new ObjectMultiplier();
          }
          objMultiplierRef.current.clear();
          await objMultiplierRef.current.autoCaptureSequence(
            video,
            objMultRegionRef.current,
            frameCount,
            0,
            onProgress,
          );
          return objMultiplierRef.current.getFrameCount();
        } catch {
          objMultiplierRef.current?.clear();
          objMultiplierRef.current = null;
          throw new Error('Object multiplier capture failed');
        }
      },
      clearObjMultiplier: () => {
        objMultiplierRef.current?.clear();
        objMultiplierRef.current = null;
        objMultRegionRef.current = null;
        if (racketSuggestTimerRef.current) {
          clearTimeout(racketSuggestTimerRef.current);
          racketSuggestTimerRef.current = null;
        }
        racketSuggestNormRef.current = null;
        setRacketHudOpen(false);
      },
      getObjMultiplierFrameCount: () => objMultiplierRef.current?.getFrameCount() ?? 0,
      waitForRender: () => new Promise<void>((resolve) => {
        renderWaitersRef.current.push(resolve);
        renderDirtyRef.current = true;
      }),
      canvasSupportsStroMotionVideoExport: () => {
        const canvas = canvasRef.current;
        return !!canvas && canvasSupportsVideoExport(canvas);
      },
      setStroMotionVisibleCount: (count) => {
        stroMotionVisibleCountRef.current = count;
        renderDirtyRef.current = true;
      },
      setStroMotionCanvasPreview: (on) => {
        stroMotionCanvasPreviewRef.current = on;
        renderDirtyRef.current = true;
      },
      exportStroMotionVideo: async () => {
        const canvas = canvasRef.current;
        if (!canvas) return { ok: false, reason: 'no-canvas' };
        if (!canvasSupportsVideoExport(canvas)) return { ok: false, reason: 'unsupported' };
        const draft = stroMotionDraftRef.current;
        const video = videoRef.current;
        if (!draft || draft.frames.length === 0 || !video) return { ok: false, reason: 'no-frames' };

        const sampleTimes = draft.sampleTimes;
        const videoOrder = stroMotionVideoOrderRef.current;
        const startTime = Math.min(...sampleTimes);
        const endTime = Math.max(...sampleTimes);
        const fps = 24;
        const totalSteps = Math.max(1, Math.ceil((endTime - startTime) * fps));
        const finalHoldMs = 2000;
        const intervalMs = Math.round(1000 / fps);

        const vw = draft.videoWidth || video.videoWidth;
        const vh = draft.videoHeight || video.videoHeight;
        if (!vw || !vh) return { ok: false, reason: 'no-video-size' };

        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
          ? 'video/webm;codecs=vp9'
          : MediaRecorder.isTypeSupported('video/webm')
            ? 'video/webm'
            : 'video/mp4';

        // Off-screen composite canvas (matches video resolution)
        const offCanvas = document.createElement('canvas');
        offCanvas.width = vw;
        offCanvas.height = vh;
        const offCtx = offCanvas.getContext('2d');
        if (!offCtx) return { ok: false, reason: 'no-context' };

        // We record from the MAIN canvas to preserve existing aspect-ratio letterboxing,
        // but we need to draw each composite frame to it. Use the existing render infra.
        const savedPreview = stroMotionCanvasPreviewRef.current;
        const savedOverlay = stroMotionOverlayModeRef.current;
        const savedVisible = stroMotionVisibleCountRef.current;
        const savedEndPlate = stroMotionEndPlateRef.current;
        stroMotionCanvasPreviewRef.current = true;
        stroMotionOverlayModeRef.current = false; // use live bitmap as background plate

        const waitRender = () => new Promise<void>((resolve) => {
          renderWaitersRef.current.push(resolve);
          renderDirtyRef.current = true;
        });

        const stream = (canvas as unknown as { captureStream(f: number): MediaStream }).captureStream(fps);
        const recorder = new MediaRecorder(stream, { mimeType });
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

        try {
          recorder.start();

          for (let step = 0; step <= totalSteps; step++) {
            const t = startTime + (step / totalSteps) * (endTime - startTime);
            const clampedT = Math.min(t, endTime);

            // Capture video frame at this exact time
            let liveBitmap: ImageBitmap | null = null;
            try {
              liveBitmap = await captureVideoFrameAtTime(video, clampedT);
            } catch {
              // fallback: use start background plate
              liveBitmap = null;
            }

            // Use the live frame as the background plate by temporarily swapping endPlate
            // and background mode to 'end', since endPlate overrides backgroundPlate
            if (liveBitmap) {
              stroMotionEndPlateRef.current = liveBitmap;
              stroMotionBackgroundRef.current = 'end';
            } else {
              stroMotionBackgroundRef.current = 'start';
            }

            // Compute visible ghost count
            let visibleCount: number;
            if (videoOrder === 'reverse') {
              visibleCount = sampleTimes.filter((st) => st > clampedT - 0.001).length;
            } else {
              visibleCount = sampleTimes.filter((st) => st <= clampedT + 0.001).length;
            }
            stroMotionVisibleCountRef.current = visibleCount;

            await waitRender();
            await waitRender();

            if (liveBitmap) {
              try { liveBitmap.close(); } catch { /* ok */ }
            }

            await new Promise((resolve) => setTimeout(resolve, intervalMs));
          }

          // Hold final frame
          await new Promise((resolve) => setTimeout(resolve, finalHoldMs));

          recorder.stop();
          await new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });

          const blob = new Blob(chunks, { type: mimeType });
          const url = URL.createObjectURL(blob);
          return { ok: true, blob, url };
        } catch {
          return { ok: false, reason: 'record-failed' };
        } finally {
          stroMotionVisibleCountRef.current = savedVisible;
          stroMotionCanvasPreviewRef.current = savedPreview;
          stroMotionOverlayModeRef.current = savedOverlay;
          stroMotionEndPlateRef.current = savedEndPlate;
          stroMotionBackgroundRef.current = stroMotionBackground; // restore from prop
          renderDirtyRef.current = true;
        }
      },
      setSkeletonWaitingForClick: (v: boolean) => {
        skeletonWaitingForClickRef.current = v;
      },
      exportStrokes: () => {
        try { return JSON.stringify(strokesRef.current); }
        catch { return '[]'; }
      },
      importStrokes: (json: string) => {
        try {
          const parsed = JSON.parse(json);
          if (Array.isArray(parsed)) {
            strokesRef.current = parsed;
            historyRef.current = [parsed];
            historyIdxRef.current = 0;
            renderDirtyRef.current = true;
          }
        } catch { /* invalid JSON — ignore */ }
      },
      stampAutoMeasurements: (keypoints, videoNativeW, videoNativeH) => {
        const canvas = canvasRef.current;
        if (!canvas || !keypoints.length) return;

        const W = canvas.width;
        const H = canvas.height;
        // Scale keypoints (video pixels) → canvas pixels via letterbox transform
        const sc = Math.min(W / videoNativeW, H / videoNativeH);
        const dw = videoNativeW * sc;
        const dh = videoNativeH * sc;
        const dx = (W - dw) / 2;
        const dy = (H - dh) / 2;

        const toCanvas = (kp: { x: number; y: number }): { x: number; y: number } => ({
          x: dx + (kp.x / videoNativeW) * dw,
          y: dy + (kp.y / videoNativeH) * dh,
        });

        const SCORE_MIN = 0.25;
        const kp = (idx: number) => {
          const k = keypoints[idx];
          return k && k.score >= SCORE_MIN ? toCanvas(k) : null;
        };

        // MediaPipe indices
        const LS = kp(5);  // left shoulder
        const RS = kp(6);  // right shoulder
        const LE = kp(7);  // left elbow
        const RE = kp(8);  // right elbow
        const LW = kp(9);  // left wrist
        const RW = kp(10); // right wrist
        const LH = kp(11); // left hip
        const RH = kp(12); // right hip
        const LK = kp(13); // left knee
        const RK = kp(14); // right knee
        const LA = kp(15); // left ankle
        const RA = kp(16); // right ankle

        const color = drawingOptsRef.current.color;
        const lw = Math.max(2, drawingOptsRef.current.lineWidth);

        const angleBetween = (a: {x:number;y:number}, vertex: {x:number;y:number}, b: {x:number;y:number}): number => {
          const ax = a.x - vertex.x, ay = a.y - vertex.y;
          const bx = b.x - vertex.x, by = b.y - vertex.y;
          const dot = ax * bx + ay * by;
          const mag = Math.sqrt(ax*ax+ay*ay) * Math.sqrt(bx*bx+by*by);
          if (mag === 0) return 0;
          return Math.round(Math.acos(Math.max(-1, Math.min(1, dot/mag))) * 180 / Math.PI);
        };

        const newStrokes: Stroke[] = [];
        const newAngles: AngleMeas[] = [];

        // Shoulder line
        if (LS && RS) {
          newStrokes.push({ tool: 'line', p1: LS, p2: RS, color, lw, dashed: false });
          const mx = (LS.x + RS.x) / 2, my = Math.min(LS.y, RS.y) - 14;
          newStrokes.push({ tool: 'text', pos: { x: mx, y: my }, text: 'Shoulders', color, fontSize: 13 });
        }

        // Hip line
        if (LH && RH) {
          newStrokes.push({ tool: 'line', p1: LH, p2: RH, color, lw, dashed: false });
          const mx = (LH.x + RH.x) / 2, my = Math.min(LH.y, RH.y) - 14;
          newStrokes.push({ tool: 'text', pos: { x: mx, y: my }, text: 'Hips', color, fontSize: 13 });
        }

        // Shoulder–Hip separation angle (at left shoulder)
        if (LS && RS && LH && RH) {
          // Vector from L-shoulder to R-shoulder, and from L-shoulder to L-hip
          const deg = angleBetween(RS, LS, LH);
          newAngles.push({ v: LS, p1: RS, p2: LH, deg, color, lw });
        }

        // Left elbow angle
        if (LS && LE && LW) {
          const deg = angleBetween(LS, LE, LW);
          newAngles.push({ v: LE, p1: LS, p2: LW, deg, color, lw });
        }

        // Right elbow angle
        if (RS && RE && RW) {
          const deg = angleBetween(RS, RE, RW);
          newAngles.push({ v: RE, p1: RS, p2: RW, deg, color, lw });
        }

        // Left knee angle
        if (LH && LK && LA) {
          const deg = angleBetween(LH, LK, LA);
          newAngles.push({ v: LK, p1: LH, p2: LA, deg, color, lw });
        }

        // Right knee angle
        if (RH && RK && RA) {
          const deg = angleBetween(RH, RK, RA);
          newAngles.push({ v: RK, p1: RH, p2: RA, deg, color, lw });
        }

        // Foot direction labels (ankle → knee vectors as short lines)
        if (LK && LA) {
          newStrokes.push({ tool: 'line', p1: LA, p2: LK, color, lw: Math.max(1, lw - 1), dashed: true });
        }
        if (RK && RA) {
          newStrokes.push({ tool: 'line', p1: RA, p2: RK, color, lw: Math.max(1, lw - 1), dashed: true });
        }

        strokesRef.current = [...strokesRef.current, ...newStrokes];
        angleMeasRef.current = [...angleMeasRef.current, ...newAngles];
        pushHistory();
        renderDirtyRef.current = true;
      },
    }), [onProcessingStatus, pushHistory, videoRef]);

    // ── Skeleton: PoseWorkerBridge lifecycle ───────────────────────────────
    // Creates/disposes the bridge when skeleton is toggled. The bridge handles
    // worker-vs-main-thread fallback internally; the render loop just calls
    // bridge.sendFrame(video) and receives keypoints via callback.

    useEffect(() => {
      if (!skeletonEnabled) {
        poseLoopActiveRef.current = false;
        latestKeypointsRef.current = null;
        renderDirtyRef.current = true;
        return;
      }
      skeletonSuppressedRef.current = false;
      renderDirtyRef.current = true;
      if (typeof window === 'undefined') return;
      if (youtubePoseRef.current) {
        poseLoopActiveRef.current = false;
        return;
      }

      if (poseBridgeRef.current) {
        poseLoopActiveRef.current = true;
        return;
      }

      const bridge = new PoseWorkerBridge({
        frameSkip: poseFrameSkipRef.current,
        onStatus: onProcessingStatus ?? undefined,
      });
      poseBridgeRef.current = bridge;
      poseLoopActiveRef.current = true;

      bridge.onResult((keypoints) => {
        if (skeletonSuppressedRef.current || !skeletonDrawEnabledRef.current) {
          latestKeypointsRef.current = null;
          return;
        }
        if (keypoints) {
          latestKeypointsRef.current = keypoints;
          renderDirtyRef.current = true;

          const v = videoRef.current;
          if (v) {
            const nowT = v.currentTime;
            const lastFrame = skeletonFramesRef.current.at(-1);
            if (!lastFrame || Math.abs(nowT - lastFrame.timeSeconds) > 1 / 60) {
              skeletonFramesRef.current.push({ timeSeconds: nowT, keypoints });
              if (skeletonFramesRef.current.length > MAX_SKELETON_FRAMES) {
                skeletonFramesRef.current = skeletonFramesRef.current.slice(-MAX_SKELETON_FRAMES);
              }
            }
          }
        }
      });

      bridge.onReady(() => {
        onProcessingStatus?.('Skeleton ready — press play');
      });

      return () => {
        poseLoopActiveRef.current = false;
      };
    }, [skeletonEnabled, onProcessingStatus, videoRef]);

    useEffect(() => {
      return () => {
        poseBridgeRef.current?.dispose();
        poseBridgeRef.current = null;
      };
    }, []);

    // ── Pose detection scheduling — sends frames to bridge ───────────────
    // Uses requestVideoFrameCallback when playing for frame-accurate sync;
    // falls back to rAF. The bridge handles frame skipping + in-flight guard.

    useEffect(() => {
      if (!skeletonEnabled) return;
      if (youtubePoseRef.current) return;
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

    /** Restore cached pose when scrubbing / frame-stepping so overlay stays visible while paused. */
    useEffect(() => {
      if (!skeletonEnabled) return;
      const video = videoRef.current;
      if (!video) return;

      const syncFromCache = () => {
        const frames = skeletonFramesRef.current;
        if (frames.length === 0) return;
        const t = video.currentTime;
        let best = frames[0];
        let bestDist = Math.abs(best.timeSeconds - t);
        for (const frame of frames) {
          const dist = Math.abs(frame.timeSeconds - t);
          if (dist < bestDist) {
            best = frame;
            bestDist = dist;
          }
        }
        if (bestDist <= 0.12) {
          latestKeypointsRef.current = best.keypoints;
          renderDirtyRef.current = true;
        }
      };

      const onSeeked = () => {
        syncFromCache();
        renderDirtyRef.current = true;
      };

      video.addEventListener('seeked', onSeeked);
      video.addEventListener('timeupdate', syncFromCache);
      syncFromCache();
      return () => {
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('timeupdate', syncFromCache);
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
      let retryTimer: number | undefined;
      let loadedDataHandler: (() => void) | null = null;
      const segmenter = new WebcamSegmenter();
      segmenter.setOnMask(() => { webcamFrameDirtyRef.current = true; renderDirtyRef.current = true; });

      const startOnVideo = (wc: HTMLVideoElement) => {
        if (cancelled) return;
        if (wc.readyState >= 2) {
          segmenter.start(wc);
          return;
        }
        loadedDataHandler = () => {
          wc.removeEventListener('loadeddata', loadedDataHandler!);
          loadedDataHandler = null;
          if (!cancelled) segmenter.start(wc);
        };
        wc.addEventListener('loadeddata', loadedDataHandler);
      };

      const waitForWebcamVideo = (onReady: (wc: HTMLVideoElement) => void, attempt = 0) => {
        if (cancelled) return;
        const wc = webcamVideoRef?.current;
        if (wc) {
          onReady(wc);
          return;
        }
        if (attempt >= WEBCAM_VIDEO_REF_RETRY_MAX) return;
        retryTimer = window.setTimeout(
          () => waitForWebcamVideo(onReady, attempt + 1),
          WEBCAM_VIDEO_REF_RETRY_MS,
        );
      };

      (async () => {
        try {
          await segmenter.init();
          if (cancelled) { segmenter.dispose(); return; }
          waitForWebcamVideo(startOnVideo);
          webcamSegmenterRef.current = segmenter;
          webcamMaskRef.current = segmenter.getOutputCanvas();
        } catch {
          onProcessingStatus?.('Webcam cutout unavailable — showing normal PiP');
        }
      })();

      return () => {
        cancelled = true;
        if (retryTimer !== undefined) window.clearTimeout(retryTimer);
        const wc = webcamVideoRef?.current;
        if (wc && loadedDataHandler) wc.removeEventListener('loadeddata', loadedDataHandler);
        segmenter.dispose();
        webcamSegmenterRef.current = null;
        webcamMaskRef.current = null;
      };
    }, [webcamCutout, webcamActive, webcamVideoRef, onProcessingStatus]);

    // ── Webcam frame-change signal ─────────────────────────────────────────
    useEffect(() => {
      if (!webcamActive) return;

      let cancelled = false;
      let retryTimer: number | undefined;
      let rvfcId = 0;
      let intervalId: number | undefined;
      let boundVideo: HTMLVideoElement | null = null;
      let loadedDataHandler: (() => void) | null = null;

      const cleanupTracking = () => {
        if (boundVideo && loadedDataHandler) {
          boundVideo.removeEventListener('loadeddata', loadedDataHandler);
        }
        loadedDataHandler = null;
        if (rvfcId && boundVideo) {
          try { boundVideo.cancelVideoFrameCallback?.(rvfcId); } catch { /* noop */ }
        }
        rvfcId = 0;
        if (intervalId !== undefined) window.clearInterval(intervalId);
        intervalId = undefined;
        boundVideo = null;
      };

      const bindTracking = (wc: HTMLVideoElement) => {
        cleanupTracking();
        boundVideo = wc;
        const markDirty = () => {
          webcamFrameDirtyRef.current = true;
          renderDirtyRef.current = true;
        };
        const startTracking = () => {
          if (cancelled) return;
          markDirty();
          const hasRvfc = typeof wc.requestVideoFrameCallback === 'function';
          if (hasRvfc) {
            const loop = () => {
              if (cancelled) return;
              markDirty();
              rvfcId = wc.requestVideoFrameCallback(loop);
            };
            rvfcId = wc.requestVideoFrameCallback(loop);
          } else {
            intervalId = window.setInterval(markDirty, 33);
          }
        };
        if (wc.readyState >= 2) startTracking();
        else {
          loadedDataHandler = () => {
            wc.removeEventListener('loadeddata', loadedDataHandler!);
            loadedDataHandler = null;
            startTracking();
          };
          wc.addEventListener('loadeddata', loadedDataHandler);
        }
      };

      const waitForWebcamVideo = (attempt = 0) => {
        if (cancelled) return;
        const wc = webcamVideoRef?.current;
        if (wc) {
          bindTracking(wc);
          return;
        }
        if (attempt >= WEBCAM_VIDEO_REF_RETRY_MAX) return;
        retryTimer = window.setTimeout(
          () => waitForWebcamVideo(attempt + 1),
          WEBCAM_VIDEO_REF_RETRY_MS,
        );
      };

      waitForWebcamVideo();

      return () => {
        cancelled = true;
        if (retryTimer !== undefined) window.clearTimeout(retryTimer);
        cleanupTracking();
      };
    }, [webcamActive, webcamVideoRef]);

    // ── Main video frame-change signal (render gating) ─────────────────────
    // Drive composites at the source's true frame rate instead of display rate
    // by marking a dirty frame only when a new video frame is actually
    // presented. The <video> elements are persistent, so RVFC bound here keeps
    // firing across source changes; it also fires on seek-while-paused.
    useEffect(() => {
      const v = videoRef.current;
      if (!v) return;
      if (typeof v.requestVideoFrameCallback !== 'function') {
        videoFrameRvfcActiveRef.current = false;
        return;
      }
      videoFrameRvfcActiveRef.current = true;
      let cancelled = false;
      let id = 0;
      const loop = () => {
        if (cancelled) return;
        videoFrameDirtyRef.current = true;
        id = v.requestVideoFrameCallback(loop);
      };
      id = v.requestVideoFrameCallback(loop);
      return () => {
        cancelled = true;
        videoFrameRvfcActiveRef.current = false;
        try { v.cancelVideoFrameCallback?.(id); } catch { /* noop */ }
      };
    }, [videoRef]);

    // While the HTML video plays, mark the canvas dirty on presentation signals.
    // RVFC alone is not reliable across src swaps and hidden-decoder setups.
    useEffect(() => {
      const v = videoRef.current;
      if (!v) return;

      const markDirty = () => {
        renderDirtyRef.current = true;
      };

      v.addEventListener('play', markDirty);
      v.addEventListener('playing', markDirty);
      v.addEventListener('seeked', markDirty);
      v.addEventListener('timeupdate', markDirty);

      return () => {
        v.removeEventListener('play', markDirty);
        v.removeEventListener('playing', markDirty);
        v.removeEventListener('seeked', markDirty);
        v.removeEventListener('timeupdate', markDirty);
      };
    }, [videoSourceKey, videoRef]);

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
      let detectorCancelled = false;
      poseLoopActiveRef.current = true;
      youtubePoseDetectorRef.current = null;

      getPoseDetector().then((det) => {
        if (detectorCancelled) return;
        youtubePoseDetectorRef.current = det;
        if (det) onProcessingStatus?.('Skeleton ready — press play');
      });

      let thumb: HTMLImageElement | null = null;
      let lastGood: PoseKeypoint[] | null = null;
      let baseEstimated = false;
      // Scheduling guards: the loop keeps ticking at rAF rate, but the async
      // smoothing body is (a) never re-entered while a prior pass is awaiting
      // (inFlight) and (b) throttled to ~25 Hz once the one-time base estimate
      // is done. estimatePoses runs once (baseEstimated); the per-frame cost is
      // only smoothing + buffering, which does not need display-rate cadence.
      let inFlight = false;
      let lastSmoothTs = 0;
      const YT_SMOOTH_INTERVAL_MS = 40; // ~25 Hz

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
        // Reschedule up-front so the loop keeps ticking independent of the
        // async body below; the inFlight guard prevents overlapping work.
        rafId = requestAnimationFrame(poseLoop);

        if (skeletonSuppressedRef.current || !skeletonDrawEnabledRef.current) {
          latestKeypointsRef.current = null;
          return;
        }
        if (inFlight) return;
        const tnow = performance.now();
        if (baseEstimated && tnow - lastSmoothTs < YT_SMOOTH_INTERVAL_MS) return;
        lastSmoothTs = tnow;

        inFlight = true;
        try {
          await ensureThumb();
          const ctrl = yp.controllerRef.current;
          const det = youtubePoseDetectorRef.current;
          const now = ctrl?.getCurrentTime() ?? 0;

          if (det && typeof det.estimatePoses === 'function' && thumb && thumb.complete) {
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
                // YouTube path must mark the canvas dirty itself (the HTML5
                // bridge does this in onResult); otherwise the overlay would
                // not refresh once the blanket "playing" render trigger is gone.
                renderDirtyRef.current = true;

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
        } finally {
          inFlight = false;
        }
      };

      rafId = requestAnimationFrame(poseLoop);
      return () => {
        detectorCancelled = true;
        poseLoopActiveRef.current = false;
        cancelAnimationFrame(rafId);
      };
    }, [skeletonEnabled, onProcessingStatus, youtubePose?.videoId]);

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
      renderDirtyRef.current = true;
    }, [containerWidth, containerHeight]);

    // ── Video source lifecycle — redraw when a new file loads or presents frames ──
    useEffect(() => {
      const v = videoRef.current;
      if (!v) return;

      const markDirty = () => {
        renderDirtyRef.current = true;
      };

      v.addEventListener('loadedmetadata', markDirty);
      v.addEventListener('loadeddata', markDirty);
      v.addEventListener('canplay', markDirty);
      v.addEventListener('seeked', markDirty);
      markDirty();

      return () => {
        v.removeEventListener('loadedmetadata', markDirty);
        v.removeEventListener('loadeddata', markDirty);
        v.removeEventListener('canplay', markDirty);
        v.removeEventListener('seeked', markDirty);
      };
    }, [videoSourceKey, videoRef]);

    // ── Wheel zoom ─────────────────────────────────────────────────────────

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const fx = (e.clientX - rect.left) * (canvas.width / rect.width);
        const fy = (e.clientY - rect.top) * (canvas.height / rect.height);
        const factor = Math.exp(-e.deltaY * ZOOM_WHEEL_GAIN);
        applyZoomAtRef.current(zoomRef.current * factor, fx, fy);
      };
      canvas.addEventListener('wheel', onWheel, { passive: false });
      return () => canvas.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Space key for pan mode ──────────────────────────────────────────────

    useEffect(() => {
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.code === 'Space') spaceHeldRef.current = true;
        if (e.key === 'Escape' && isSelectingStroRegionRef.current) {
          stroRegionCallbackRef.current?.(null);
          isSelectingStroRegionRef.current = false;
          stroRegionCallbackRef.current = null;
          stroRegionStartRef.current = null;
          stroRegionCurrentRef.current = null;
        }
      };
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

    useEffect(() => { measurementColumnRef.current = measurementColumnItems ?? null; renderDirtyRef.current = true; }, [measurementColumnItems]);
    useEffect(() => { if (measurementColumnPos) mcPosRef.current = measurementColumnPos; }, [measurementColumnPos]);

    // ── Watermark logo ───────────────────────────────────────────────────
    useEffect(() => {
      const img = new Image();
      img.src = '/logo-square.png';
      img.onload = () => { watermarkRef.current = img; watermarkLoadedRef.current = true; };
      img.onerror = () => { watermarkLoadedRef.current = false; };
    }, []);

    // ── Render loop ────────────────────────────────────────────────────────

    useEffect(() => {
      const render = () => {
        rafRef.current = requestAnimationFrame(render);
        animTickRef.current++;

        const canvas = canvasRef.current;
        if (!canvas) return;
        if (!ctxRef.current) ctxRef.current = canvas.getContext('2d', { alpha: true });
        const ctx = ctxRef.current;
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
          outlineErasingIdxRef.current >= 0 ||
          isPanningRef.current ||
          !!webcamPipDragRef.current ||
          racketHudOpen ||
          strokesRef.current.some((st) => strokeHasSpinning(st)) ||
          strokeHasSpinning(activeStrokeRef.current);

        // Composite only when a fresh decoded frame is actually presented (RVFC),
        // not on every display tick. currentTime advances continuously during
        // playback, so the delta is used only as the RVFC-unavailable fallback.
        // Skeleton / PiP / tool / interaction changes still drive renders via
        // renderDirtyRef, the webcam flag, and hasActiveInteraction.
        const videoIsPlaying = renderVideoRef.current && !!video && !video.paused;
        const trackVideoFrames = renderVideoRef.current && !nativeVideoUnderlayRef.current;
        const videoFrameChanged = !trackVideoFrames
          ? false
          : videoIsPlaying
            ? true
            : videoFrameRvfcActiveRef.current
              ? videoFrameDirtyRef.current
              : videoTimeChanged;

        const needsRender =
          videoFrameChanged ||
          zoomChanged ||
          renderDirtyRef.current ||
          renderWaitersRef.current.length > 0 ||
          hasActiveInteraction ||
          webcamFrameDirtyRef.current ||
          (webcamActiveRef.current && webcamPipModeRef.current !== 'hidden');

        if (!needsRender) return;

        const videoPaintable =
          renderVideoRef.current &&
          !!video &&
          !!video.src &&
          video.readyState >= 2 &&
          video.videoWidth > 0;
        const awaitingVideoPaint = renderVideoRef.current && !!video && !!video.src && !videoPaintable;

        if (!awaitingVideoPaint) {
          renderDirtyRef.current = false;
          webcamFrameDirtyRef.current = false;
          videoFrameDirtyRef.current = false;
        } else {
          renderDirtyRef.current = true;
        }

        ctx.clearRect(0, 0, W, H);

        // ── Apply zoom/pan transform ──────────────────────────────────────
        // When the video is a native underlay element (not drawn on canvas),
        // sync its CSS transform so it zooms/pans in lockstep with drawings.
        if (nativeVideoUnderlayRef.current && videoRef.current) {
          const z = zoomRef.current;
          const px = panXRef.current;
          const py = panYRef.current;
          if (z <= ZOOM_MIN + 0.001 && px === 0 && py === 0) {
            videoRef.current.style.transform = 'translateZ(0)';
            videoRef.current.style.transformOrigin = '';
          } else {
            videoRef.current.style.transformOrigin = 'center center';
            videoRef.current.style.transform = `translate(${px}px, ${py}px) scale(${z}) translateZ(0)`;
          }
        }

        ctx.save();
        ctx.translate(W / 2 + panXRef.current, H / 2 + panYRef.current);
        ctx.scale(zoomRef.current, zoomRef.current);
        ctx.translate(-W / 2, -H / 2);

        // Video frame (letterboxed to preserve aspect ratio)
        const yt = youtubePoseRef.current;
        const ytDim = youtubePoseDimsRef.current;
        let dx = 0, dy = 0, dw = W, dh = H, vW = W, vH = H;

        if (renderVideoRef.current && video && video.readyState >= 1 && video.videoWidth > 0) {
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
          const stroDraft = stroMotionCanvasPreviewRef.current ? stroMotionDraftRef.current : null;
          const stroComposite = stroMotionCanvasPreviewRef.current ? stroMotionResultRef.current : null;
          if (stroDraft && dw > 0 && dh > 0) {
            const visibleCount = stroMotionVisibleCountRef.current ?? stroDraft.frames.length;
            renderStroMotionDraftComposite(ctx, stroDraft, {
              visibleCount,
              previewMode: !stroMotionUseExportMasksRef.current,
              dest: { x: dx, y: dy, w: dw, h: dh },
              background: stroMotionBackgroundRef.current,
              videoOrder: stroMotionVideoOrderRef.current,
              endPlate: stroMotionEndPlateRef.current,
              overlayMode: stroMotionOverlayModeRef.current,
            });

            if (stroMotionShowSkeletonRef.current && stroComposite?.ghostPoses?.length) {
              const total = stroDraft.frames.length;
              const count = Math.min(visibleCount, total);
              for (let i = 0; i < count; i++) {
                const pose = stroComposite.ghostPoses[i];
                if (!pose?.length) continue;
                const isLast = i === count - 1;
                const skAlpha = isLast ? 1.0 : temporalGhostOpacity(i, total);
                ctx.save();
                ctx.globalAlpha = skAlpha;
                ctx.translate(dx, dy);
                drawSkeletonOverlay(ctx, pose, vW, vH, dw, dh, {
                  showAngles: false,
                  showHeadLine: false,
                  classicColors: skeletonClassicColorsRef.current,
                  parts: skeletonPartsRef.current,
                });
                ctx.restore();
              }
            }
          } else if (stroComposite && dw > 0 && dh > 0) {
            const visibleCount = stroMotionVisibleCountRef.current ?? stroComposite.ghostLayers.length;
            renderStroMotionComposite(ctx, stroComposite, {
              visibleCount,
              dest: { x: dx, y: dy, w: dw, h: dh },
            });

            if (stroMotionShowSkeletonRef.current && stroComposite.ghostPoses?.length) {
              const total = stroComposite.ghostLayers.length;
              const count = Math.min(visibleCount, total);
              for (let i = 0; i < count; i++) {
                const pose = stroComposite.ghostPoses[i];
                if (!pose?.length) continue;
                const isLast = i === count - 1;
                const skAlpha = isLast ? 1.0 : temporalGhostOpacity(i, total);
                ctx.save();
                ctx.globalAlpha = skAlpha;
                ctx.translate(dx, dy);
                drawSkeletonOverlay(ctx, pose, vW, vH, dw, dh, {
                  showAngles: false,
                  showHeadLine: false,
                  classicColors: skeletonClassicColorsRef.current,
                  parts: skeletonPartsRef.current,
                });
                ctx.restore();
              }
            }
          } else if (!hideStreamMirror) {
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
        } else if (
          stroMotionCanvasPreviewRef.current &&
          stroMotionDraftRef.current &&
          stroMotionDraftRef.current.videoWidth > 0 &&
          stroMotionDraftRef.current.videoHeight > 0
        ) {
          const stroDraft = stroMotionDraftRef.current;
          vW = stroDraft.videoWidth;
          vH = stroDraft.videoHeight;
          const scale = Math.min(W / vW, H / vH);
          dw = vW * scale;
          dh = vH * scale;
          dx = (W - dw) / 2;
          dy = (H - dh) / 2;
          videoBoundsRef.current = { dx, dy, dw, dh };
          const visibleCount = stroMotionVisibleCountRef.current ?? stroDraft.frames.length;
          renderStroMotionDraftComposite(ctx, stroDraft, {
            visibleCount,
            previewMode: !stroMotionUseExportMasksRef.current,
            dest: { x: dx, y: dy, w: dw, h: dh },
            background: stroMotionBackgroundRef.current,
            videoOrder: stroMotionVideoOrderRef.current,
            endPlate: stroMotionEndPlateRef.current,
            overlayMode: stroMotionOverlayModeRef.current,
          });
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
          if (nativeVideoUnderlayRef.current && video && video.videoWidth > 0 && video.videoHeight > 0) {
            vW = video.videoWidth;
            vH = video.videoHeight;
            const scale = Math.min(W / vW, H / vH);
            dw = vW * scale;
            dh = vH * scale;
            dx = (W - dw) / 2;
            dy = (H - dh) / 2;
          } else {
            dx = 0; dy = 0; dw = W; dh = H; vW = W; vH = H;
          }
          videoBoundsRef.current = { dx, dy, dw, dh };
        } else {
          const waitingOnVideo = !!video?.src;
          if (
            !waitingOnVideo &&
            !transparentWhenNoVideoRef.current &&
            !nativeVideoUnderlayRef.current
          ) {
            ctx.fillStyle = '#111';
            ctx.fillRect(0, 0, W, H);
          }
          dx = 0; dy = 0; dw = W; dh = H; vW = W; vH = H;
          videoBoundsRef.current = { dx, dy, dw, dh };
        }

        if (zoomRef.current > ZOOM_MIN + 0.001 && !isPanningRef.current) {
          const c = clampPanToLetterbox(
            panXRef.current,
            panYRef.current,
            zoomRef.current,
            W,
            H,
            dx,
            dy,
            dw,
            dh,
          );
          panXRef.current = c.x;
          panYRef.current = c.y;
        }

        // ── StroMotion subject / frame-stop box preview (before generate) ───
        const stroFrameStopsPreview = stroMotionFrameStopsRef.current;
        if (!stroMotionResultRef.current && !stroMotionCanvasPreviewRef.current && stroFrameStopsPreview?.length && dw > 0 && dh > 0) {
          for (const stop of stroFrameStopsPreview) {
            const sx = dx + stop.box.x * dw;
            const sy = dy + stop.box.y * dh;
            const sw = stop.box.width * dw;
            const sh = stop.box.height * dh;
            ctx.save();
            ctx.fillStyle = stop.userConfirmed
              ? 'rgba(52,199,89,0.12)'
              : stop.active
                ? 'rgba(0,122,255,0.14)'
                : 'rgba(0,122,255,0.08)';
            ctx.fillRect(sx, sy, sw, sh);
            ctx.strokeStyle = stop.userConfirmed
              ? 'rgba(52,199,89,0.95)'
              : stop.active
                ? 'rgba(0,122,255,0.95)'
                : 'rgba(0,122,255,0.45)';
            ctx.lineWidth = stop.active ? 2 : 1.5;
            ctx.setLineDash(stop.active ? [] : [6, 4]);
            ctx.strokeRect(sx, sy, sw, sh);
            ctx.setLineDash([]);
            ctx.restore();
          }
        } else if (!stroMotionResultRef.current && stroMotionSubjectBoxRef.current && dw > 0 && dh > 0) {
          const stroSubjectPreview = stroMotionSubjectBoxRef.current;
          const sx = dx + stroSubjectPreview.x * dw;
          const sy = dy + stroSubjectPreview.y * dh;
          const sw = stroSubjectPreview.width * dw;
          const sh = stroSubjectPreview.height * dh;
          ctx.save();
          ctx.fillStyle = 'rgba(0,122,255,0.14)';
          ctx.fillRect(sx, sy, sw, sh);
          ctx.strokeStyle = 'rgba(0,122,255,0.95)';
          ctx.lineWidth = 2;
          ctx.setLineDash([8, 4]);
          ctx.strokeRect(sx, sy, sw, sh);
          ctx.setLineDash([]);
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
            : 'Auto-detect runs first — or drag a box around the racket';
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

        // ── Skeleton overlay (single path: drawSkeletonOverlay only) ─────
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
          }
        }

        // ── Racket auto-detect preview (green dashed = suggested region) ─
        const rsNorm = racketSuggestNormRef.current;
        if (
          rsNorm &&
          activeToolRef.current === 'objectMultiplier' &&
          !objMultRegionRef.current &&
          dw > 0 &&
          dh > 0
        ) {
          ctx.save();
          ctx.translate(dx, dy);
          ctx.strokeStyle = 'rgba(34,197,94,0.95)';
          ctx.lineWidth = 2.5;
          ctx.setLineDash([10, 5]);
          ctx.strokeRect(rsNorm.x * dw, rsNorm.y * dh, rsNorm.w * dw, rsNorm.h * dh);
          ctx.setLineDash([]);
          ctx.restore();
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
          webcam.videoWidth > 0 &&
          webcam.readyState >= 1 &&
          webcamPipModeRef.current !== 'hidden';
        if (showWebcamPip) {
          let pip = webcamPipRectRef.current;
          if (!pip.w || !pip.h) {
            pip = defaultWebcamPipRect(W, H, webcamPipBottomInsetRef.current);
            webcamPipRectRef.current = pip;
          }
          pip = clampWebcamPip(pip, W, H, webcamPipBottomInsetRef.current);
          webcamPipRectRef.current = pip;
          if (webcamPipMobileChromeRef.current) queuePipUiSync();
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

          // PiP hover / selection chrome
          const pipSelected = webcamPipSelectedRef.current;
          const pipHovered = webcamPipHoveredRef.current;
          if (pipSelected || pipHovered) {
            ctx.save();
            ctx.globalAlpha = 1;
            ctx.strokeStyle = pipSelected ? '#007AFF' : 'rgba(0,122,255,0.55)';
            ctx.lineWidth = pipSelected ? 2.5 : 1.5;
            if (webcamPipModeRef.current === 'circle') {
              const r = Math.min(camW, camH) / 2;
              ctx.beginPath();
              ctx.arc(cx2 + camW / 2, cy2 + camH / 2, r, 0, Math.PI * 2);
              ctx.stroke();
            } else {
              ctx.beginPath();
              if (ctx.roundRect) ctx.roundRect(cx2, cy2, camW, camH, 10);
              else ctx.rect(cx2, cy2, camW, camH);
              ctx.stroke();
            }
            ctx.restore();
          }
          if (pipSelected) {
            const hsz = WEBCAM_PIP_HANDLE / 2;
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.strokeStyle = '#007AFF';
            ctx.lineWidth = 1.5;
            const corners: Array<[number, number]> = [
              [cx2, cy2],
              [cx2 + camW, cy2],
              [cx2, cy2 + camH],
              [cx2 + camW, cy2 + camH],
            ];
            for (const [hx, hy] of corners) {
              ctx.fillRect(hx - hsz, hy - hsz, WEBCAM_PIP_HANDLE, WEBCAM_PIP_HANDLE);
              ctx.strokeRect(hx - hsz, hy - hsz, WEBCAM_PIP_HANDLE, WEBCAM_PIP_HANDLE);
            }
            ctx.restore();
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
          drawSmoothPath(ctx, pts, opts.color, opts.lineWidth, 0.8, opts.dashed ?? false, opts.arrowAtEnd === true, circleSpinningRef.current);
        }

        // Manual swing path being drawn
        if (manualSwingActiveRef.current && manualSwingPtsRef.current.length > 0) {
          const pts = manualSwingPtsRef.current;
          const opts = drawingOptsRef.current;
          drawSmoothPath(ctx, pts, opts.color, opts.lineWidth, 0.8, opts.dashed ?? false, opts.arrowAtEnd === true, circleSpinningRef.current);
        }

        // Joint chain in progress
        if (jointChainActiveRef.current && jointChainPtsRef.current.length > 0) {
          const pts = jointChainPtsRef.current;
          const cursor = jointChainCursorRef.current;
          const opts = drawingOptsRef.current;
          const previewNodes = cursor ? [...pts, cursor] : pts;
          drawJointChainStroke(
            ctx,
            {
              tool: 'jointChain',
              nodes: previewNodes,
              color: opts.color,
              lw: opts.lineWidth,
              opacity: 0.85,
              dashed: opts.dashed,
              spinning: circleSpinningRef.current || undefined,
            },
            animTickRef.current,
          );
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
              } else if (s.tool === 'jointChain') {
                const jc = s as StrokeJointChain;
                if (jc.nodes.length > 0) {
                  x0 = Math.min(...jc.nodes.map((p) => p.x));
                  y0 = Math.min(...jc.nodes.map((p) => p.y));
                  x1 = Math.max(...jc.nodes.map((p) => p.x));
                  y1 = Math.max(...jc.nodes.map((p) => p.y));
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
          } else if (sel.kind === 'jointNode') {
            const jc = strokesRef.current[sel.idx] as StrokeJointChain | undefined;
            if (jc && jc.nodes.length > 0) {
              x0 = Math.min(...jc.nodes.map((p) => p.x));
              y0 = Math.min(...jc.nodes.map((p) => p.y));
              x1 = Math.max(...jc.nodes.map((p) => p.x));
              y1 = Math.max(...jc.nodes.map((p) => p.y));
              const n = jc.nodes[sel.nodeIdx];
              if (n) {
                ctx.save();
                ctx.strokeStyle = '#FFD700';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(n.x, n.y, JOINT_NODE_RADIUS + 6, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
              }
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
          ctx.strokeStyle = '#007AFF';
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
          if (
            tgt &&
            (precisionAnchorPointerIdRef.current !== null || precisionHoverActiveRef.current)
          ) {
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
          if (precisionAnchorPointerIdRef.current !== null || precisionHoverActiveRef.current) {
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
            ctx.strokeStyle = 'rgba(0,0,0,0.55)';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(px, py, 10, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(255,255,255,0.98)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(px, py, 10, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(px - 12, py);
            ctx.lineTo(px + 12, py);
            ctx.moveTo(px, py - 12);
            ctx.lineTo(px, py + 12);
            ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.96)';
            ctx.beginPath();
            ctx.arc(px, py, 2, 0, Math.PI * 2);
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

        // ── Data column (draggable, persistent when active) ─────────────
        const mcItems = measurementColumnRef.current;
        if (mcItems !== null) {
          const mcW = 150;
          const mcLineH = 22;
          const hasItems = mcItems.length > 0;
          const mcH = hasItems ? mcItems.length * mcLineH + 28 : 48;
          const mcX = Math.round(Math.min(mcPosRef.current.x * W, W - mcW - 4));
          const mcY = Math.round(Math.min(mcPosRef.current.y * H, H - mcH - 4));

          ctx.save();
          ctx.fillStyle = 'rgba(0,0,0,0.75)';
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(mcX, mcY, mcW, mcH, 10);
          else ctx.rect(mcX, mcY, mcW, mcH);
          ctx.fill();

          // Header
          ctx.font = 'bold 10px -apple-system, sans-serif';
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          ctx.fillText('DATA COLUMN', mcX + 8, mcY + 14);

          // Drag handle dots
          ctx.fillStyle = 'rgba(255,255,255,0.25)';
          for (let d = 0; d < 3; d++) ctx.fillRect(mcX + mcW - 18 + d * 5, mcY + 10, 2, 2);

          if (hasItems) {
            ctx.font = '11px -apple-system, sans-serif';
            for (let i = 0; i < mcItems.length; i++) {
              const item = mcItems[i];
              const y = mcY + 28 + i * mcLineH;
              if (item.value === 0 && !item.unit) {
                // Text-only note
                ctx.fillStyle = 'rgba(255,255,255,0.8)';
                ctx.font = 'italic 11px -apple-system, sans-serif';
                ctx.fillText(item.label, mcX + 8, y);
                ctx.font = '11px -apple-system, sans-serif';
              } else if (item.unit === '' && item.value !== 0) {
                // Note with label:number (no unit)
                ctx.fillStyle = 'rgba(255,255,255,0.6)';
                ctx.fillText(item.label, mcX + 8, y);
                ctx.fillStyle = '#93C5FD';
                ctx.font = 'bold 12px -apple-system, sans-serif';
                ctx.fillText(`${item.value}`, mcX + mcW - 8 - ctx.measureText(`${item.value}`).width, y);
                ctx.font = '11px -apple-system, sans-serif';
              } else {
                ctx.fillStyle = 'rgba(255,255,255,0.6)';
                ctx.fillText(item.label, mcX + 8, y);
                ctx.fillStyle = '#93C5FD';
                ctx.font = 'bold 12px -apple-system, sans-serif';
                const valText = `${item.value}${item.unit}`;
                ctx.fillText(valText, mcX + mcW - 8 - ctx.measureText(valText).width, y);
                ctx.font = '11px -apple-system, sans-serif';
              }
            }
          } else {
            ctx.font = '11px -apple-system, sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.fillText('Draw to add measurements', mcX + 8, mcY + 34);
          }

          ctx.restore();
        }

        // ── Watermark logo (bottom-right corner) ──────────────────────────
        if (watermarkLoadedRef.current && watermarkRef.current) {
          const wm = watermarkRef.current;
          const wmSize = Math.max(28, Math.min(44, Math.round(W / 28)));
          const wmX = W - wmSize - 8;
          const wmY = H - wmSize - 8;
          ctx.save();
          ctx.globalAlpha = 0.5;
          ctx.drawImage(wm, wmX, wmY, wmSize, wmSize);
          ctx.restore();
        }

        if (renderWaitersRef.current.length > 0) {
          const waiters = renderWaitersRef.current.splice(0);
          waiters.forEach((resolve) => resolve());
        }
      };

      rafRef.current = requestAnimationFrame(render);
      return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Pointer helpers ────────────────────────────────────────────────────

    // ── Unified coordinate mapping (single source of truth) ─────────────────
    // clientToCanvasPx: client px → canvas device-pixel space (NO zoom/pan).
    //   Used by screen-space overlays such as the webcam PiP rect.
    // clientToLogical: client px → logical canvas space (inverse zoom/pan).
    //   Used by all drawing / selection / measurement coordinates.
    // The precision crosshair Y-offset is intentionally NOT part of either
    // function — it is owned by the precision override layer alone.
    const clientToCanvasPx = (clientX: number, clientY: number): Pt => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: (clientX - rect.left) * (canvas.width / rect.width),
        y: (clientY - rect.top) * (canvas.height / rect.height),
      };
    };

    const clientToLogical = (clientX: number, clientY: number): Pt => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const W = canvas.width;
      const H = canvas.height;
      const s = clientToCanvasPx(clientX, clientY);
      return {
        x: (s.x - (W / 2 + panXRef.current)) / zoomRef.current + W / 2,
        y: (s.y - (H / 2 + panYRef.current)) / zoomRef.current + H / 2,
      };
    };

    const getPos = (e: React.PointerEvent<HTMLCanvasElement>): Pt =>
      clientToLogical(e.clientX, e.clientY);

    const pressureWidth = (e: React.PointerEvent<HTMLCanvasElement>): number => {
      const base = drawingOptsRef.current.lineWidth;
      return e.pointerType === 'pen' && e.pressure > 0
        ? Math.max(1, base * e.pressure * 2.5)
        : base;
    };

    const getPosFromClientXY = (clientX: number, clientY: number): Pt =>
      clientToLogical(clientX, clientY);

    const commitObjectMultiplierFromPts = useCallback((p1: Pt, p2: Pt) => {
      if (racketSuggestTimerRef.current) {
        clearTimeout(racketSuggestTimerRef.current);
        racketSuggestTimerRef.current = null;
      }
      racketSuggestNormRef.current = null;
      setRacketHudOpen(false);
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

    const boundsCenterForContextual = (target: ContextualTarget): Pt | null => {
      if (target.kind === 'stroke') {
        const s = strokesRef.current[target.idx];
        if (!s) return null;
        if (s.tool === 'line' || s.tool === 'arrow' || s.tool === 'arrowAngle') {
          const sl = s as StrokeLine;
          return { x: (sl.p1.x + sl.p2.x) / 2, y: (sl.p1.y + sl.p2.y) / 2 };
        }
        if (
          s.tool === 'circle' || s.tool === 'bodyCircle' ||
          s.tool === 'rect' || s.tool === 'triangle'
        ) {
          const el = s as StrokeEllipse;
          return { x: el.cx, y: el.cy };
        }
        if (s.tool === 'jointChain') {
          const jc = s as StrokeJointChain;
          if (jc.nodes.length === 0) return null;
          const xs = jc.nodes.map((n) => n.x);
          const ys = jc.nodes.map((n) => n.y);
          return {
            x: (Math.min(...xs) + Math.max(...xs)) / 2,
            y: (Math.min(...ys) + Math.max(...ys)) / 2,
          };
        }
        return null;
      }
      const m = angleMeasRef.current[target.idx];
      return m ? { x: m.v.x, y: m.v.y } : null;
    };

    const buildContextualSnapshot = (target: ContextualTarget): ContextualStyleSnapshot => {
      const opts = drawingOptsRef.current;
      if (target.kind === 'stroke') {
        const s = strokesRef.current[target.idx];
        if (!s || s.tool === 'text' || s.tool === 'swingPath' || s.tool === 'manualSwing') {
          return DEFAULT_CONTEXTUAL_SNAPSHOT;
        }
        const styled = s as StrokeLine;
        return {
          color: styled.color,
          lineWidth: styled.lw,
          opacity: strokeOpacity(styled),
          dashed: styled.dashed ?? false,
          spinning: styled.spinning ?? false,
          outlineEraserEnabled:
            outlineEraserSizeRef.current > 0 && outlineErasingIdxRef.current === target.idx,
          outlineEraserSize: outlineEraserSizeRef.current,
        };
      }
      const m = angleMeasRef.current[target.idx];
      if (!m) return DEFAULT_CONTEXTUAL_SNAPSHOT;
      return {
        color: m.color ?? opts.color,
        lineWidth: m.lw ?? opts.lineWidth,
        opacity: strokeOpacity(m),
        dashed: m.dashed ?? false,
        spinning: m.spinning ?? false,
        outlineEraserEnabled: false,
        outlineEraserSize: outlineEraserSizeRef.current,
      };
    };

    const closeContextualStyle = useCallback(() => {
      if (contextualTargetRef.current) {
        pushHistory();
      }
      contextualTargetRef.current = null;
      setContextualOpen(false);
      if (
        selectionRef.current?.kind === 'stroke' ||
        selectionRef.current?.kind === 'angle' ||
        selectionRef.current?.kind === 'jointNode'
      ) {
        selectionRef.current = null;
      }
      renderDirtyRef.current = true;
    }, [pushHistory]);

    const notifyDrawCommitted = useCallback(() => {
      onDrawCommittedRef.current?.();
    }, []);

    const applyContextualChange = useCallback((patch: Partial<ContextualStyleSnapshot>) => {
      const target = contextualTargetRef.current;
      if (!target) return;

      if (patch.outlineEraserSize !== undefined) {
        outlineEraserSizeRef.current = patch.outlineEraserSize;
        onOutlineEraserSizeChange?.(patch.outlineEraserSize);
      }

      if (patch.outlineEraserEnabled === false) {
        outlineErasingIdxRef.current = -1;
        outlineEraserSizeRef.current = 0;
        onOutlineEraserSizeChange?.(0);
      } else if (patch.outlineEraserEnabled === true && target.kind === 'stroke') {
        const size = patch.outlineEraserSize ?? (outlineEraserSizeRef.current < 5 ? 15 : outlineEraserSizeRef.current);
        outlineEraserSizeRef.current = size;
        outlineErasingIdxRef.current = target.idx;
        onOutlineEraserSizeChange?.(size);
      }

      if (target.kind === 'stroke') {
        const strokes = [...strokesRef.current];
        const raw = strokes[target.idx];
        if (!raw || raw.tool === 'text' || raw.tool === 'swingPath' || raw.tool === 'manualSwing') return;
        const s = { ...raw } as StrokeLine;
        if (patch.color !== undefined) s.color = patch.color;
        if (patch.lineWidth !== undefined) s.lw = patch.lineWidth;
        if (patch.opacity !== undefined) s.opacity = patch.opacity;
        if (patch.dashed !== undefined) s.dashed = patch.dashed;
        if (patch.spinning !== undefined) s.spinning = patch.spinning || undefined;
        strokes[target.idx] = s as Stroke;
        strokesRef.current = strokes;
      } else {
        const angles = [...angleMeasRef.current];
        const m = { ...angles[target.idx] };
        if (patch.color !== undefined) m.color = patch.color;
        if (patch.lineWidth !== undefined) m.lw = patch.lineWidth;
        if (patch.opacity !== undefined) m.opacity = patch.opacity;
        if (patch.dashed !== undefined) m.dashed = patch.dashed;
        if (patch.spinning !== undefined) m.spinning = patch.spinning || undefined;
        angles[target.idx] = m;
        angleMeasRef.current = angles;
      }

      setContextualSnapshot(buildContextualSnapshot(target));
      renderDirtyRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [onOutlineEraserSizeChange]);

    const precisionToolUsesToggleDownUp = (t: ToolType): boolean =>
      t === 'erase' ||
      t === 'line' ||
      t === 'arrow' ||
      t === 'arrowAngle' ||
      t === 'circle' ||
      t === 'bodyCircle' ||
      t === 'rect' ||
      t === 'triangle';

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
            spinning: circleSpinningRef.current || undefined,
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
            spinning: circleSpinningRef.current || undefined,
          },
        ];
        pushHistory();
      }
      manualSwingPtsRef.current = [];
      manualSwingActiveRef.current = false;
      lastClickTimeRef.current = 0;
      lastClickPosRef.current = null;
    }, [pushHistory]);

    const finishJointChain = useCallback(() => {
      const pts = jointChainPtsRef.current;
      if (pts.length >= 2) {
        const opts = drawingOptsRef.current;
        strokesRef.current = [
          ...strokesRef.current,
          {
            tool: 'jointChain',
            nodes: [...pts],
            color: opts.color,
            lw: opts.lineWidth,
            dashed: opts.dashed ?? false,
            spinning: circleSpinningRef.current || undefined,
          },
        ];
        pushHistory();
        notifyDrawCommitted();
      }
      jointChainPtsRef.current = [];
      jointChainActiveRef.current = false;
      jointChainCursorRef.current = null;
      setJointChainUiActive(false);
      lastClickTimeRef.current = 0;
      lastClickPosRef.current = null;
    }, [pushHistory, notifyDrawCommitted]);

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
      if (s.tool === 'jointChain') {
        const jc = s as StrokeJointChain;
        if (jc.nodes.length === 0) return Infinity;
        let best = Infinity;
        for (let i = 0; i < jc.nodes.length - 1; i++) {
          best = Math.min(best, distToSegment(pos, jc.nodes[i], jc.nodes[i + 1]));
        }
        for (const n of jc.nodes) {
          best = Math.min(best, Math.hypot(pos.x - n.x, pos.y - n.y) - JOINT_NODE_RADIUS);
        }
        return best;
      }
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
      if (s.tool === 'jointChain') {
        const jc = s as StrokeJointChain;
        return {
          ...jc,
          nodes: jc.nodes.map((p) => ({ x: p.x + dx, y: p.y + dy })),
        };
      }
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
      if (!webcamActiveRef.current || !webcamVideoRef?.current || webcamVideoRef.current.readyState < 1 || webcamVideoRef.current.videoWidth <= 0) {
        return 'miss';
      }
      const canvas = canvasRef.current;
      if (!canvas) return 'miss';
      const cw = canvas.width;
      const ch = canvas.height;
      let pip = webcamPipRectRef.current;
      if (!pip.w || !pip.h) pip = defaultWebcamPipRect(cw, ch, webcamPipBottomInsetRef.current);
      pip = clampWebcamPip(pip, cw, ch, webcamPipBottomInsetRef.current);
      const hTol = WEBCAM_PIP_HANDLE_HIT / 2 + 4;
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

    // ── Tool primitives (single drawing source of truth) ────────────────────
    // Both real pointer gestures and the precision override layer call these
    // exact functions, so drawing has ONE entry contract regardless of input.

    /** Begin the active tool's stroke/action at a logical point. */
    const beginDrawToolAt = useCallback((pos: Pt, lw: number) => {
      const tool = activeToolRef.current;
      const opts = drawingOptsRef.current;
      switch (tool) {
        case 'pen':
          activeStrokeRef.current = {
            tool: 'pen',
            pts: [pos],
            color: opts.color,
            lw,
            dashed: opts.dashed ?? false,
            spinning: circleSpinningRef.current || undefined,
          };
          isDraggingRef.current = true;
          break;

        case 'line':
          dragStartRef.current = pos;
          activeStrokeRef.current = {
            tool: 'line',
            p1: pos,
            p2: pos,
            color: opts.color,
            lw,
            dashed: opts.dashed ?? false,
            spinning: circleSpinningRef.current || undefined,
          };
          isDraggingRef.current = true;
          break;

        case 'arrow':
        case 'arrowAngle':
          dragStartRef.current = pos;
          activeStrokeRef.current = {
            tool,
            p1: pos,
            p2: pos,
            color: opts.color,
            lw,
            dashed: opts.dashed ?? false,
            spinning: circleSpinningRef.current || undefined,
          };
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
          };
          isDraggingRef.current = true;
          break;

        case 'angle':
          if (anglePhaseRef.current === 0) {
            angleVRef.current = pos;
            anglePhaseRef.current = 1;
            setAngleUiPhase(1);
            liveAngleRef.current = { phase: 1, v: pos, p1: pos, cursor: pos };
          } else if (anglePhaseRef.current === 1) {
            angleP1Ref.current = pos;
            anglePhaseRef.current = 2;
            setAngleUiPhase(2);
            liveAngleRef.current = { phase: 2, v: angleVRef.current!, p1: pos, cursor: pos };
          } else {
            const v  = angleVRef.current!;
            const p1 = angleP1Ref.current!;
            angleMeasRef.current = [
              ...angleMeasRef.current,
              {
                v, p1, p2: pos, deg: calcAngleDeg(p1, v, pos),
                color: opts.color,
                lw,
                dashed: opts.dashed ?? false,
                spinning: circleSpinningRef.current || undefined,
              },
            ];
            const commitDeg = calcAngleDeg(p1, v, pos);
            anglePhaseRef.current = 0;
            setAngleUiPhase(0);
            angleVRef.current   = null;
            angleP1Ref.current  = null;
            liveAngleRef.current = null;
            pushHistory();
            notifyDrawCommitted();
            onMeasurementCommitRef.current?.({ type: 'angle', value: Math.round(commitDeg), unit: '°' });
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

        case 'jointChain': {
          const now = Date.now();
          const last = lastClickPosRef.current;
          const timeSinceLast = now - lastClickTimeRef.current;
          const distSinceLast = last ? Math.hypot(pos.x - last.x, pos.y - last.y) : Infinity;
          const isDoubleClick = timeSinceLast < 400 && distSinceLast < 12;

          if (isDoubleClick && jointChainActiveRef.current) {
            finishJointChain();
          } else {
            if (!jointChainActiveRef.current) {
              jointChainActiveRef.current = true;
              setJointChainUiActive(true);
              jointChainPtsRef.current = [pos];
            } else {
              jointChainPtsRef.current = [...jointChainPtsRef.current, pos];
            }
            jointChainCursorRef.current = pos;
          }
          lastClickTimeRef.current = now;
          lastClickPosRef.current = pos;
          renderDirtyRef.current = true;
          break;
        }

        case 'text': {
          const canvas = canvasRef.current;
          if (!canvas) break;
          const { clientX, clientY } = logicalPtToClient(pos);
          const rect = canvas.getBoundingClientRect();
          const scaledFontSize = opts.fontSize * zoomRef.current * (rect.height / canvas.height);
          setNewTextDraft({
            pos,
            left: clientX - rect.left,
            top: clientY - rect.top,
            fontSize: scaledFontSize,
            color: opts.color,
          });
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
    }, [pushHistory, notifyDrawCommitted, finishSwingPath, finishManualSwingPath, finishJointChain, eraseAt, videoRef, onProcessingStatus]);

    /** Update the in-progress active stroke to a new logical point. */
    const updateActiveStrokeAt = useCallback((pos: Pt) => {
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
      renderDirtyRef.current = true;
    }, []);

    /** Commit the active stroke (if non-degenerate) into the stroke list. */
    const commitActiveStroke = useCallback(() => {
      isDraggingRef.current = false;
      const active = activeStrokeRef.current;
      activeStrokeRef.current = null;
      if (!active) return;
      if (active.tool === 'pen' && (active as StrokePen).pts.length < 1) return;
      if (active.tool === 'circle' || active.tool === 'bodyCircle') {
        if ((active as StrokeEllipse).rx < 2) return;
      } else if (active.tool === 'rect') {
        if ((active as StrokeRect).rx < 2) return;
      } else if (active.tool === 'triangle') {
        if ((active as StrokeTriangle).rx < 2) return;
      }
      strokesRef.current = [...strokesRef.current, active];
      pushHistory();
      if (isContextualStrokeTool(active.tool)) {
        notifyDrawCommitted();
      }
      // Report measurement to the column
      const toolName = active.tool as string;
      if (toolName === 'arrowAngle' || toolName === 'arrow' || toolName === 'ruler' || toolName === 'line') {
        const s = active as any;
        if ((toolName === 'arrowAngle' || toolName === 'arrow') && s.p1 && s.p2) {
          const dx = s.p2.x - s.p1.x;
          const dy = s.p2.y - s.p1.y;
          const deg = Math.round(((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360);
          onMeasurementCommitRef.current?.({ type: 'arrowAngle', value: deg, unit: '°' });
        } else if (toolName === 'ruler' && s.p1 && s.p2) {
          const dist = Math.round(Math.hypot(s.p2.x - s.p1.x, s.p2.y - s.p1.y));
          onMeasurementCommitRef.current?.({ type: 'ruler', value: dist, unit: 'px' });
        } else if (toolName === 'line' && s.p1 && s.p2) {
          const dx = s.p2.x - s.p1.x;
          const dy = s.p2.y - s.p1.y;
          const deg = Math.round(((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360);
          onMeasurementCommitRef.current?.({ type: 'angle', value: deg, unit: '°' });
        }
      }
    }, [pushHistory, notifyDrawCommitted]);

    /**
     * Discard any tentative single-finger interaction so that claiming a
     * 2-finger pinch never leaves a half-started stroke / pan / selection drag
     * that would commit on release.
     */
    const rollbackTentativeGesture = useCallback(() => {
      activeStrokeRef.current = null;
      isDraggingRef.current = false;
      isPanningRef.current = false;
      panStartRef.current = null;
      outlineErasingIdxRef.current = -1;
      outlineEraserPosRef.current = null;
      selectionRef.current = null;
      webcamPipDragRef.current = null;
    }, []);

    // PiP lives in canvas device-pixel space (overlay, unaffected by zoom/pan),
    // so it maps through canvas-px — NOT the logical-space mapper. Declared here
    // (ahead of the pointer pipeline) so onPointerDown can reference it.
    const getPosFromPointerEvent = useCallback((e: { clientX: number; clientY: number }) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height),
      };
    }, []);

    // ── Pointer down ───────────────────────────────────────────────────────

    const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvasEl = e.target as HTMLCanvasElement;
      const toolEarly = activeToolRef.current;

      // ── Normalize: register this pointer in the single active-pointer map ──
      activePointersRef.current.set(e.pointerId, {
        clientX: e.clientX,
        clientY: e.clientY,
        pointerType: e.pointerType,
      });
      const touchPointers = () =>
        [...activePointersRef.current.values()].filter((p) => p.pointerType === 'touch');

      // ── Gesture lock gate ─────────────────────────────────────────────────
      // While the precision anchor owns the gesture, any other finger is a
      // discrete commit tap routed to the precision consumer — never a new
      // consumer, never a pinch.
      if (
        precisionAnchorPointerIdRef.current !== null &&
        e.pointerId !== precisionAnchorPointerIdRef.current
      ) {
        e.preventDefault();
        const ch =
          precisionCrosshairDisplayRef.current ?? precisionCrosshairTargetRef.current;
        if (ch) precisionCommitRef.current?.(ch);
        return;
      }

      // ── Priority router (rule 1): webcam PiP (Select tool only) ─────────
      // PiP is screen-space → map through canvas-px (NOT logical/zoom space).
      if (webcamActiveRef.current && toolEarly === 'select') {
        const posPip = getPosFromPointerEvent(e);
        const pipHitEarly = webcamPipHitTest(posPip);
        if (pipHitEarly !== 'miss') {
          if (!webcamPipSelectedRef.current) {
            webcamPipSelectedRef.current = true;
            renderDirtyRef.current = true;
            canvasEl.setPointerCapture(e.pointerId);
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          beginWebcamPipDragAt(posPip, pipHitEarly);
          canvasEl.setPointerCapture(e.pointerId);
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (webcamPipSelectedRef.current) {
          webcamPipSelectedRef.current = false;
          renderDirtyRef.current = true;
        }
      }

      // ── Priority router (rule 2): two-finger canvas/PiP pinch ─────────────
      // Claimed the instant the 2nd touch arrives (no precision active). Any
      // tentative single-finger consumer the 1st finger started is rolled back.
      if (e.pointerType === 'touch' && touchPointers().length === 2) {
        const tps = touchPointers();
        const cClient = {
          clientX: (tps[0].clientX + tps[1].clientX) / 2,
          clientY: (tps[0].clientY + tps[1].clientY) / 2,
        };
        rollbackTentativeGesture();
        const canvas = canvasRef.current;
        const t1 = { clientX: tps[0].clientX, clientY: tps[0].clientY } as Touch;
        const t2 = { clientX: tps[1].clientX, clientY: tps[1].clientY } as Touch;
        if (
          webcamActiveRef.current &&
          activeToolRef.current === 'select' &&
          canvas &&
          webcamPipHitTest(getPosFromPointerEvent(cClient)) !== 'miss' &&
          tryStartWebcamPinch(t1, t2, canvas)
        ) {
          // PiP pinch (webcamPinchRef now set); handled in onPointerMove.
        } else if (canvas) {
          webcamPinchRef.current = null;
          const rect = canvas.getBoundingClientRect();
          const focalX = (cClient.clientX - rect.left) * (canvas.width / rect.width);
          const focalY = (cClient.clientY - rect.top) * (canvas.height / rect.height);
          canvasPinchRef.current = {
            lastDist: Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY),
            focalX,
            focalY,
          };
        }
        e.preventDefault();
        return;
      }

      // ── Priority router (rule 3): precision anchor acquisition ────────────
      const precisionTouchEligible =
        precisionTouchDrawRef.current &&
        e.pointerType === 'touch' &&
        toolEarly !== 'zoom' &&
        toolEarly !== 'objectMultiplier';

      if (precisionTouchEligible && precisionAnchorPointerIdRef.current === null) {
        precisionAnchorPointerIdRef.current = e.pointerId;
        const ch = clientToLogical(e.clientX, e.clientY - PRECISION_CURSOR_OFFSET_Y);
        precisionCrosshairTargetRef.current = ch;
        precisionCrosshairDisplayRef.current = { ...ch };
        precisionFadeStartRef.current = null;
        canvasEl.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }

      canvasEl.setPointerCapture(e.pointerId);
      const pos  = getPos(e);
      const lw   = pressureWidth(e);
      const tool = activeToolRef.current;
      const opts = drawingOptsRef.current;

      if (contextualTargetRef.current && outlineEraserSizeRef.current <= 0) {
        closeContextualStyle();
      }

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
      // select/skeleton tool while zoomed, touch while zoomed, or panMode
      // enabled at ANY zoom level (no prior zoom-in required).
      const zoomed = zoomRef.current > 1;
      const isDrawingTool =
        tool === 'pen' || tool === 'line' || tool === 'arrow' || tool === 'arrowAngle' ||
        tool === 'circle' || tool === 'bodyCircle' || tool === 'rect' || tool === 'triangle' ||
        tool === 'angle' || tool === 'text' || tool === 'erase' || tool === 'ballShadow' ||
        tool === 'swingPath' || tool === 'manualSwing' || tool === 'jointChain';

      // If the pointer lands on the webcam PiP, preserve PiP drag/resize even
      // when pan mode is active.  We pre-check here so the PiP hit can veto
      // the pan-mode condition inside shouldPan.
      const pipVeto =
        webcamActiveRef.current &&
        tool === 'select' &&
        webcamPipHitTest(getPosFromPointerEvent(e)) !== 'miss';

      const shouldPan =
        !pipVeto && (
          e.button === 1 ||
          spaceHeldRef.current ||
          (tool === 'zoom' && e.button === 0 && zoomed) ||
          // Pan mode works at ANY zoom level — no prior zoom-in required.
          panModeEnabledRef.current ||
          (zoomed && !isDrawingTool) ||
          // Touch one-finger drag while zoomed always pans (no activation needed).
          (zoomed && e.pointerType === 'touch' && !precisionTouchDrawRef.current)
        );
      if (shouldPan) {
        isPanningRef.current = true;
        panStartRef.current = { x: e.clientX, y: e.clientY, px: panXRef.current, py: panYRef.current };
        e.preventDefault();
        return;
      }

      // ── Measurement column drag ──────────────────────────────────────
      const mcItemsNow = measurementColumnRef.current;
      if (mcItemsNow !== null) {
        const canvas = canvasRef.current;
        if (canvas) {
          const cW = canvas.width, cH = canvas.height;
          const mW = 150, mLineH = 22, mH = mcItemsNow.length > 0 ? mcItemsNow.length * mLineH + 28 : 48;
          const mX = Math.min(mcPosRef.current.x * cW, cW - mW - 4);
          const mY = Math.min(mcPosRef.current.y * cH, cH - mH - 4);

          // Drag the column
          if (pos.x >= mX && pos.x <= mX + mW && pos.y >= mY && pos.y <= mY + mH) {
            mcDraggingRef.current = { startX: pos.x, startY: pos.y, origX: mcPosRef.current.x, origY: mcPosRef.current.y };
            isDraggingRef.current = true;
            e.preventDefault();
            return;
          }
        }
      }

      // ── Skeleton: click to lock detection on the player ─────────────────
      if (!skeletonLockedRef.current && (tool === 'skeleton' || skeletonWaitingForClickRef.current)) {
        const video = videoRef.current;
        if (video && video.videoWidth > 0) {
          const bounds = videoBoundsRef.current;
          if (bounds && bounds.dw > 0 && bounds.dh > 0) {
            const normX = (pos.x - bounds.dx) / bounds.dw;
            const normY = (pos.y - bounds.dy) / bounds.dh;
            if (normX >= 0 && normX <= 1 && normY >= 0 && normY <= 1) {
              poseBridgeRef.current?.setFocusPoint({ x: normX, y: normY });
              onProcessingStatus?.('Skeleton locked on player');
              skeletonSuppressedRef.current = false;
              skeletonWaitingForClickRef.current = false;
              renderDirtyRef.current = true;
              onSkeletonFocusSet?.();
            }
          }
        }
        // Only block event if skeleton is the active tool
        if (tool === 'skeleton') { e.preventDefault(); return; }
        // Otherwise fall through to let drawing tools handle the click
      }

      // ── Select tool: stroke / joint selection ───────────────────────────
      if (tool === 'select') {
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
        const nodeHitR = e.pointerType === 'touch' ? JOINT_NODE_HIT_TOUCH : JOINT_NODE_HIT_POINTER;
        let best: Selection = null;
        let bestDist = Infinity;

        for (let i = strokesRef.current.length - 1; i >= 0; i--) {
          const s = strokesRef.current[i];
          if (s.tool !== 'jointChain') continue;
          const jc = s as StrokeJointChain;
          for (let ni = jc.nodes.length - 1; ni >= 0; ni--) {
            const d = Math.hypot(pos.x - jc.nodes[ni].x, pos.y - jc.nodes[ni].y);
            if (d < nodeHitR && d < bestDist) {
              bestDist = d;
              best = { kind: 'jointNode', idx: i, nodeIdx: ni, start: pos, orig: jc };
            }
          }
        }

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
          if (best.kind === 'stroke' && outlineEraserSizeRef.current > 0) {
            const hitStroke = strokesRef.current[best.idx];
            const eraserEligible =
              hitStroke &&
              (hitStroke.tool === 'line' ||
                hitStroke.tool === 'arrow' ||
                hitStroke.tool === 'arrowAngle' ||
                hitStroke.tool === 'pen' ||
                hitStroke.tool === 'circle' ||
                hitStroke.tool === 'bodyCircle' ||
                hitStroke.tool === 'rect' ||
                hitStroke.tool === 'triangle');
            if (eraserEligible) {
              const eraserR = outlineEraserSizeRef.current;
              const dot: EraserDot = { x: pos.x, y: pos.y, radius: eraserR };
              const prev = (hitStroke as StrokeLine | StrokePen | StrokeEllipse).eraserStrokes ?? [];
              const updated = { ...hitStroke, eraserStrokes: [...prev, dot] };
              strokesRef.current = [
                ...strokesRef.current.slice(0, best.idx),
                updated,
                ...strokesRef.current.slice(best.idx + 1),
              ];
              outlineErasingIdxRef.current = best.idx;
              outlineEraserPosRef.current = pos;
              selectionRef.current = { kind: 'stroke', idx: best.idx, start: pos, orig: updated as Stroke };
              isDraggingRef.current = true;
              return;
            }
          }
          selectionRef.current = best;
          isDraggingRef.current = true;
          return;
        }

        selectionRef.current = null;
        isDraggingRef.current = false;
        return;
      }

      // Outline eraser: line / arrow / pen
      {
        const eraserR = outlineEraserSizeRef.current;
        if (eraserR > 0 && (tool === 'line' || tool === 'arrow' || tool === 'arrowAngle' || tool === 'pen')) {
          let bestIdx = -1;
          let bestD = Infinity;
          strokesRef.current.forEach((s, i) => {
            if (s.tool !== 'line' && s.tool !== 'arrow' && s.tool !== 'arrowAngle' && s.tool !== 'pen') return;
            const d = hitTestStroke(s, pos);
            const strokeLw = (s as { lw?: number }).lw ?? 2;
            if (d < bestD && d < 36 + strokeLw * 0.75) {
              bestD = d;
              bestIdx = i;
            }
          });
          if (bestIdx >= 0) {
            const hitStroke = strokesRef.current[bestIdx];
            const dot: EraserDot = { x: pos.x, y: pos.y, radius: eraserR };
            const prev = (hitStroke as StrokeLine | StrokeArrow | StrokePen).eraserStrokes ?? [];
            const updated = { ...hitStroke, eraserStrokes: [...prev, dot] };
            strokesRef.current = [
              ...strokesRef.current.slice(0, bestIdx),
              updated,
              ...strokesRef.current.slice(bestIdx + 1),
            ];
            outlineErasingIdxRef.current = bestIdx;
            outlineEraserPosRef.current = pos;
            isDraggingRef.current = true;
            return;
          }
        }
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
            hitStroke.tool === 'circle' ||
            hitStroke.tool === 'bodyCircle' ||
            hitStroke.tool === 'rect' ||
            hitStroke.tool === 'triangle';
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
          selectionRef.current = { kind: 'stroke', idx, start: pos, orig: strokesRef.current[idx] };
          isDraggingRef.current = true;
          return;
        }
      }

      beginDrawToolAt(pos, lw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [beginDrawToolAt, eraseAt, videoRef, webcamPipHitTest, beginWebcamPipDragAt, getPosFromPointerEvent, tryStartWebcamPinch, rollbackTentativeGesture]);

    // ── Pointer move ───────────────────────────────────────────────────────

    const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      const pos = getPos(e);

      // Keep the active-pointer map current (used for multi-touch reconstruction).
      if (activePointersRef.current.has(e.pointerId)) {
        activePointersRef.current.set(e.pointerId, {
          clientX: e.clientX,
          clientY: e.clientY,
          pointerType: e.pointerType,
        });
      }

      // ── Measurement column drag ──────────────────────────────────────
      if (mcDraggingRef.current && isDraggingRef.current) {
        const canvas = canvasRef.current;
        if (canvas) {
          const dx = pos.x - mcDraggingRef.current.startX;
          const dy = pos.y - mcDraggingRef.current.startY;
          mcPosRef.current = {
            x: Math.max(0, Math.min(0.9, mcDraggingRef.current.origX + dx / canvas.width)),
            y: Math.max(0, Math.min(0.9, mcDraggingRef.current.origY + dy / canvas.height)),
          };
          renderDirtyRef.current = true;
        }
        return;
      }

      // ── Pinch consumers (own the gesture; nothing else runs) ──────────────
      const touchPts = [...activePointersRef.current.values()].filter((p) => p.pointerType === 'touch');
      if ((canvasPinchRef.current || webcamPinchRef.current) && touchPts.length >= 2) {
        const t1 = touchPts[0];
        const t2 = touchPts[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const canvas = canvasRef.current;
        if (webcamPinchRef.current && canvas) {
          const base = webcamPinchRef.current;
          if (base.dist > 0) {
            applyWebcamPinchScale(dist / base.dist);
            queuePipUiSync();
          }
        } else if (canvasPinchRef.current && canvas) {
          const pinch = canvasPinchRef.current;
          const last = pinch.lastDist;
          const midClientX = (t1.clientX + t2.clientX) / 2;
          const midClientY = (t1.clientY + t2.clientY) / 2;
          const rect = canvas.getBoundingClientRect();
          const focalX = (midClientX - rect.left) * (canvas.width / rect.width);
          const focalY = (midClientY - rect.top) * (canvas.height / rect.height);
          if (last > 0) {
            applyZoomAtRef.current(zoomRef.current * (dist / last), focalX, focalY);
          }
          canvasPinchRef.current = { lastDist: dist, focalX, focalY };
        }
        e.preventDefault();
        return;
      }

      // ── Precision anchor move: reposition crosshair (offset owned here) ────
      if (
        precisionAnchorPointerIdRef.current === e.pointerId &&
        e.pointerType === 'touch' &&
        activeToolRef.current !== 'zoom'
      ) {
        const ch = clientToLogical(e.clientX, e.clientY - PRECISION_CURSOR_OFFSET_Y);
        precisionCrosshairTargetRef.current = ch;
        precisionCrosshairDisplayRef.current = { ...ch };
        renderDirtyRef.current = true;
        e.preventDefault();
        // Between a two-step shape's begin and commit taps, the endpoint tracks
        // the crosshair. Pen dabs commit immediately, so there's nothing to drag.
        if (isDraggingRef.current && activeStrokeRef.current) {
          updateActiveStrokeAt(ch);
        }
        return;
      }
      const tool = activeToolRef.current;

      if (webcamActiveRef.current && tool === 'select' && !webcamPipDragRef.current && e.pointerType !== 'touch') {
        const pipHoverHit = webcamPipHitTest(getPosFromPointerEvent(e));
        const hovered = pipHoverHit !== 'miss';
        if (hovered !== webcamPipHoveredRef.current) {
          webcamPipHoveredRef.current = hovered;
          renderDirtyRef.current = true;
        }
      }

      // ── Pan drag ────────────────────────────────────────────────────────
      if (isPanningRef.current && panStartRef.current) {
        const canvas = canvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const scaleX = canvas.width  / rect.width;
          const scaleY = canvas.height / rect.height;
          panXRef.current = panStartRef.current.px + (e.clientX - panStartRef.current.x) * scaleX;
          panYRef.current = panStartRef.current.py + (e.clientY - panStartRef.current.y) * scaleY;
          const { dx, dy, dw, dh } = videoBoundsRef.current;
          const c = clampPanToLetterbox(
            panXRef.current,
            panYRef.current,
            zoomRef.current,
            canvas.width,
            canvas.height,
            dx,
            dy,
            dw,
            dh,
          );
          panXRef.current = c.x;
          panYRef.current = c.y;
          renderDirtyRef.current = true;
        }
        return;
      }

      // ── Webcam PiP drag / resize ─────────────────────────────────────────
      const pipDrag = webcamPipDragRef.current;
      if (pipDrag) {
        // PiP lives in canvas device-pixel space (overlay, unaffected by
        // zoom/pan), and pointer-down anchored it via getPosFromPointerEvent.
        // Using the logical `pos` here made drag/resize jump whenever zoom !== 1.
        applyWebcamPipDragMove(getPosFromPointerEvent(e));
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
        if (sel.kind === 'jointNode') {
          const jc = sel.orig;
          const nodes = [...jc.nodes];
          const origNode = sel.orig.nodes[sel.nodeIdx];
          if (origNode) {
            nodes[sel.nodeIdx] = {
              x: origNode.x + dx,
              y: origNode.y + dy,
            };
            const updated: StrokeJointChain = { ...jc, nodes };
            strokesRef.current = [
              ...strokesRef.current.slice(0, sel.idx),
              updated,
              ...strokesRef.current.slice(sel.idx + 1),
            ];
          }
        } else if (sel.kind === 'stroke') {
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
        if (s && (
          s.tool === 'circle' || s.tool === 'bodyCircle' || s.tool === 'rect' || s.tool === 'triangle' ||
          s.tool === 'line' || s.tool === 'arrow' || s.tool === 'arrowAngle' || s.tool === 'pen'
        )) {
          const eraserR = outlineEraserSizeRef.current;
          const dot: EraserDot = { x: pos.x, y: pos.y, radius: eraserR };
          const prev = (s as StrokeEllipse | StrokeRect | StrokeTriangle | StrokeLine | StrokeArrow | StrokePen).eraserStrokes ?? [];
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

      // Joint chain live preview cursor
      if (tool === 'jointChain' && jointChainActiveRef.current) {
        jointChainCursorRef.current = pos;
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
      if (outlineEraserSizeRef.current > 0 && (
        tool === 'circle' || tool === 'bodyCircle' || tool === 'rect' || tool === 'triangle' ||
        tool === 'line' || tool === 'arrow' || tool === 'arrowAngle' || tool === 'pen'
      )) {
        outlineEraserPosRef.current = pos;
        renderDirtyRef.current = true;
      }

      if (!isDraggingRef.current) return;
      if (tool === 'erase') { eraseAt(pos); return; }

      updateActiveStrokeAt(pos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [eraseAt, applyWebcamPipDragMove, updateActiveStrokeAt, applyWebcamPinchScale, queuePipUiSync, getPosFromPointerEvent]);

    // ── Pointer up ─────────────────────────────────────────────────────────

    const onPointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      // ── Normalize: this pointer is gone ───────────────────────────────────
      activePointersRef.current.delete(e.pointerId);
      const remainingTouch = [...activePointersRef.current.values()].filter(
        (p) => p.pointerType === 'touch',
      ).length;

      // ── End measurement column drag ────────────────────────────────────
      if (mcDraggingRef.current) {
        mcDraggingRef.current = null;
        isDraggingRef.current = false;
        onMeasurementColumnDrag?.(mcPosRef.current);
        try { (e.target as HTMLCanvasElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
        return;
      }

      // ── End an active pinch once a finger lifts ───────────────────────────
      if (canvasPinchRef.current || webcamPinchRef.current) {
        if (remainingTouch < 2) {
          canvasPinchRef.current = null;
          webcamPinchRef.current = null;
        }
        try {
          (e.target as HTMLCanvasElement).releasePointerCapture(e.pointerId);
        } catch {
          /* noop */
        }
        return;
      }

      // ── Precision anchor lift: finalize any in-progress two-step shape ────
      if (
        precisionAnchorPointerIdRef.current === e.pointerId &&
        e.pointerType === 'touch'
      ) {
        if (isDraggingRef.current && activeStrokeRef.current !== null) {
          commitActiveStroke();
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
        } else if (finSel.kind === 'jointNode') {
          const s = strokesRef.current[finSel.idx] as StrokeJointChain | undefined;
          selectionRef.current =
            s && s.tool === 'jointChain'
              ? { kind: 'jointNode', idx: finSel.idx, nodeIdx: finSel.nodeIdx, start: finSel.start, orig: s }
              : null;
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
            } else {
              stroRegionCallbackRef.current?.(null);
            }
          } else {
            stroRegionCallbackRef.current?.(null);
          }
        } else {
          stroRegionCallbackRef.current?.(null);
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

      commitActiveStroke();
    }, [pushHistory, commitActiveStroke]);

    // ── Pointer cancel ───────────────────────────────────────────────────────
    // OS / browser interruptions (incoming call, gesture nav, pointer steal)
    // route here so the gesture lock is always released — the single teardown
    // that prevents stuck isDragging / activeStroke / pinch / pip state.
    const onPointerCancel = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      activePointersRef.current.delete(e.pointerId);
      const remainingTouch = [...activePointersRef.current.values()].filter(
        (p) => p.pointerType === 'touch',
      ).length;
      if (remainingTouch < 2) {
        canvasPinchRef.current = null;
        webcamPinchRef.current = null;
      }
      if (precisionAnchorPointerIdRef.current === e.pointerId) {
        precisionAnchorPointerIdRef.current = null;
        precisionFadeStartRef.current = performance.now();
      }
      if (activePointersRef.current.size === 0) {
        // Last pointer gone: discard any in-progress transient interaction.
        activeStrokeRef.current = null;
        isDraggingRef.current = false;
        isPanningRef.current = false;
        panStartRef.current = null;
        outlineErasingIdxRef.current = -1;
        outlineEraserPosRef.current = null;
        webcamPipDragRef.current = null;
        if (isSelectingStroRegionRef.current) {
          stroRegionCallbackRef.current?.(null);
          isSelectingStroRegionRef.current = false;
          stroRegionCallbackRef.current = null;
          stroRegionStartRef.current = null;
          stroRegionCurrentRef.current = null;
        }
      }
      try {
        (e.target as HTMLCanvasElement).releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    }, []);

    // ── Precision override layer (synchronous; no synthetic events) ──────────
    // The anchor finger positions the crosshair; a second-finger tap is a
    // discrete "commit" signal delivered directly to the shared tool
    // primitives. There is no synthetic pointer dispatch, no microtask, and no
    // re-entry into onPointerDown/onPointerUp — one coordinate source, one
    // dispatch path.
    const precisionCommitAt = (ch: Pt) => {
      const tool = activeToolRef.current;
      if (
        tool === 'zoom' ||
        tool === 'skeleton' ||
        tool === 'select' ||
        tool === 'ballShadow' ||
        tool === 'objectMultiplier'
      ) {
        return;
      }
      precisionCrosshairTargetRef.current = ch;
      precisionCrosshairDisplayRef.current = { ...ch };
      precisionRippleRef.current = { x: ch.x, y: ch.y, t0: performance.now() };
      renderDirtyRef.current = true;
      const baseLw = drawingOptsRef.current.lineWidth;

      // Erase: discrete tap, never holds a drag.
      if (tool === 'erase') {
        beginDrawToolAt(ch, baseLw);
        isDraggingRef.current = false;
        return;
      }

      // Pen: each tap is a single dab (begin + commit immediately).
      if (tool === 'pen') {
        beginDrawToolAt(ch, baseLw);
        const pen = activeStrokeRef.current as StrokePen | null;
        if (pen?.tool === 'pen' && pen.pts.length === 1) {
          pen.pts.push({ ...ch });
        }
        commitActiveStroke();
        return;
      }

      // Two-step drag tools (line/arrow/arrowAngle/circle/bodyCircle/rect/triangle):
      // first tap begins at the crosshair, second tap finalizes at the crosshair.
      // Between taps the anchor move repositions the endpoint (see onPointerMove).
      if (precisionToolUsesToggleDownUp(tool)) {
        if (isDraggingRef.current && activeStrokeRef.current !== null) {
          updateActiveStrokeAt(ch);
          commitActiveStroke();
        } else {
          beginDrawToolAt(ch, baseLw);
        }
        return;
      }

      // Multi-step / discrete tools (angle, jointChain, manualSwing, swingPath, text):
      // each tap advances the tool's own state machine.
      beginDrawToolAt(ch, baseLw);
    };

    precisionCommitRef.current = precisionCommitAt;

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

    const commitNewTextDraft = useCallback(() => {
      const draft = newTextDraft;
      if (!draft) return;
      const val = (newTextInputRef.current?.value ?? '').trim();
      if (val) {
        strokesRef.current = [
          ...strokesRef.current,
          {
            tool: 'text',
            pos: draft.pos,
            text: val,
            color: draft.color,
            fontSize: drawingOptsRef.current.fontSize,
          },
        ];
        pushHistory();
      }
      setNewTextDraft(null);
    }, [newTextDraft, pushHistory]);

    const coachToolHint = (() => {
      const t = activeTool;
      if (t === 'jointChain' && jointChainUiActive) {
        return 'Tap each joint along the chain · double-tap to finish';
      }
      if (t === 'angle') {
        if (angleUiPhase === 0) return 'Angle: tap the corner (vertex)';
        if (angleUiPhase === 1) return 'Angle: tap the first side';
        return 'Angle: tap the second side';
      }
      if (t === 'manualSwing') {
        return 'Tap along the path · double-tap to finish';
      }
      return null;
    })();

    // Double-click to finish swing path on desktop OR edit text
    const onDoubleClick = useCallback((e: React.MouseEvent) => {
      if (activeToolRef.current === 'swingPath' && swingDrawingRef.current) {
        finishSwingPath();
      }
      if (activeToolRef.current === 'manualSwing' && manualSwingActiveRef.current) {
        finishManualSwingPath();
      }
      if (activeToolRef.current === 'jointChain' && jointChainActiveRef.current) {
        finishJointChain();
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
    }, [finishSwingPath, finishManualSwingPath, finishJointChain]);

    const cursorFor: Partial<Record<ToolType, string>> = {
      pen: 'crosshair', erase: 'cell', text: 'text', line: 'crosshair',
      angle: 'crosshair', swingPath: 'crosshair', manualSwing: 'crosshair',
      jointChain: 'crosshair', ballShadow: 'crosshair',
      objectMultiplier: 'crosshair',
      zoom: isPanningRef.current
        ? 'grabbing'
        : spaceHeldRef.current
          ? 'grab'
          : zoomRef.current > 1.0 ? 'zoom-out' : 'zoom-in',
      select: zoomRef.current > 1 ? (isPanningRef.current ? 'grabbing' : 'grab') : 'default',
    };
    if (panModeEnabled) {
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
      cursorFor.line = 'none';
      cursorFor.arrow = 'none';
      cursorFor.arrowAngle = 'none';
      cursorFor.pen = 'none';
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
      if (!pip.w || !pip.h) pip = defaultWebcamPipRect(canvas.width, canvas.height, webcamPipBottomInsetRef.current);
      if (x < pip.x || x > pip.x + pip.w || y < pip.y || y > pip.y + pip.h) return;
      const cx = pip.x + pip.w / 2;
      const cy = pip.y + pip.h / 2;
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
      const nw = Math.max(72, Math.round(pip.w * factor));
      const nh = Math.round(nw / WEBCAM_PIP_ASPECT);
      const nx = cx - nw / 2;
      const ny = cy - nh / 2;
      webcamPipRectRef.current = clampWebcamPip(
        { x: nx, y: ny, w: nw, h: nh },
        canvas.width,
        canvas.height,
        webcamPipBottomInsetRef.current,
      );
      renderDirtyRef.current = true;
      queuePipUiSync();
      e.preventDefault();
      e.stopPropagation();
    }, [queuePipUiSync]);

    const pipOverlayRef = useRef<HTMLDivElement>(null);

    const onPipOverlayPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
      if (activeToolRef.current !== 'select') return;
      e.stopPropagation();
      const pos = getPosFromPointerEvent(e);
      const pipHit = webcamPipHitTest(pos);
      if (!webcamPipSelectedRef.current) {
        webcamPipSelectedRef.current = true;
        renderDirtyRef.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
      beginWebcamPipDragAt(pos, pipHit === 'miss' ? 'inside' : pipHit);
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    }, [beginWebcamPipDragAt, getPosFromPointerEvent, webcamPipHitTest]);

    const onPipOverlayPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
      if (!webcamPipDragRef.current) return;
      applyWebcamPipDragMove(getPosFromPointerEvent(e));
      e.preventDefault();
    }, [applyWebcamPipDragMove, getPosFromPointerEvent]);

    const onPipOverlayPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
      if (webcamPipDragRef.current) {
        webcamPipDragRef.current = null;
        isDraggingRef.current = false;
      }
      webcamPinchRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    }, []);

    useEffect(() => {
      if (!webcamPipMobileChrome || !pipUiRect) return;
      const el = pipOverlayRef.current;
      const canvas = canvasRef.current;
      if (!el || !canvas) return;
      let pinchActive = false;
      let baseDist = 0;
      let baseW = 0;
      let cx0 = 0;
      let cy0 = 0;

      const onTouchStart = (ev: TouchEvent) => {
        if (ev.touches.length !== 2) return;
        if (tryStartWebcamPinch(ev.touches[0], ev.touches[1], canvas)) {
          const pinch = webcamPinchRef.current!;
          pinchActive = true;
          baseDist = pinch.dist;
          baseW = pinch.w;
          cx0 = pinch.cx;
          cy0 = pinch.cy;
          ev.preventDefault();
          ev.stopPropagation();
        }
      };
      const onTouchMove = (ev: TouchEvent) => {
        if (!pinchActive || ev.touches.length !== 2 || baseDist <= 0) return;
        const t1 = ev.touches[0], t2 = ev.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const factor = dist / baseDist;
        const nw = Math.max(72, Math.round(baseW * factor));
        const nh = Math.round(nw / WEBCAM_PIP_ASPECT);
        webcamPipRectRef.current = clampWebcamPip(
          { x: cx0 - nw / 2, y: cy0 - nh / 2, w: nw, h: nh },
          canvas.width,
          canvas.height,
          webcamPipBottomInsetRef.current,
        );
        renderDirtyRef.current = true;
        queuePipUiSync();
        ev.preventDefault();
        ev.stopPropagation();
      };
      const onTouchEnd = () => {
        pinchActive = false;
        webcamPinchRef.current = null;
      };

      el.addEventListener('touchstart', onTouchStart, { passive: false });
      el.addEventListener('touchmove', onTouchMove, { passive: false });
      el.addEventListener('touchend', onTouchEnd, { passive: false });
      el.addEventListener('touchcancel', onTouchEnd, { passive: false });
      return () => {
        el.removeEventListener('touchstart', onTouchStart);
        el.removeEventListener('touchmove', onTouchMove);
        el.removeEventListener('touchend', onTouchEnd);
        el.removeEventListener('touchcancel', onTouchEnd);
      };
    }, [webcamPipMobileChrome, pipUiRect, tryStartWebcamPinch, queuePipUiSync]);

    useEffect(() => {
      if (webcamActive && webcamPipMobileChrome) queuePipUiSync();
    }, [webcamActive, webcamPipMobileChrome, queuePipUiSync]);

    const zoomBtnSize = precisionTouchDraw ? 32 : 36;

    const zoomControlBtnStyle: React.CSSProperties = {
      width: zoomBtnSize,
      height: zoomBtnSize,
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
      <div style={{
        position: 'absolute',
        inset: 0,
        zIndex: 2,
        background: 'transparent',
        pointerEvents: 'auto',
        ...(nativeVideoUnderlay ? { WebkitBackfaceVisibility: 'hidden' as const } : {}),
      }}>
        {coachToolHint ? (
          <div
            style={{
              position: 'absolute',
              top: 8,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 45,
              maxWidth: 'calc(100% - 24px)',
              padding: '6px 12px',
              borderRadius: 10,
              background: 'rgba(0,0,0,0.72)',
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              lineHeight: 1.35,
              textAlign: 'center',
              pointerEvents: 'none',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
          >
            {coachToolHint}
          </div>
        ) : null}
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
                : panModeEnabled
                  ? (isPanningRef.current ? 'grabbing' : 'grab')
                  : (cursorFor[activeTool] ?? 'default'),
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onPointerCancel={onPointerCancel}
          onDoubleClick={onDoubleClick}
          onWheel={onWheelCanvas}
        />

        {webcamPipMobileChrome &&
        webcamActive &&
        activeTool === 'select' &&
        pipUiRect &&
        webcamPipMode !== 'hidden' ? (
          <div
            ref={pipOverlayRef}
            style={{
              position: 'absolute',
              left: `${(pipUiRect.x / Math.max(1, containerWidth)) * 100}%`,
              top: `${(pipUiRect.y / Math.max(1, containerHeight)) * 100}%`,
              width: `${(pipUiRect.w / Math.max(1, containerWidth)) * 100}%`,
              height: `${(pipUiRect.h / Math.max(1, containerHeight)) * 100}%`,
              zIndex: 120,
              touchAction: 'none',
              pointerEvents: 'auto',
              overflow: 'hidden',
              borderRadius: webcamPipMode === 'circle' ? '50%' : 8,
              // With cutout on, the canvas PiP paints the masked person; the raw
              // <video> here would cover it, so we drop the video and box and keep
              // only a transparent drag handle. Without cutout this is the PiP.
              boxShadow: webcamCutout ? 'none' : '0 4px 16px rgba(0,0,0,0.35)',
              background: 'transparent',
            }}
            onPointerDown={onPipOverlayPointerDown}
            onPointerMove={onPipOverlayPointerMove}
            onPointerUp={onPipOverlayPointerUp}
            onPointerCancel={onPipOverlayPointerUp}
          >
            {!webcamCutout ? (
              <video
                ref={pipMirrorVideoRef}
                autoPlay
                muted
                playsInline
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  pointerEvents: 'none',
                }}
              />
            ) : null}
          </div>
        ) : null}

        {activeTool === 'objectMultiplier' ? (
          <>
            {racketHudOpen ? (
              <div
                style={{
                  position: 'absolute',
                  top: 10,
                  left: 0,
                  right: 0,
                  zIndex: 35,
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: 8,
                  pointerEvents: 'auto',
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#fff',
                    background: 'rgba(0,0,0,0.55)',
                    padding: '6px 10px',
                    borderRadius: 8,
                  }}
                >
                  Racket detected — use it or draw a box
                </span>
                <button
                  type="button"
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: 'none',
                    background: '#22C55E',
                    color: '#fff',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    const r = racketSuggestNormRef.current;
                    if (!r) return;
                    if (racketSuggestTimerRef.current) {
                      clearTimeout(racketSuggestTimerRef.current);
                      racketSuggestTimerRef.current = null;
                    }
                    objMultRegionRef.current = { ...r };
                    racketSuggestNormRef.current = null;
                    setRacketHudOpen(false);
                    onObjMultRegionSelectedRef.current?.();
                    renderDirtyRef.current = true;
                  }}
                >
                  Use detection
                </button>
                <button
                  type="button"
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.5)',
                    background: 'rgba(0,0,0,0.45)',
                    color: '#fff',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    if (racketSuggestTimerRef.current) {
                      clearTimeout(racketSuggestTimerRef.current);
                      racketSuggestTimerRef.current = null;
                    }
                    racketSuggestNormRef.current = null;
                    setRacketHudOpen(false);
                    renderDirtyRef.current = true;
                  }}
                >
                  Draw manually
                </button>
              </div>
            ) : null}
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
              if (racketSuggestTimerRef.current) {
                clearTimeout(racketSuggestTimerRef.current);
                racketSuggestTimerRef.current = null;
              }
              racketSuggestNormRef.current = null;
              setRacketHudOpen(false);
              renderDirtyRef.current = true;
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
          </>
        ) : null}

        {/* Zoom / pan / help utility cluster — above playback, clear of floating FABs */}
        <div
          data-tour-id="tour-zoom"
          style={{
            position: 'absolute',
            bottom: 'calc(var(--coachlab-banner-bottom, 80px) + 12px + env(safe-area-inset-bottom, 0px))',
            right: 'calc(12px + env(safe-area-inset-right, 0px))',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            zIndex: 90,
            pointerEvents: 'auto',
          }}
        >
          {showTourHelpInZoomCluster ? (
            <button
              type="button"
              data-tour-id="tour-help"
              aria-label="Open guided tour"
              title="Guided tour"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                  navigator?.vibrate?.(10);
                } catch {
                  /* noop */
                }
                window.dispatchEvent(new CustomEvent('coachlab-open-guided-tour'));
              }}
              style={{
                ...zoomControlBtnStyle,
                fontSize: 17,
                fontWeight: 800,
                background: 'rgba(26,26,26,0.88)',
                border: '1px solid rgba(255,255,255,0.2)',
              }}
            >
              <HelpCircle size={18} strokeWidth={2.25} aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              const canvas = canvasRef.current;
              if (!canvas) return;
              applyZoomAtRef.current(zoomRef.current + ZOOM_BUTTON_STEP, canvas.width / 2, canvas.height / 2);
            }}
            style={zoomControlBtnStyle}
            title="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              const canvas = canvasRef.current;
              if (!canvas) return;
              applyZoomAtRef.current(zoomRef.current - ZOOM_BUTTON_STEP, canvas.width / 2, canvas.height / 2);
            }}
            style={zoomControlBtnStyle}
            title="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              zoomRef.current = ZOOM_MIN;
              panXRef.current = 0;
              panYRef.current = 0;
              renderDirtyRef.current = true;
            }}
            style={{
              ...zoomControlBtnStyle,
              fontSize: 14,
            }}
            title="Reset zoom & pan"
          >
            ⌂
          </button>
        </div>
        {newTextDraft && (
          <textarea
            ref={newTextInputRef}
            autoFocus
            placeholder="Type label…"
            style={{
              position: 'absolute',
              left: newTextDraft.left,
              top: newTextDraft.top,
              minWidth: 120,
              minHeight: newTextDraft.fontSize * 1.4,
              fontSize: newTextDraft.fontSize,
              fontWeight: 'bold',
              fontFamily: 'Inter, sans-serif',
              color: newTextDraft.color,
              background: 'rgba(0,0,0,0.65)',
              border: '2px solid #FFD700',
              borderRadius: 4,
              padding: '2px 6px',
              outline: 'none',
              resize: 'none',
              zIndex: 9999,
              lineHeight: 1.25,
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setNewTextDraft(null);
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commitNewTextDraft();
              }
            }}
            onBlur={commitNewTextDraft}
          />
        )}

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
