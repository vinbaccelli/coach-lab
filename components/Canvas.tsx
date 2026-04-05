'use client';

import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { ToolType, DrawingOptions } from '@/lib/drawingTools';
import { calcAngleDeg, makeArrowHead, serializeCanvas, deserializeCanvas } from '@/lib/drawingTools';
import {
  createSkeletonState, enableSkeleton, disableSkeleton, addJoint, resetSkeleton, drawSkeleton,
} from '@/lib/skeleton';
import {
  createBallTrailState, enableBallTrail, disableBallTrail, addBallPoint, resetBallTrail, drawBallTrail,
} from '@/lib/ballTrail';
import type { CachedPoseFrame } from '@/lib/poseDetection';
import type { BallPosition } from '@/lib/ballDetection';

// Dynamic import for fabric (SSR-safe)
let fabricModule: typeof import('fabric') | null = null;
const loadFabric = async () => {
  if (!fabricModule) {
    fabricModule = await import('fabric');
  }
  return fabricModule;
};

// Cache pose detection render helpers at module level to avoid repeated dynamic imports
// in the animation frame loop. These are populated once when poseDetection is first loaded.
let cachedGetPoseAtTime: (typeof import('@/lib/poseDetection'))['getPoseAtTime'] | null = null;
let cachedDrawPoseSkeleton: (typeof import('@/lib/poseDetection'))['drawPoseSkeleton'] | null = null;
const loadPoseRenderHelpers = () => {
  if (cachedGetPoseAtTime && cachedDrawPoseSkeleton) return;
  import('@/lib/poseDetection').then(({ getPoseAtTime, drawPoseSkeleton }) => {
    cachedGetPoseAtTime = getPoseAtTime;
    cachedDrawPoseSkeleton = drawPoseSkeleton;
  }).catch((err) => console.error('[Canvas] Failed to load pose render helpers:', err));
};

export interface CanvasHandle {
  /** Flat combined canvas element (video frame + drawings) */
  getCompositeCanvas: () => HTMLCanvasElement | null;
  /** The Fabric canvas element (drawings only) */
  getFabricCanvas: () => HTMLCanvasElement | null;
  /** Clear all drawings */
  clearAll: () => void;
  /** Undo last drawing */
  undo: () => void;
  /** Redo */
  redo: () => void;
  /** Reset the skeleton joints */
  resetSkeleton: () => void;
  /** Reset the ball trail points */
  resetBallTrail: () => void;
}

import type { BallTrailMode } from '@/components/ToolPalette';

interface CanvasProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  activeTool: ToolType;
  drawingOptions: DrawingOptions;
  containerWidth: number;
  containerHeight: number;
  ballTrailMode?: BallTrailMode;
}

const MAX_HISTORY = 50;

const CanvasOverlay = React.forwardRef<CanvasHandle, CanvasProps>(
  function CanvasOverlay(
    { videoRef, activeTool, drawingOptions, containerWidth, containerHeight, ballTrailMode = 'short-tail' },
    ref,
  ) {
    const canvasElRef = useRef<HTMLCanvasElement>(null);
    const fabricRef = useRef<import('fabric').Canvas | null>(null);
    const historyRef = useRef<string[]>([]);
    const historyIndexRef = useRef<number>(-1);
    const isModifyingRef = useRef(false);
    const [fabricReady, setFabricReady] = useState(false);

    // Angle tool state (3 clicks: start, vertex, end)
    const angleStateRef = useRef<{
      phase: 0 | 1 | 2;
      points: { x: number; y: number }[];
      tempLines: import('fabric').Object[];
    }>({ phase: 0, points: [], tempLines: [] });

    // Arrow + angle state (2 clicks)
    const arrowAngleStateRef = useRef<{
      phase: 0 | 1;
      start: { x: number; y: number } | null;
    }>({ phase: 0, start: null });

    // Arrow state
    const arrowStateRef = useRef<{
      drawing: boolean;
      start: { x: number; y: number } | null;
      tempLine: import('fabric').Object | null;
    }>({ drawing: false, start: null, tempLine: null });

    // Circle / ellipse state
    const circleStateRef = useRef<{
      drawing: boolean;
      start: { x: number; y: number } | null;
      tempShape: import('fabric').Object | null;
    }>({ drawing: false, start: null, tempShape: null });

    // Body circle state
    const bodyCircleStateRef = useRef<{
      drawing: boolean;
      start: { x: number; y: number } | null;
      tempShape: import('fabric').Object | null;
    }>({ drawing: false, start: null, tempShape: null });

    // Ball shadow state (kept for tool-reset compatibility)
    const ballShadowStateRef = useRef<{
      drawing: boolean;
      start: { x: number; y: number } | null;
      tempShape: import('fabric').Object | null;
    }>({ drawing: false, start: null, tempShape: null });

    // Overlay canvas for skeleton + ball trail (rendered independently of Fabric)
    const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
    const skeletonStateRef = useRef(createSkeletonState());
    const ballTrailStateRef = useRef(createBallTrailState());
    const mousePreviewRef = useRef<{ x: number; y: number } | null>(null);

    // Swing path state (click-by-click motion trail)
    const swingPathStateRef = useRef<{
      points: { x: number; y: number }[];
      dots: import('fabric').Object[];
      lines: import('fabric').Object[];
      isDrawing: boolean;
    }>({ points: [], dots: [], lines: [], isDrawing: false });

    // Long-press timer ref for touch-based swing path termination
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressFiredRef = useRef(false);

    // Angle tool live preview state (drawn on overlay canvas)
    const angleLivePreviewRef = useRef<{
      phase2Active: boolean;
      p0: { x: number; y: number } | null;
      p1: { x: number; y: number } | null;
      cursor: { x: number; y: number } | null;
    }>({ phase2Active: false, p0: null, p1: null, cursor: null });

    // AI pose detection cache
    const cachedPosesRef = useRef<CachedPoseFrame[]>([]);
    const poseProcessingRef = useRef(false);
    const [poseProgress, setPoseProgress] = useState<number | null>(null);

    // Auto ball detection cache
    const cachedBallRef = useRef<BallPosition[]>([]);
    const ballProcessingRef = useRef(false);
    const [ballProgress, setBallProgress] = useState<number | null>(null);

    // Push current state onto undo stack
    const pushHistory = useCallback(() => {
      const fc = fabricRef.current;
      if (!fc) return;
      const snapshot = serializeCanvas(fc);
      const idx = historyIndexRef.current;
      // Truncate any redo history
      historyRef.current = historyRef.current.slice(0, idx + 1);
      historyRef.current.push(snapshot);
      if (historyRef.current.length > MAX_HISTORY) {
        historyRef.current.shift();
      }
      historyIndexRef.current = historyRef.current.length - 1;
    }, []);

    // Initialize Fabric canvas
    useEffect(() => {
      if (!canvasElRef.current || typeof window === 'undefined') return;
      let fc: import('fabric').Canvas;

      loadFabric().then(({ Canvas, PencilBrush }) => {
        if (!canvasElRef.current) return;
        fc = new Canvas(canvasElRef.current, {
          isDrawingMode: false,
          selection: false,
          width: containerWidth || 800,
          height: containerHeight || 450,
          backgroundColor: 'transparent',
          enableRetinaScaling: false,
        });

        // Fabric v7 does not auto-initialize freeDrawingBrush — create it explicitly
        fc.freeDrawingBrush = new PencilBrush(fc);

        fabricRef.current = fc;

        // Signal that fabric is ready so tool configuration runs
        setFabricReady(true);

        // Initial history snapshot
        pushHistory();

        // Track changes for undo
        fc.on('object:added', () => {
          if (!isModifyingRef.current) pushHistory();
        });
        fc.on('object:modified', () => {
          if (!isModifyingRef.current) pushHistory();
        });
      }).catch((err) => {
        console.error('[Canvas] Failed to initialize Fabric.js:', err);
      });

      return () => {
        fc?.dispose();
        fabricRef.current = null;
      };
    }, [pushHistory]);

    // Resize canvas when container changes
    useEffect(() => {
      const fc = fabricRef.current;
      if (!fc || !containerWidth || !containerHeight) return;
      fc.setDimensions({ width: containerWidth, height: containerHeight });
      fc.renderAll();
      const overlay = overlayCanvasRef.current;
      if (overlay) {
        overlay.width = containerWidth;
        overlay.height = containerHeight;
      }
    }, [containerWidth, containerHeight]);

    // Configure fabric for active tool
    useEffect(() => {
      const fc = fabricRef.current;
      if (!fc) return;

      // Reset all states
      angleStateRef.current = { phase: 0, points: [], tempLines: [] };
      arrowAngleStateRef.current = { phase: 0, start: null };
      arrowStateRef.current = { drawing: false, start: null, tempLine: null };
      circleStateRef.current = { drawing: false, start: null, tempShape: null };
      bodyCircleStateRef.current = { drawing: false, start: null, tempShape: null };
      ballShadowStateRef.current = { drawing: false, start: null, tempShape: null };
      swingPathStateRef.current = { points: [], dots: [], lines: [], isDrawing: false };
      angleLivePreviewRef.current = { phase2Active: false, p0: null, p1: null, cursor: null };

      // Enable skeleton / ball-trail overlays when their tools are activated;
      // disable them when any other tool is active so the overlays are hidden.
      if (activeTool === 'skeleton') {
        enableSkeleton(skeletonStateRef.current);
        // Pre-load pose render helpers so they're ready before the first animation frame
        loadPoseRenderHelpers();
      } else {
        disableSkeleton(skeletonStateRef.current);
      }
      if (activeTool === 'ballShadow') {
        enableBallTrail(ballTrailStateRef.current);
      } else {
        disableBallTrail(ballTrailStateRef.current);
      }
      // Clear preview when leaving skeleton tool
      if (activeTool !== 'skeleton') mousePreviewRef.current = null;

      if (activeTool === 'select') {
        fc.isDrawingMode = false;
        fc.selection = true;
        fc.forEachObject((obj) => obj.set({ selectable: true, evented: true }));
        fc.renderAll();
        return;
      }

      if (activeTool === 'pen') {
        fc.isDrawingMode = true;
        fc.selection = false;
        // Brush properties (color/width) are kept in sync by the dedicated
        // drawingOptions useEffect below — no need to set them again here.
        return;
      }

      if (activeTool === 'erase') {
        fc.isDrawingMode = false;
        fc.selection = false;
        // Make all objects hoverable so the eraser can target them
        fc.forEachObject((obj) => obj.set({ selectable: false, evented: true }));
        fc.renderAll();
        return;
      }

      // All other tools: manual click-based
      fc.isDrawingMode = false;
      fc.selection = false;
      fc.forEachObject((obj) => obj.set({ selectable: false, evented: false }));
      fc.renderAll();
    }, [activeTool, fabricReady]);

    // Update pen brush when options change (also re-runs when fabricReady becomes true)
    useEffect(() => {
      const fc = fabricRef.current;
      if (!fc?.freeDrawingBrush) return;
      fc.freeDrawingBrush.color = drawingOptions.color;
      fc.freeDrawingBrush.width = drawingOptions.lineWidth;
    }, [drawingOptions, fabricReady]);

    // Render loop: draws skeleton and ball trail on the overlay canvas every frame.
    // Uses refs for mutable state so it does not need to restart on every tool change.
    useEffect(() => {
      const overlayCanvas = overlayCanvasRef.current;
      if (!overlayCanvas) return;

      let animFrameId: number;

      const render = () => {
        const ctx = overlayCanvas.getContext('2d');
        if (!ctx) { animFrameId = requestAnimationFrame(render); return; }

        const w = overlayCanvas.width;
        const h = overlayCanvas.height;
        ctx.clearRect(0, 0, w, h);

        const video = videoRef.current;
        const currentTime = video?.currentTime ?? 0;
        const isPaused = video ? video.paused : true;

        // Show ghost preview only while in skeleton tool with video paused
        const previewPos = (activeTool === 'skeleton' && isPaused)
          ? mousePreviewRef.current
          : null;

        drawSkeleton(ctx, skeletonStateRef.current, w, h, previewPos);
        drawBallTrail(ctx, ballTrailStateRef.current, currentTime, w, h);

        // Draw AI-detected skeleton overlay (when skeleton tool is active and we have cached poses)
        if (activeTool === 'skeleton' && cachedPosesRef.current.length > 0) {
          const video2 = videoRef.current;
          const time2 = video2?.currentTime ?? 0;
          if (cachedGetPoseAtTime && cachedDrawPoseSkeleton) {
            const poseFrame = cachedGetPoseAtTime(cachedPosesRef.current, time2);
            if (poseFrame && poseFrame.poses.length > 0) {
              const vw = video2?.videoWidth || w;
              const vh = video2?.videoHeight || h;
              cachedDrawPoseSkeleton(ctx, poseFrame.poses, w, h, w / vw, h / vh, 0.4);
            }
          }
        }

        // Draw auto-detected ball trail (when ball trail tool is active)
        if (activeTool === 'ballShadow' && cachedBallRef.current.length > 0) {
          const video2 = videoRef.current;
          const time2 = video2?.currentTime ?? 0;
          const fps = 30;
          const targetFrame = Math.round(time2 * fps);

          if (ballTrailMode === 'full-trajectory') {
            // Full trajectory: draw entire path as a continuous line up to the current frame
            const allPoints = cachedBallRef.current.filter((p) => p.frameIndex <= targetFrame);
            if (allPoints.length > 0) {
              ctx.save();
              ctx.lineCap = 'round';
              ctx.lineJoin = 'round';
              // Draw the full trajectory line
              ctx.strokeStyle = 'rgba(255, 220, 50, 0.75)';
              ctx.lineWidth = 3;
              ctx.beginPath();
              let started = false;
              for (const pos of allPoints) {
                if (!started) {
                  ctx.moveTo(pos.nx * w, pos.ny * h);
                  started = true;
                } else {
                  ctx.lineTo(pos.nx * w, pos.ny * h);
                }
              }
              ctx.stroke();
              // Draw dots at each detection point
              for (const pos of allPoints) {
                const age = targetFrame - pos.frameIndex;
                const isCurrent = age <= 2;
                ctx.fillStyle = isCurrent ? 'rgba(255, 220, 50, 0.95)' : 'rgba(255, 180, 30, 0.5)';
                ctx.beginPath();
                ctx.arc(pos.nx * w, pos.ny * h, isCurrent ? 8 : 4, 0, Math.PI * 2);
                ctx.fill();
              }
              ctx.restore();
            }
          } else {
            // Short tail: last 15 frames before current
            const tailFrames = 15;
            const visible = cachedBallRef.current.filter(
              (p) => p.frameIndex >= targetFrame - tailFrames && p.frameIndex <= targetFrame,
            );
            if (visible.length > 0) {
              ctx.save();
              ctx.lineCap = 'round';
              for (let i = 1; i < visible.length; i++) {
                const prev = visible[i - 1];
                const curr = visible[i];
                const alpha = (i / visible.length) * 0.9;
                ctx.strokeStyle = `rgba(255, 220, 50, ${alpha})`;
                ctx.lineWidth = Math.max(2, 5 * alpha);
                ctx.beginPath();
                ctx.moveTo(prev.nx * w, prev.ny * h);
                ctx.lineTo(curr.nx * w, curr.ny * h);
                ctx.stroke();
              }
              const latest = visible[visible.length - 1];
              ctx.shadowColor = 'rgba(255, 200, 0, 0.9)';
              ctx.shadowBlur = 12;
              ctx.fillStyle = 'rgba(255, 220, 50, 0.95)';
              ctx.beginPath();
              ctx.arc(latest.nx * w, latest.ny * h, 8, 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();
            }
          }
        }

        // Draw live angle preview (arc + floating label) while dragging 3rd point
        const aPreview = angleLivePreviewRef.current;
        if (aPreview.phase2Active && aPreview.p0 && aPreview.p1 && aPreview.cursor) {
          const { p0, p1, cursor } = aPreview;
          // Angle at vertex p1 between ray p1→p0 and ray p1→cursor
          const ray1Angle = Math.atan2(p0.y - p1.y, p0.x - p1.x);
          const ray2Angle = Math.atan2(cursor.y - p1.y, cursor.x - p1.x);
          let angleDeg = Math.abs((ray2Angle - ray1Angle) * 180 / Math.PI);
          if (angleDeg > 180) angleDeg = 360 - angleDeg;
          const arcR = Math.min(40, Math.hypot(p0.x - p1.x, p0.y - p1.y) * 0.4);

          ctx.save();
          // Arc fill
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.arc(p1.x, p1.y, arcR, Math.min(ray1Angle, ray2Angle), Math.max(ray1Angle, ray2Angle));
          ctx.closePath();
          ctx.fillStyle = 'rgba(252, 211, 77, 0.25)';
          ctx.fill();
          // Arc stroke
          ctx.beginPath();
          ctx.arc(p1.x, p1.y, arcR, Math.min(ray1Angle, ray2Angle), Math.max(ray1Angle, ray2Angle));
          ctx.strokeStyle = '#FCD34D';
          ctx.lineWidth = 2;
          ctx.stroke();
          // Preview lines
          ctx.strokeStyle = 'rgba(252, 211, 77, 0.6)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(cursor.x, cursor.y);
          ctx.stroke();
          ctx.setLineDash([]);
          // Floating label
          const label = `${Math.round(angleDeg)}°`;
          const lx = cursor.x + 10;
          const ly = cursor.y - 10;
          ctx.font = 'bold 14px Inter, sans-serif';
          const metrics = ctx.measureText(label);
          const pad = 5;
          const lw = metrics.width + pad * 2;
          const lh = 22;
          // Keep label within canvas bounds
          const clampX = Math.min(lx, w - lw - 4);
          const clampY = Math.max(ly - lh + 4, 4);
          ctx.fillStyle = 'rgba(20,20,20,0.8)';
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(clampX, clampY, lw, lh, 4);
          else ctx.rect(clampX, clampY, lw, lh);
          ctx.fill();
          ctx.fillStyle = '#FCD34D';
          ctx.fillText(label, clampX + pad, clampY + lh - 6);
          ctx.restore();
        }

        animFrameId = requestAnimationFrame(render);
      };

      animFrameId = requestAnimationFrame(render);
      return () => cancelAnimationFrame(animFrameId);
    // activeTool is included so the preview condition stays current inside the loop;
    // ballTrailMode is included so the rendering mode is current;
    // videoRef is included so the closure captures the ref object (it's stable but listed for clarity)
    }, [activeTool, ballTrailMode, videoRef]);

    // AI Skeleton: auto-process video when skeleton tool is selected and video is loaded
    useEffect(() => {
      if (activeTool !== 'skeleton') return;
      const video = videoRef.current;
      if (!video || !video.duration || !isFinite(video.duration)) return;
      if (cachedPosesRef.current.length > 0 || poseProcessingRef.current) return;

      poseProcessingRef.current = true;
      setPoseProgress(0);

      import('@/lib/poseDetection').then(async ({ processAllFrames }) => {
        try {
          const frames = await processAllFrames(
            video,
            30,
            (p) => setPoseProgress(Math.round(p * 100)),
          );
          cachedPosesRef.current = frames;
        } catch (err) {
          console.error('[Canvas] Pose detection failed:', err);
        } finally {
          poseProcessingRef.current = false;
          setPoseProgress(null);
        }
      }).catch(() => {
        poseProcessingRef.current = false;
        setPoseProgress(null);
      });
    }, [activeTool, videoRef]);

    // Ball Detection: auto-process video when ball trail tool is selected and video is loaded
    useEffect(() => {
      if (activeTool !== 'ballShadow') return;
      const video = videoRef.current;
      if (!video || !video.duration || !isFinite(video.duration)) return;
      if (cachedBallRef.current.length > 0 || ballProcessingRef.current) return;

      ballProcessingRef.current = true;
      setBallProgress(0);

      import('@/lib/ballDetection').then(async ({ detectBallAllFrames }) => {
        try {
          const positions = await detectBallAllFrames(
            video,
            (p) => setBallProgress(Math.round(p * 100)),
          );
          cachedBallRef.current = positions;
        } catch (err) {
          console.error('[Canvas] Ball detection failed:', err);
        } finally {
          ballProcessingRef.current = false;
          setBallProgress(null);
        }
      }).catch(() => {
        ballProcessingRef.current = false;
        setBallProgress(null);
      });
    }, [activeTool, videoRef]);

    // Mouse event handlers
    useEffect(() => {
      const fc = fabricRef.current;
      if (!fc) return;
      if (['select', 'pen'].includes(activeTool)) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const getPos = (e: any): { x: number; y: number } => {
        // Fabric v7 provides scenePoint; older versions used pointer
        if (e.scenePoint) return { x: e.scenePoint.x, y: e.scenePoint.y };
        if (e.pointer) return { x: e.pointer.x, y: e.pointer.y };
        return { x: 0, y: 0 };
      };

      // Helper: create a ball-shadow ellipse from drag start to current pointer
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const makeBallShadow = (Ellipse: any, start: { x: number; y: number }, end: { x: number; y: number }, lineWidth: number) => {
        const rawRx = Math.abs(end.x - start.x) / 2;
        const rawRy = Math.abs(end.y - start.y) / 4;
        // Ensure minimum visible size even on a plain click
        const rx = Math.max(rawRx, 30);
        const ry = Math.max(rawRy, 10);
        const cx = (start.x + end.x) / 2;
        const cy = (start.y + end.y) / 2;
        return new Ellipse({
          left: cx - rx,
          top: cy - ry,
          rx,
          ry,
          fill: 'rgba(0,0,0,0.25)',
          stroke: 'rgba(0,0,0,0.4)',
          strokeWidth: lineWidth,
          selectable: false,
          evented: false,
        });
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const onMouseDown = async (opt: any) => {
        const pos = getPos(opt);
        const { color, lineWidth } = drawingOptions;
        const { Line, Circle, Ellipse, Polygon, IText } = (await loadFabric());

        if (activeTool === 'erase') {
          // Remove the topmost object at the click position
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const target = (opt as any).target;
          if (target) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            fc.remove(target as any);
            fc.renderAll();
            pushHistory();
          }
          return;
        }

        if (activeTool === 'angle') {
          const state = angleStateRef.current;
          state.points.push(pos);

          if (state.phase === 0) {
            state.phase = 1;
          } else if (state.phase === 1) {
            // Draw first line
            const line = new Line(
              [state.points[0].x, state.points[0].y, pos.x, pos.y],
              { stroke: color, strokeWidth: lineWidth, selectable: false, evented: false },
            );
            fc.add(line);
            state.tempLines.push(line);
            state.phase = 2;
          } else if (state.phase === 2) {
            // Clear live preview
            angleLivePreviewRef.current.phase2Active = false;
            // Remove temp lines, draw final angle + label
            state.tempLines.forEach((l) => fc.remove(l));
            state.tempLines = [];

            const [p0, p1, p2] = state.points;
            const deg = calcAngleDeg(p0, p1, p2);

            const line1 = new Line([p0.x, p0.y, p1.x, p1.y], {
              stroke: color, strokeWidth: lineWidth, selectable: false, evented: false,
            });
            const line2 = new Line([p1.x, p1.y, p2.x, p2.y], {
              stroke: color, strokeWidth: lineWidth, selectable: false, evented: false,
            });
            const label = new IText(`${deg}°`, {
              left: p1.x + 6,
              top: p1.y - 20,
              fontSize: drawingOptions.fontSize,
              fill: color,
              fontFamily: 'Inter, sans-serif',
              selectable: false,
              evented: false,
            });

            fc.add(line1, line2, label);
            fc.renderAll();
            state.phase = 0;
            state.points = [];
            state.tempLines = [];
            pushHistory();
          }
        }

        if (activeTool === 'circle') {
          const state = circleStateRef.current;
          if (!state.drawing) {
            state.drawing = true;
            state.start = pos;
          }
        }

        if (activeTool === 'bodyCircle') {
          const state = bodyCircleStateRef.current;
          if (!state.drawing) {
            state.drawing = true;
            state.start = pos;
          }
        }

        if (activeTool === 'arrow') {
          const state = arrowStateRef.current;
          if (!state.drawing) {
            state.drawing = true;
            state.start = pos;
          }
        }

        if (activeTool === 'arrowAngle') {
          const state = arrowAngleStateRef.current;
          if (state.phase === 0) {
            state.phase = 1;
            state.start = pos;
          } else if (state.phase === 1 && state.start) {
            // Draw arrow
            const pts = makeArrowHead(
              state.start.x, state.start.y, pos.x, pos.y, color,
            );
            const line = new Line(
              [state.start.x, state.start.y, pos.x, pos.y],
              { stroke: color, strokeWidth: lineWidth, selectable: false, evented: false },
            );
            const head = new Polygon(pts, {
              fill: color, selectable: false, evented: false,
            });

            // compute angle relative to horizontal
            const dx = pos.x - state.start.x;
            const dy = pos.y - state.start.y;
            const angleDeg = Math.round(Math.atan2(dy, dx) * 180 / Math.PI);
            const label = new IText(`${angleDeg}°`, {
              left: (state.start.x + pos.x) / 2 + 6,
              top: (state.start.y + pos.y) / 2 - 16,
              fontSize: drawingOptions.fontSize,
              fill: color,
              fontFamily: 'Inter, sans-serif',
              selectable: false,
              evented: false,
            });

            fc.add(line, head, label);
            fc.renderAll();
            state.phase = 0;
            state.start = null;
            pushHistory();
          }
        }

        if (activeTool === 'text') {
          const t = new IText('', {
            left: pos.x,
            top: pos.y,
            fontSize: drawingOptions.fontSize,
            fill: color,
            fontFamily: 'Inter, sans-serif',
            selectable: true,
            evented: true,
          });
          fc.add(t);
          fc.setActiveObject(t);
          t.enterEditing();
          fc.renderAll();
          pushHistory();
        }

        if (activeTool === 'ballShadow') {
          // Record this click as a ball trail point at the current video timestamp
          const video = videoRef.current;
          const time = video?.currentTime ?? 0;
          const nx = pos.x / containerWidth;
          const ny = pos.y / containerHeight;
          addBallPoint(ballTrailStateRef.current, nx, ny, time);
        }

        if (activeTool === 'skeleton') {
          // Only place joints while the video is paused
          const video = videoRef.current;
          if (video && video.paused) {
            const nx = pos.x / containerWidth;
            const ny = pos.y / containerHeight;
            addJoint(skeletonStateRef.current, nx, ny);
          }
        }

        if (activeTool === 'swingPath') {
          const state = swingPathStateRef.current;
          if (!state.isDrawing) return; // terminated via dblclick or long-press
          const dotR = Math.max(4, lineWidth + 1);
          const dot = new Circle({
            left: pos.x - dotR,
            top: pos.y - dotR,
            radius: dotR,
            fill: color,
            stroke: color,
            strokeWidth: 1,
            selectable: false,
            evented: false,
          });

          if (state.points.length > 0) {
            const prev = state.points[state.points.length - 1];
            const connLine = new Line([prev.x, prev.y, pos.x, pos.y], {
              stroke: color,
              strokeWidth: lineWidth,
              selectable: false,
              evented: false,
            });
            fc.add(connLine);
            state.lines.push(connLine);

            // Show distance label between dots
            const dx = pos.x - prev.x;
            const dy = pos.y - prev.y;
            const dist = Math.round(Math.sqrt(dx * dx + dy * dy));
            const distLabel = new IText(`${dist}px`, {
              left: (prev.x + pos.x) / 2 + 4,
              top: (prev.y + pos.y) / 2 - 14,
              fontSize: Math.max(10, drawingOptions.fontSize - 8),
              fill: color,
              fontFamily: 'Inter, sans-serif',
              selectable: false,
              evented: false,
            });
            fc.add(distLabel);
            state.dots.push(distLabel);
          }

          // Dot number label
          const numLabel = new IText(`${state.points.length + 1}`, {
            left: pos.x + dotR + 2,
            top: pos.y - dotR,
            fontSize: Math.max(10, drawingOptions.fontSize - 8),
            fill: color,
            fontFamily: 'Inter, sans-serif',
            selectable: false,
            evented: false,
          });

          fc.add(dot, numLabel);
          state.dots.push(dot, numLabel);
          state.points.push(pos);
          state.isDrawing = true; // mark that we've started drawing
          fc.renderAll();
          pushHistory();
        }
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const onMouseMove = async (opt: any) => {
        const pos = getPos(opt);

        // Track mouse position for skeleton joint preview
        if (activeTool === 'skeleton') {
          mousePreviewRef.current = pos;
        }

        // Track cursor for live angle arc preview (phase 2 = waiting for 3rd point)
        if (activeTool === 'angle') {
          const aState = angleStateRef.current;
          if (aState.phase === 2 && aState.points.length >= 2) {
            angleLivePreviewRef.current.phase2Active = true;
            angleLivePreviewRef.current.p0 = aState.points[0];
            angleLivePreviewRef.current.p1 = aState.points[1];
            angleLivePreviewRef.current.cursor = pos;
          }
        } else {
          angleLivePreviewRef.current.phase2Active = false;
        }

        const { color, lineWidth } = drawingOptions;
        const { Line, Ellipse } = (await loadFabric());

        if (activeTool === 'circle') {
          const state = circleStateRef.current;
          if (!state.drawing || !state.start) return;
          if (state.tempShape) fc.remove(state.tempShape);
          const rx = Math.abs(pos.x - state.start.x) / 2;
          const ry = Math.abs(pos.y - state.start.y) / 2;
          const e = new Ellipse({
            left: Math.min(pos.x, state.start.x),
            top: Math.min(pos.y, state.start.y),
            rx, ry,
            fill: 'transparent',
            stroke: color,
            strokeWidth: lineWidth,
            selectable: false,
            evented: false,
          });
          fc.add(e);
          state.tempShape = e;
          fc.renderAll();
        }

        if (activeTool === 'bodyCircle') {
          const state = bodyCircleStateRef.current;
          if (!state.drawing || !state.start) return;
          if (state.tempShape) fc.remove(state.tempShape);
          const rx = Math.abs(pos.x - state.start.x) / 2;
          const ry = Math.abs(pos.y - state.start.y) / 2;
          const e = new Ellipse({
            left: Math.min(pos.x, state.start.x),
            top: Math.min(pos.y, state.start.y),
            rx, ry,
            fill: 'rgba(100,180,255,0.08)',
            stroke: color,
            strokeWidth: lineWidth + 1,
            strokeDashArray: [8, 4],
            selectable: false,
            evented: false,
          });
          fc.add(e);
          state.tempShape = e;
          fc.renderAll();
        }

        if (activeTool === 'arrow') {
          const state = arrowStateRef.current;
          if (!state.drawing || !state.start) return;
          if (state.tempLine) fc.remove(state.tempLine);
          const l = new Line([state.start.x, state.start.y, pos.x, pos.y], {
            stroke: color, strokeWidth: lineWidth, selectable: false, evented: false,
          });
          fc.add(l);
          state.tempLine = l;
          fc.renderAll();
        }

        if (activeTool === 'ballShadow') {
          const state = ballShadowStateRef.current;
          if (!state.drawing || !state.start) return;
          if (state.tempShape) fc.remove(state.tempShape);
          const e = makeBallShadow(Ellipse, state.start, pos, lineWidth);
          fc.add(e);
          state.tempShape = e;
          fc.renderAll();
        }
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const onMouseUp = async (opt: any) => {
        const pos = getPos(opt);
        const { color, lineWidth } = drawingOptions;
        const { Line, Ellipse, Polygon } = (await loadFabric());

        if (activeTool === 'circle') {
          const state = circleStateRef.current;
          if (!state.drawing || !state.start) return;
          if (state.tempShape) fc.remove(state.tempShape);
          const rx = Math.abs(pos.x - state.start.x) / 2;
          const ry = Math.abs(pos.y - state.start.y) / 2;
          const e = new Ellipse({
            left: Math.min(pos.x, state.start.x),
            top: Math.min(pos.y, state.start.y),
            rx, ry,
            fill: 'transparent',
            stroke: color,
            strokeWidth: lineWidth,
            selectable: false,
            evented: false,
          });
          fc.add(e);
          state.drawing = false;
          state.start = null;
          state.tempShape = null;
          fc.renderAll();
          pushHistory();
        }

        if (activeTool === 'bodyCircle') {
          const state = bodyCircleStateRef.current;
          if (!state.drawing || !state.start) return;
          if (state.tempShape) fc.remove(state.tempShape);
          const rx = Math.abs(pos.x - state.start.x) / 2;
          const ry = Math.abs(pos.y - state.start.y) / 2;
          const e = new Ellipse({
            left: Math.min(pos.x, state.start.x),
            top: Math.min(pos.y, state.start.y),
            rx, ry,
            fill: 'rgba(100,180,255,0.08)',
            stroke: color,
            strokeWidth: lineWidth + 1,
            strokeDashArray: [8, 4],
            selectable: true,
            evented: true,
          });
          fc.add(e);
          state.drawing = false;
          state.start = null;
          state.tempShape = null;
          fc.renderAll();
          pushHistory();
        }

        if (activeTool === 'arrow') {
          const state = arrowStateRef.current;
          if (!state.drawing || !state.start) return;
          if (state.tempLine) fc.remove(state.tempLine);
          const pts = makeArrowHead(
            state.start.x, state.start.y, pos.x, pos.y, color,
          );
          const line = new Line([state.start.x, state.start.y, pos.x, pos.y], {
            stroke: color, strokeWidth: lineWidth, selectable: false, evented: false,
          });
          const head = new Polygon(pts, {
            fill: color, selectable: false, evented: false,
          });
          fc.add(line, head);
          state.drawing = false;
          state.start = null;
          state.tempLine = null;
          fc.renderAll();
          pushHistory();
        }

        if (activeTool === 'ballShadow') {
          const state = ballShadowStateRef.current;
          if (!state.drawing || !state.start) return;
          if (state.tempShape) fc.remove(state.tempShape);
          fc.add(makeBallShadow(Ellipse, state.start, pos, lineWidth));
          state.drawing = false;
          state.start = null;
          state.tempShape = null;
          fc.renderAll();
          pushHistory();
        }
      };

      // Clear skeleton preview when pointer leaves the canvas
      const onMouseOut = () => { mousePreviewRef.current = null; };

      // Double-click to finalize swing path (desktop)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const onDblClick = (_opt: any) => {
        if (activeTool === 'swingPath') {
          const state = swingPathStateRef.current;
          if (state.isDrawing) {
            state.isDrawing = false;
            // Reset for next path (keep drawn objects on canvas)
            state.points = [];
            state.dots = [];
            state.lines = [];
          }
        }
      };

      // Long-press (500ms) to finalize swing path on touch
      const finalizeSwingPath = () => {
        const state = swingPathStateRef.current;
        if (state.isDrawing) {
          state.isDrawing = false;
          state.points = [];
          state.dots = [];
          state.lines = [];
          longPressFiredRef.current = true;
        }
      };

      const canvasEl = fc.getElement();

      const onTouchStart = () => {
        if (activeTool !== 'swingPath') return;
        longPressFiredRef.current = false;
        longPressTimerRef.current = setTimeout(finalizeSwingPath, 500);
      };

      const onTouchEnd = () => {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
      };

      const onTouchMove = () => {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
      };

      fc.on('mouse:down', onMouseDown);
      fc.on('mouse:move', onMouseMove);
      fc.on('mouse:up', onMouseUp);
      fc.on('mouse:out', onMouseOut);
      fc.on('mouse:dblclick', onDblClick);
      canvasEl.addEventListener('touchstart', onTouchStart, { passive: true });
      canvasEl.addEventListener('touchend', onTouchEnd, { passive: true });
      canvasEl.addEventListener('touchmove', onTouchMove, { passive: true });

      return () => {
        fc.off('mouse:down', onMouseDown);
        fc.off('mouse:move', onMouseMove);
        fc.off('mouse:up', onMouseUp);
        fc.off('mouse:out', onMouseOut);
        fc.off('mouse:dblclick', onDblClick);
        canvasEl.removeEventListener('touchstart', onTouchStart);
        canvasEl.removeEventListener('touchend', onTouchEnd);
        canvasEl.removeEventListener('touchmove', onTouchMove);
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
      };
    }, [activeTool, drawingOptions, pushHistory, fabricReady, containerWidth, containerHeight]);

    // Expose imperative handle
    useImperativeHandle(ref, () => ({
      getCompositeCanvas: () => {
        const video = videoRef.current;
        const fc = fabricRef.current;
        if (!video || !fc) return null;

        const w = containerWidth;
        const h = containerHeight;
        const tmp = document.createElement('canvas');
        tmp.width = w;
        tmp.height = h;
        const ctx = tmp.getContext('2d')!;
        ctx.drawImage(video, 0, 0, w, h);
        ctx.drawImage(fc.getElement(), 0, 0, w, h);
        // Include skeleton and ball-trail overlay in exported/recorded frame
        const overlay = overlayCanvasRef.current;
        if (overlay) ctx.drawImage(overlay, 0, 0, w, h);
        return tmp;
      },
      getFabricCanvas: () => fabricRef.current?.getElement() ?? null,
      clearAll: () => {
        const fc = fabricRef.current;
        if (!fc) return;
        fc.clear();
        fc.backgroundColor = 'transparent';
        fc.renderAll();
        // Also clear skeleton and ball trail state
        resetSkeleton(skeletonStateRef.current);
        resetBallTrail(ballTrailStateRef.current);
        pushHistory();
      },
      undo: async () => {
        if (historyIndexRef.current <= 0) return;
        historyIndexRef.current -= 1;
        isModifyingRef.current = true;
        await deserializeCanvas(
          fabricRef.current!,
          historyRef.current[historyIndexRef.current],
        );
        isModifyingRef.current = false;
      },
      redo: async () => {
        if (historyIndexRef.current >= historyRef.current.length - 1) return;
        historyIndexRef.current += 1;
        isModifyingRef.current = true;
        await deserializeCanvas(
          fabricRef.current!,
          historyRef.current[historyIndexRef.current],
        );
        isModifyingRef.current = false;
      },
      resetSkeleton: () => {
        resetSkeleton(skeletonStateRef.current);
        // Also clear AI cached poses so next activation re-processes
        cachedPosesRef.current = [];
      },
      resetBallTrail: () => {
        resetBallTrail(ballTrailStateRef.current);
        // Also clear auto-detected ball cache
        cachedBallRef.current = [];
      },
    }));

    return (
      <>
        {/* Fabric canvas — annotation drawing tools */}
        <canvas
          ref={canvasElRef}
          className="absolute inset-0 w-full h-full"
          style={{ touchAction: 'none' }}
        />
        {/* Overlay canvas — skeleton, ball trail, angle preview (pointer-events: none so clicks pass through) */}
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ pointerEvents: 'none' }}
        />
        {/* AI Skeleton progress overlay */}
        {poseProgress !== null && (
          <div className="absolute inset-x-0 bottom-4 flex justify-center pointer-events-none">
            <div className="bg-black/70 text-cyan-300 text-xs font-semibold rounded-lg px-4 py-2 flex items-center gap-2">
              <span className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
              Analyzing pose… {poseProgress}%
            </div>
          </div>
        )}
        {/* Ball Detection progress overlay */}
        {ballProgress !== null && (
          <div className="absolute inset-x-0 bottom-4 flex justify-center pointer-events-none">
            <div className="bg-black/70 text-yellow-300 text-xs font-semibold rounded-lg px-4 py-2 flex items-center gap-2">
              <span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
              Detecting ball… {ballProgress}%
            </div>
          </div>
        )}
      </>
    );
  },
);

export default CanvasOverlay;
