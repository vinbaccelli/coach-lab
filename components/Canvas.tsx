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
import type { BallTrailMode } from '@/components/ToolPalette';
import type { SwingSegment } from '@/lib/swingDetection';

// ── Types ──────────────────────────────────────────────────────────────────

type Pt = { x: number; y: number };

interface StrokePen     { tool: 'pen';                              pts: Pt[]; color: string; lw: number; dashed?: boolean }
interface StrokeArrow   { tool: 'arrow' | 'arrowAngle';             p1: Pt; p2: Pt; color: string; lw: number; dashed?: boolean }
interface StrokeEllipse {
  tool: 'circle' | 'bodyCircle';
  cx: number; cy: number; rx: number; ry: number;
  color: string; lw: number; dashed?: boolean;
  spinning?: boolean;
  gapStart?: number;  // angle in radians
  gapEnd?: number;    // angle in radians
}
interface StrokeSwing   { tool: 'swingPath';                        pts: Pt[]; color: string; lw: number; dashed?: boolean }
interface StrokeText    { tool: 'text';                             pos: Pt; text: string; color: string; fontSize: number }

type Stroke = StrokePen | StrokeArrow | StrokeEllipse | StrokeSwing | StrokeText;

interface AngleMeas { v: Pt; p1: Pt; p2: Pt; deg: number }
interface LiveAngle { phase: 1 | 2; v: Pt; p1: Pt; cursor: Pt }

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
  animFrame: number,
): void {
  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.lw;
  if (s.dashed) ctx.setLineDash([8, 6]);

  const isCircle = s.rx === s.ry;

  if (isCircle && (s.gapStart !== undefined || s.spinning)) {
    let startAngle = s.gapEnd ?? 0;
    let endAngle = s.gapStart ?? Math.PI * 2;

    if (s.spinning) {
      const offset = (animFrame * 0.03) % (Math.PI * 2);
      startAngle += offset;
      endAngle += offset;
    }

    ctx.beginPath();
    ctx.arc(s.cx, s.cy, Math.max(1, s.rx), startAngle, endAngle);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.ellipse(s.cx, s.cy, Math.max(1, s.rx), Math.max(1, s.ry), 0, 0, Math.PI * 2);
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

  } else if (s.tool === 'swingPath') {
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
  const visible = mode === 'short-tail'
    ? track.filter(p => Math.abs(p.frameIndex - currentFrameIdx) <= SHORT_TAIL)
    : track;
  if (visible.length === 0) return;

  ctx.save();
  ctx.lineCap = 'round';

  if (visible.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(dx + visible[0].nx * dw, dy + visible[0].ny * dh);
    for (let i = 1; i < visible.length; i++) {
      ctx.lineTo(dx + visible[i].nx * dw, dy + visible[i].ny * dh);
    }
    ctx.strokeStyle = 'rgba(204,255,0,0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  for (const p of visible) {
    const dist = Math.abs(p.frameIndex - currentFrameIdx);
    const alpha = mode === 'short-tail' ? Math.max(0.2, 1 - dist / SHORT_TAIL) : 0.7;
    const r = mode === 'short-tail' ? Math.max(3, 8 * (1 - dist / SHORT_TAIL)) : 5;
    ctx.shadowColor = '#CCFF00';
    ctx.shadowBlur = 8 * alpha;
    ctx.fillStyle = `rgba(204,255,0,${alpha})`;
    ctx.beginPath();
    ctx.arc(dx + p.nx * dw, dy + p.ny * dh, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const cur = track.find(p => Math.abs(p.frameIndex - currentFrameIdx) <= 1);
  if (cur) {
    ctx.shadowColor = '#CCFF00';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#CCFF00';
    ctx.beginPath();
    ctx.arc(dx + cur.nx * dw, dy + cur.ny * dh, 10, 0, Math.PI * 2);
    ctx.fill();
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
  const TAIL_SECONDS = 0.6;
  const visible = mode === 'short-tail'
    ? track.filter(p => currentTime - p.timeSeconds <= TAIL_SECONDS && p.timeSeconds <= currentTime + 0.1)
    : track;
  if (visible.length === 0) return;

  const toCanvasX = (x: number) => dx + (x / vW) * dw;
  const toCanvasY = (y: number) => dy + (y / vH) * dh;

  ctx.save();
  ctx.lineCap = 'round';

  if (visible.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(toCanvasX(visible[0].x), toCanvasY(visible[0].y));
    for (let i = 1; i < visible.length; i++) {
      ctx.lineTo(toCanvasX(visible[i].x), toCanvasY(visible[i].y));
    }
    ctx.strokeStyle = 'rgba(204,255,0,0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  for (const p of visible) {
    const age = currentTime - p.timeSeconds;
    const alpha = mode === 'short-tail' ? Math.max(0.2, 1 - age / TAIL_SECONDS) : 0.7;
    const r = mode === 'short-tail' ? Math.max(3, 8 * (1 - age / TAIL_SECONDS)) : 5;
    ctx.shadowColor = '#CCFF00';
    ctx.shadowBlur = 8 * alpha;
    ctx.fillStyle = `rgba(204,255,0,${alpha})`;
    ctx.beginPath();
    ctx.arc(toCanvasX(p.x), toCanvasY(p.y), r, 0, Math.PI * 2);
    ctx.fill();
  }

  const cur = visible[visible.length - 1];
  if (cur && currentTime - cur.timeSeconds < 0.1) {
    ctx.shadowColor = '#CCFF00';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#CCFF00';
    ctx.beginPath();
    ctx.arc(toCanvasX(cur.x), toCanvasY(cur.y), 10, 0, Math.PI * 2);
    ctx.fill();
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
      ballTrailMode = 'short-tail',
      skeletonEnabled = false,
      ballTrailEnabled = false,
      onProcessingStatus,
      isRecording = false,
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

    // Real-time skeleton detection
    const isPoseRunningRef    = useRef(false);
    const skeletonFramesRef   = useRef<Array<{ timeSeconds: number; keypoints: Array<{ x: number; y: number; score: number; name: string }> }>>([]);
    const lastPoseTimeRef     = useRef(0);

    // Real-time ball detection
    const isBallRunningRef    = useRef(false);
    const ballTrackRef        = useRef<Array<{ timeSeconds: number; x: number; y: number }>>([]);
    const ballDetectCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const ballDetectCtxRef    = useRef<CanvasRenderingContext2D | null>(null);
    const lastBallDetectRef   = useRef(0);

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

    useEffect(() => { drawingOptsRef.current      = drawingOptions; },  [drawingOptions]);
    useEffect(() => { activeToolRef.current        = activeTool; },      [activeTool]);
    useEffect(() => { skeletonEnabledRef.current   = skeletonEnabled; }, [skeletonEnabled]);
    useEffect(() => { ballTrailEnabledRef.current  = ballTrailEnabled; }, [ballTrailEnabled]);
    useEffect(() => { ballTrailModeRef.current     = ballTrailMode; },   [ballTrailMode]);
    useEffect(() => { isRecordingRef.current       = isRecording; },     [isRecording]);

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
        liveAngleRef.current = null;
        anglePhaseRef.current = 0;
        angleVRef.current = null;
        angleP1Ref.current = null;
        pushHistory();
      },
      resetSkeleton: () => {
        cachedPosesRef.current = [];
        poseProcessingRef.current = false;
        skeletonFramesRef.current = [];
        isPoseRunningRef.current = false;
        onProcessingStatus?.(null);
      },
      resetBallTrail: () => {
        cachedBallRef.current = [];
        ballProcessingRef.current = false;
        ballTrackRef.current = [];
        isBallRunningRef.current = false;
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
        if (frames.length === 0) return [];
        // Synchronously detect swings from accumulated skeleton frames
        const { detectSwingSegments } = require('@/lib/swingDetection') as typeof import('@/lib/swingDetection');
        return detectSwingSegments(frames);
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

        const points = segment.wristPositions.map((p) => ({
          x: p.x * (dw2 / vW2),
          y: p.y * (dh2 / vH2),
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
    }), [onProcessingStatus, pushHistory, videoRef]);

    // ── Skeleton detector loader ───────────────────────────────────────────

    useEffect(() => {
      if (!skeletonEnabled) return;
      ensurePoseRender();

      import('@/lib/poseDetection').then(({ getPoseDetector }) => {
        getPoseDetector().then((det) => {
          if (det) {
            onProcessingStatus?.('Skeleton ready — play video');
          } else {
            onProcessingStatus?.('Skeleton model failed to load');
          }
        });
      }).catch((err) => {
        console.error('[Canvas] Skeleton load error:', err);
        onProcessingStatus?.('Skeleton model failed to load');
      });
    }, [skeletonEnabled, onProcessingStatus]);

    // ── Ball detection canvas initialization ──────────────────────────────

    useEffect(() => {
      if (!ballTrailEnabled) return;
      if (!ballDetectCanvasRef.current) {
        const c = document.createElement('canvas');
        c.width = 320;
        c.height = 180;
        ballDetectCanvasRef.current = c;
        ballDetectCtxRef.current = c.getContext('2d', { willReadFrequently: true });
      }
      onProcessingStatus?.('Ball detection ready — play video');
    }, [ballTrailEnabled, onProcessingStatus]);

    // ── Canvas size ────────────────────────────────────────────────────────

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas || !containerWidth || !containerHeight) return;
      canvas.width = containerWidth;
      canvas.height = containerHeight;
    }, [containerWidth, containerHeight]);

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
          ctx.drawImage(video, dx, dy, dw, dh);

          // ── Real-time skeleton detection ────────────────────────────────
          if (skeletonEnabledRef.current && !video.paused && !isPoseRunningRef.current) {
            const now = video.currentTime;
            if (now - lastPoseTimeRef.current > 0.033) { // ~30fps throttle
              lastPoseTimeRef.current = now;
              isPoseRunningRef.current = true;

              import('@/lib/poseDetection').then(({ detectPoseOnCurrentFrame }) => {
                detectPoseOnCurrentFrame(video).then((keypoints) => {
                  if (keypoints) {
                    skeletonFramesRef.current.push({
                      timeSeconds: now,
                      keypoints,
                    });
                    // Keep only last 300 frames (~10s at 30fps)
                    if (skeletonFramesRef.current.length > 300) {
                      skeletonFramesRef.current = skeletonFramesRef.current.slice(-300);
                    }
                    onProcessingStatus?.(null);
                  }
                }).finally(() => {
                  isPoseRunningRef.current = false;
                });
              }).catch(() => { isPoseRunningRef.current = false; });
            }
          }

          // ── Real-time ball detection ────────────────────────────────────
          if (ballTrailEnabledRef.current && !video.paused && !isBallRunningRef.current) {
            const now = video.currentTime;
            if (now - lastBallDetectRef.current > 0.05) { // ~20fps
              lastBallDetectRef.current = now;
              const dc = ballDetectCanvasRef.current;
              const dCtx = ballDetectCtxRef.current;
              if (dc && dCtx && video.readyState >= 4) {
                isBallRunningRef.current = true;
                dCtx.drawImage(video, 0, 0, dc.width, dc.height);
                const imageData = dCtx.getImageData(0, 0, dc.width, dc.height);
                import('@/lib/ballDetection').then(({ detectBallInImageData }) => {
                  const pos = detectBallInImageData(imageData, dc.width, dc.height);
                  if (pos) {
                    // Scale back to video native resolution
                    ballTrackRef.current.push({
                      timeSeconds: now,
                      x: pos.x * (vW / dc.width),
                      y: pos.y * (vH / dc.height),
                    });
                    // Keep last 200 detections
                    if (ballTrackRef.current.length > 200) {
                      ballTrackRef.current = ballTrackRef.current.slice(-200);
                    }
                    onProcessingStatus?.(null);
                  }
                  isBallRunningRef.current = false;
                }).catch(() => { isBallRunningRef.current = false; });
              }
            }
          }
        } else {
          ctx.fillStyle = '#111';
          ctx.fillRect(0, 0, W, H);
        }

        // ── Skeleton overlay ─────────────────────────────────────────────
        if (skeletonEnabledRef.current && video) {
          const currentTime = video.currentTime;
          const TOLERANCE = 0.15; // 150ms

          // Find most recent frame within tolerance
          let bestFrame: typeof skeletonFramesRef.current[0] | null = null;
          for (let i = skeletonFramesRef.current.length - 1; i >= 0; i--) {
            const f = skeletonFramesRef.current[i];
            if (Math.abs(f.timeSeconds - currentTime) <= TOLERANCE) {
              bestFrame = f;
              break;
            }
          }

          if (bestFrame && poseRenderFns) {
            const scaleX = dw / vW;
            const scaleY = dh / vH;
            ctx.save();
            ctx.translate(dx, dy);
            poseRenderFns.drawSkeletonFrame(ctx, bestFrame.keypoints, scaleX, scaleY);
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

        // Webcam PiP — bottom-right corner when recording
        const webcam = webcamVideoRef?.current;
        if (isRecordingRef.current && webcam && webcam.readyState >= 2) {
          const camW = Math.round(W * 0.22);
          const camH = Math.round(camW * (9 / 16));
          const margin = 16;
          const cx2 = W - camW - margin;
          const cy2 = H - camH - margin;
          ctx.save();
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(cx2, cy2, camW, camH, 10);
          else ctx.rect(cx2, cy2, camW, camH);
          ctx.clip();
          ctx.drawImage(webcam, cx2, cy2, camW, camH);
          ctx.restore();
          ctx.save();
          ctx.strokeStyle = '#FF3B30';
          ctx.lineWidth = 3;
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(cx2, cy2, camW, camH, 10);
          else ctx.rect(cx2, cy2, camW, camH);
          ctx.stroke();
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
      return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top)  * (canvas.height / rect.height),
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

    // ── Erase near a point ─────────────────────────────────────────────────

    const eraseAt = useCallback((pos: Pt) => {
      const T = 22;
      strokesRef.current = strokesRef.current.filter((s) => {
        if (s.tool === 'pen' || s.tool === 'swingPath')
          return !s.pts.some(p => Math.hypot(p.x - pos.x, p.y - pos.y) < T);
        if (s.tool === 'arrow' || s.tool === 'arrowAngle')
          return Math.hypot(s.p1.x - pos.x, s.p1.y - pos.y) > T
              && Math.hypot(s.p2.x - pos.x, s.p2.y - pos.y) > T;
        if (s.tool === 'circle' || s.tool === 'bodyCircle')
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

      // Check if clicking near a circle center to start dragging it
      if (tool === 'circle' || tool === 'bodyCircle') {
        const DRAG_THRESHOLD = 20;
        const idx = strokesRef.current.findIndex((s) => {
          if (s.tool !== 'circle' && s.tool !== 'bodyCircle') return false;
          const el = s as StrokeEllipse;
          return Math.hypot(el.cx - pos.x, el.cy - pos.y) < Math.max(el.rx, el.ry) + DRAG_THRESHOLD;
        });
        if (idx >= 0) {
          const el = strokesRef.current[idx] as StrokeEllipse;
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
            if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) {
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
    }, [pushHistory, finishSwingPath, eraseAt, videoRef]);

    // ── Pointer move ───────────────────────────────────────────────────────

    const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
      const pos  = getPos(e);
      const tool = activeToolRef.current;

      // Circle dragging
      if (dragCircleIdxRef.current >= 0 && isDraggingRef.current) {
        const idx = dragCircleIdxRef.current;
        const s = strokesRef.current[idx] as StrokeEllipse;
        if (s) {
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
      } else if (active.tool === 'arrow' || active.tool === 'arrowAngle') {
        (active as StrokeArrow).p2 = pos;
      } else if (active.tool === 'circle' || active.tool === 'bodyCircle') {
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
      strokesRef.current = [...strokesRef.current, active];
      pushHistory();
    }, [pushHistory]);

    // Double-click to finish swing path on desktop
    const onDoubleClick = useCallback((_e: React.MouseEvent) => {
      if (activeToolRef.current === 'swingPath' && swingDrawingRef.current) {
        finishSwingPath();
      }
    }, [finishSwingPath]);

    const cursorFor: Partial<Record<ToolType, string>> = {
      pen: 'crosshair', erase: 'cell', text: 'text',
      angle: 'crosshair', swingPath: 'crosshair', ballShadow: 'crosshair',
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
