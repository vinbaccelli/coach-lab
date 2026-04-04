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

// Dynamic import for fabric (SSR-safe)
let fabricModule: typeof import('fabric') | null = null;
const loadFabric = async () => {
  if (!fabricModule) {
    fabricModule = await import('fabric');
  }
  return fabricModule;
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

interface CanvasProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  activeTool: ToolType;
  drawingOptions: DrawingOptions;
  containerWidth: number;
  containerHeight: number;
}

const MAX_HISTORY = 50;

const CanvasOverlay = React.forwardRef<CanvasHandle, CanvasProps>(
  function CanvasOverlay(
    { videoRef, activeTool, drawingOptions, containerWidth, containerHeight },
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
    }>({ points: [], dots: [], lines: [] });

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
      swingPathStateRef.current = { points: [], dots: [], lines: [] };

      // Enable skeleton / ball-trail overlays when their tools are activated;
      // disable them when any other tool is active so the overlays are hidden.
      if (activeTool === 'skeleton') {
        enableSkeleton(skeletonStateRef.current);
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

        animFrameId = requestAnimationFrame(render);
      };

      animFrameId = requestAnimationFrame(render);
      return () => cancelAnimationFrame(animFrameId);
    // activeTool is included so the preview condition stays current inside the loop;
    // videoRef is included so the closure captures the ref object (it's stable but listed for clarity)
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

      fc.on('mouse:down', onMouseDown);
      fc.on('mouse:move', onMouseMove);
      fc.on('mouse:up', onMouseUp);
      fc.on('mouse:out', onMouseOut);

      return () => {
        fc.off('mouse:down', onMouseDown);
        fc.off('mouse:move', onMouseMove);
        fc.off('mouse:up', onMouseUp);
        fc.off('mouse:out', onMouseOut);
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
      },
      resetBallTrail: () => {
        resetBallTrail(ballTrailStateRef.current);
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
        {/* Overlay canvas — skeleton and ball trail (pointer-events: none so clicks pass through) */}
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ pointerEvents: 'none' }}
        />
      </>
    );
  },
);

export default CanvasOverlay;
