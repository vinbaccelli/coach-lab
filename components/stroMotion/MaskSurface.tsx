'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  containerToFrame,
  cssTransform,
  frameRectToContainer,
  isFrameSizedMask,
  makeViewTransform,
  type Point,
  type Size,
  type ViewTransform,
} from '@/lib/stroMotionDraft/viewTransform';
import type { AlphaMask } from '@/lib/stroMotionDraft/types';

/**
 * THE DISPLAY SURFACE — mask-editor rebuild, Phases 1–2.
 *
 * Renders a frame plus its mask overlay in ONE coordinate space, and (Phase 2)
 * converts pointer input into FRAME-space brush segments through the inverse of
 * that same transform. It still never mutates a mask: it reports where the coach
 * painted and re-renders whatever mask comes back down as a prop. Selection
 * scoping and AI population are later phases and hang off the same
 * `ViewTransform` this component publishes via `onTransformChange`.
 *
 * THE THREE SURFACES, and how they are kept coherent:
 *
 *   DRAW    — the container <div>. Untransformed, statically positioned, so its
 *             getBoundingClientRect() is stable and does not depend on any render
 *             effect having succeeded. Phase 2 attaches the pointer listeners
 *             here, and here only: because the div carries no transform, the rect
 *             it reports is the honest origin of container space, and
 *             `containerToFrame` — the exact inverse of the transform the canvases
 *             carry — is the whole of the conversion. Nothing measures a
 *             transformed element, and nothing recomputes a scale.
 *   MASK    — an AlphaMask in FRAME space at identity. Must be exactly frame
 *             sized; a mismatch is refused and reported, never silently rescaled.
 *   DISPLAY — two stacked canvases, each with a backing store of exactly
 *             frame.width × frame.height AND a CSS size of the same number of
 *             px, both carrying the identical transform. Because backing store
 *             and CSS size are equal, `vt.scale` is the only scaling in the
 *             chain — the same number the pointer conversion will divide by.
 *
 * Two canvases rather than one: the frame is decoded and drawn ONCE per
 * sourceFrame, and the overlay is a genuinely transparent layer above it. The old
 * editor composited both into a single canvas, which forced a full-frame
 * getImageData + putImageData round-trip on every mask change (~8 MB per pointer
 * event at 1080p) and coupled overlay repaints to re-drawing the video frame.
 *
 * THE SIZING RULE (this is the bug fix, not a detail):
 * `canvas.width` / `canvas.height` are assigned in ONE layout effect keyed on
 * `sourceFrame` alone. No drawing path may resize a canvas. In the old editor the
 * backing-store assignment lived inside the mask-render effect, so a render that
 * aborted early — `getContext` returning null, or drawImage throwing on a closed
 * ImageBitmap — left `canvas.width` at the HTML default 300×150 while the input
 * handler went on reading it as the authoritative scale. Separating the two makes
 * that class of failure structurally impossible: a failed draw can now blank the
 * screen, but it can never move the coordinate space.
 */

/** Cyan, matching the old editor's overlay colour so coach muscle memory holds. */
const DEFAULT_OVERLAY_RGB: readonly [number, number, number] = [0, 210, 255];

export interface BrushSettings {
  /**
   * Radius in FRAME px — mask space, not screen space. Zooming in therefore
   * shows a bigger ring but paints the same mask pixels, which is what "brush
   * size" has to mean when the mask is the thing being edited.
   */
  radiusFramePx: number;
  mode: 'add' | 'remove';
}

export interface MaskSurfaceProps {
  /** The captured video frame. Defines FRAME space. */
  sourceFrame: ImageBitmap;
  /** Mask in FRAME space. Must be exactly frame-sized. */
  mask: AlphaMask;
  /** Multiplier on the contain-fit base scale. 1 = whole frame visible. */
  zoom?: number;
  /** Displacement in container CSS px, applied after centring. */
  pan?: Point;
  /** Overlay tint. */
  overlayRgb?: readonly [number, number, number];
  /** Overlay strength, 0..1, multiplied into the mask's own alpha. */
  overlayOpacity?: number;
  /**
   * Nearest-neighbour upscaling. On by default: a smoothed edge is unusable for
   * the pixel-level alignment inspection this surface exists to support.
   */
  pixelated?: boolean;
  /** Stroke a 1px outline around the full FRAME extent on the overlay layer. */
  showFrameBorder?: boolean;
  /** Published on every transform change so callers can predict screen geometry. */
  onTransformChange?: (transform: ViewTransform, container: Size) => void;
  /** Reported when `mask` is not frame-sized — the overlay is left blank. */
  onInvariantViolation?: (message: string) => void;
  /**
   * Phase 2. Omit (or pass null) and the surface behaves exactly as in Phase 1:
   * display only, no listeners, no cursor. Present ⇒ pointer input is routed.
   */
  brush?: BrushSettings | null;
  /**
   * A brush segment in FRAME px, emitted per pointer sample while painting. The
   * caller owns the mask and applies `applyBrushStrokeToMask` — the surface
   * deliberately never mutates mask data, so there is exactly one place a mask
   * can change and exactly one place a coordinate can be converted.
   *
   * `from === to` on pointerdown (a click stamps one disc).
   */
  onPaint?: (from: Point, to: Point) => void;
  /** Pointerdown / pointerup-or-cancel, for undo grouping in a later phase. */
  onStrokeStart?: () => void;
  onStrokeEnd?: () => void;
  /** Brush-size ring following the pointer. On whenever `brush` is set. */
  showBrushCursor?: boolean;
  /** Overlay repaint cost, per repaint. Diagnostics only; never drives render. */
  onOverlayPainted?: (stats: { ms: number }) => void;
  style?: React.CSSProperties;
}

export default function MaskSurface({
  sourceFrame,
  mask,
  zoom = 1,
  pan = { x: 0, y: 0 },
  overlayRgb = DEFAULT_OVERLAY_RGB,
  overlayOpacity = 0.75,
  pixelated = true,
  showFrameBorder = true,
  onTransformChange,
  onInvariantViolation,
  brush = null,
  onPaint,
  onStrokeStart,
  onStrokeEnd,
  showBrushCursor = true,
  onOverlayPainted,
  style,
}: MaskSurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);

  const [container, setContainer] = useState<Size>({ width: 0, height: 0 });

  const frameSize = useMemo<Size>(
    () => ({ width: sourceFrame.width, height: sourceFrame.height }),
    [sourceFrame],
  );

  // ── Container measurement ────────────────────────────────────────────────
  // The container is never transformed, so this rect is the honest one. A
  // ResizeObserver keeps it live without any layout read during paint.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      setContainer((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // A window-resize fallback for the SAME measurement. ResizeObserver is the
    // primary and normally the only one that fires — but it is not delivered in
    // every embedding (an automation pane that never composites drops the
    // callbacks entirely, observed while verifying Phase 2). A stale container
    // means a stale scale, and a stale scale is exactly the failure this rebuild
    // exists to remove, so the trigger must not be single-sourced. This reads
    // the identical rect through the identical path; it cannot change alignment.
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const transform = useMemo(
    () => makeViewTransform(container, frameSize, zoom, pan),
    [container, frameSize, zoom, pan],
  );

  useEffect(() => {
    onTransformChange?.(transform, container);
  }, [transform, container, onTransformChange]);

  // ── Live mirrors for the pointer path ────────────────────────────────────
  // Pointer handlers must read the CURRENT transform and brush without being
  // rebuilt (and re-attached) on every change. useLayoutEffect, not an
  // assignment during render: it commits before the browser can paint, so no
  // pointer event can observe a stale value.
  const transformRef = useRef<ViewTransform>(transform);
  const brushRef = useRef<BrushSettings | null>(brush);
  const paintCallbacksRef = useRef({ onPaint, onStrokeStart, onStrokeEnd });
  const onOverlayPaintedRef = useRef(onOverlayPainted);
  useLayoutEffect(() => {
    transformRef.current = transform;
    brushRef.current = brush;
    paintCallbacksRef.current = { onPaint, onStrokeStart, onStrokeEnd };
    onOverlayPaintedRef.current = onOverlayPainted;
  });

  // ── Backing-store sizing — the ONLY place canvases are resized ───────────
  // Keyed on sourceFrame alone. Nothing in a drawing path may touch these.
  useLayoutEffect(() => {
    for (const canvas of [frameCanvasRef.current, overlayCanvasRef.current]) {
      if (!canvas) continue;
      if (canvas.width !== frameSize.width) canvas.width = frameSize.width;
      if (canvas.height !== frameSize.height) canvas.height = frameSize.height;
    }
  }, [frameSize]);

  // ── Frame layer — drawn once per sourceFrame ─────────────────────────────
  useEffect(() => {
    const canvas = frameCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, frameSize.width, frameSize.height);
    try {
      ctx.drawImage(sourceFrame, 0, 0, frameSize.width, frameSize.height);
    } catch (err) {
      // A closed ImageBitmap lands here. It must stay a DRAWING failure — the
      // canvas keeps its frame-sized backing store, so the coordinate space is
      // untouched and only the picture is missing.
      console.error('[MaskSurface] frame draw failed (bitmap closed?):', err);
    }
  }, [sourceFrame, frameSize]);

  // ── Overlay layer — transparent everywhere the mask is zero ──────────────
  // Phase 2 changes NOTHING about how a mask becomes pixels. It re-runs because
  // `mask` is a new object after every brush segment (applyBrushStrokeToMask
  // clones), so the stroke is on screen by exactly the path Phase 1 verified.
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const startedAt = performance.now();

    const { width: w, height: h } = frameSize;
    ctx.clearRect(0, 0, w, h);

    if (!isFrameSizedMask(mask, frameSize)) {
      // Refused, not rescaled. Silently resampling a mismatched mask is how a
      // coordinate disagreement turns into a plausible-looking picture that
      // nobody can trace back to its cause.
      const message =
        `mask ${mask.width}x${mask.height} (${mask.data.length} px) does not match ` +
        `frame ${w}x${h} (${w * h} px) — overlay suppressed`;
      console.error(`[MaskSurface] INVARIANT: ${message}`);
      onInvariantViolation?.(message);
      return;
    }

    const [r, g, b] = overlayRgb;
    const strength = Math.max(0, Math.min(1, overlayOpacity));
    const image = ctx.createImageData(w, h); // zero-filled ⇒ fully transparent
    const px = image.data;
    for (let i = 0; i < w * h; i++) {
      const a = mask.data[i];
      if (a <= 0) continue;
      const o = i * 4;
      px[o] = r;
      px[o + 1] = g;
      px[o + 2] = b;
      px[o + 3] = Math.round(a * strength);
    }
    ctx.putImageData(image, 0, 0);
    onOverlayPaintedRef.current?.({ ms: performance.now() - startedAt });
  }, [mask, frameSize, overlayRgb, overlayOpacity, onInvariantViolation]);

  // ── DRAW surface — pointer → FRAME px ────────────────────────────────────
  // The entire conversion, for every pointer event, is: read the UNTRANSFORMED
  // container's rect, subtract its origin, hand the result to containerToFrame.
  // No getBoundingClientRect on a canvas, no division by canvas.width, no scale
  // reconstructed from a measured element — those were the two competing
  // authorities that made the old editor paint where nobody was pointing.
  const paintingPointerRef = useRef<number | null>(null);
  const lastFramePointRef = useRef<Point | null>(null);

  const toFramePoint = useCallback((clientX: number, clientY: number): Point | null => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return containerToFrame(transformRef.current, clientX - rect.left, clientY - rect.top);
  }, []);

  // The cursor ring is written straight to the DOM rather than held in state:
  // at 1080p a re-render per pointermove already costs a full-frame overlay
  // repaint, and re-rendering again just to move a ring would double it.
  const moveCursor = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current;
    const ring = cursorRef.current;
    const b = brushRef.current;
    if (!el || !ring || !b) return;
    const rect = el.getBoundingClientRect();
    const diameter = Math.max(2, b.radiusFramePx * 2 * transformRef.current.scale);
    ring.style.width = `${diameter}px`;
    ring.style.height = `${diameter}px`;
    ring.style.left = `${clientX - rect.left}px`;
    ring.style.top = `${clientY - rect.top}px`;
    ring.style.opacity = '1';
  }, []);

  const hideCursor = useCallback(() => {
    if (cursorRef.current) cursorRef.current.style.opacity = '0';
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!brushRef.current || e.button !== 0) return;
      const point = toFramePoint(e.clientX, e.clientY);
      if (!point) return;

      paintingPointerRef.current = e.pointerId;
      lastFramePointRef.current = point;
      // Capture keeps a drag alive past the container edge. Synthetic events
      // dispatched by the verification probe carry no active pointer, and
      // setPointerCapture throws NotFoundError for those — the throw is
      // irrelevant to painting, so it must not abort the stroke.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* no live pointer for this id (synthetic event) */
      }
      moveCursor(e.clientX, e.clientY);
      paintCallbacksRef.current.onStrokeStart?.();
      paintCallbacksRef.current.onPaint?.(point, point);
    },
    [moveCursor, toFramePoint],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!brushRef.current) return;
      moveCursor(e.clientX, e.clientY);
      if (paintingPointerRef.current !== e.pointerId) return;

      const point = toFramePoint(e.clientX, e.clientY);
      if (!point) return;
      const from = lastFramePointRef.current ?? point;
      lastFramePointRef.current = point;
      paintCallbacksRef.current.onPaint?.(from, point);
    },
    [moveCursor, toFramePoint],
  );

  const endStroke = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (paintingPointerRef.current !== e.pointerId) return;
    paintingPointerRef.current = null;
    lastFramePointRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* never captured */
    }
    paintCallbacksRef.current.onStrokeEnd?.();
  }, []);

  // The FRAME-extent outline is CHROME, not mask data: a plain untransformed div
  // positioned through the same transform. Drawing it into the overlay raster
  // instead would make it 1 FRAME px wide — sub-pixel and invisible at fit-zoom —
  // and would rebuild the whole overlay on every zoom change, which Phase 3's
  // dirty-rect repaint must not do.
  const frameBorderRect = useMemo(
    () => frameRectToContainer(transform, { x: 0, y: 0, ...frameSize }),
    [transform, frameSize],
  );

  // Identical geometry for both layers: intrinsic size in CSS px, one transform.
  const layerStyle = useCallback(
    (zIndex: number): React.CSSProperties => ({
      position: 'absolute',
      top: 0,
      left: 0,
      width: `${frameSize.width}px`,
      height: `${frameSize.height}px`,
      transform: cssTransform(transform),
      transformOrigin: '0 0',
      imageRendering: pixelated ? 'pixelated' : 'auto',
      pointerEvents: 'none',
      zIndex,
    }),
    [frameSize, transform, pixelated],
  );

  return (
    <div
      ref={containerRef}
      data-mask-surface-container=""
      data-mask-surface-brush={brush ? brush.mode : 'off'}
      onPointerDown={brush ? handlePointerDown : undefined}
      onPointerMove={brush ? handlePointerMove : undefined}
      onPointerUp={brush ? endStroke : undefined}
      onPointerCancel={brush ? endStroke : undefined}
      onPointerLeave={brush ? hideCursor : undefined}
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: '#000',
        touchAction: 'none',
        cursor: brush ? 'none' : undefined,
        ...style,
      }}
    >
      <canvas ref={frameCanvasRef} data-mask-surface-layer="frame" style={layerStyle(0)} />
      <canvas ref={overlayCanvasRef} data-mask-surface-layer="overlay" style={layerStyle(1)} />
      {showFrameBorder ? (
        <div
          data-mask-surface-layer="frame-border"
          style={{
            position: 'absolute',
            left: frameBorderRect.x,
            top: frameBorderRect.y,
            width: frameBorderRect.width,
            height: frameBorderRect.height,
            border: '1px solid rgba(255,214,10,0.9)',
            boxSizing: 'border-box',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        />
      ) : null}
      {brush && showBrushCursor ? (
        <div
          ref={cursorRef}
          data-mask-surface-layer="brush-cursor"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 0,
            height: 0,
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            border:
              brush.mode === 'add'
                ? '1.5px solid rgba(0,210,255,0.95)'
                : '1.5px solid rgba(255,69,58,0.95)',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.55)',
            boxSizing: 'border-box',
            pointerEvents: 'none',
            opacity: 0,
            zIndex: 3,
          }}
        />
      ) : null}
    </div>
  );
}
