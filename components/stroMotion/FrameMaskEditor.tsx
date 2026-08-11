'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Brush,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Crosshair,
  Droplets,
  Eraser,
  Eye,
  EyeOff,
  Home,
  Maximize2,
  Redo2,
  RefreshCw,
  RotateCcw,
  Target,
  Undo2,
  Wand2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  applyBrushToMask,
  cloneAlphaMask,
  floodRemoveInMask,
  type AlphaMask,
  type BrushMode,
} from '@/lib/stroMotionDraft';
import type { StroMotionSubjectBox } from '@/lib/stroMotion';
import type { SamCandidate, SamPoint } from '@/lib/stroMotionDraft/samRacket';

/**
 * The editor's tool set. `racket` is a CLICK tool, not a brush — it prompts SAM
 * rather than painting pixels — so it sits alongside the brush modes here
 * instead of widening BrushMode, which applyBrushToMask consumes.
 */
type EditorTool = BrushMode | 'racket';

// TEMP-DEBUG-PHASE-MARKER — build-freshness probe ONLY. No editor logic depends
// on this. Fires once when this module is EVALUATED (i.e. when the lazy chunk is
// actually fetched and run by the browser), which is the question being asked:
// is the browser running THIS source, or a cached bundle? Remove with the grep
// tag once the pipeline question is settled.
const PHASE_MARKER = '106245';
/**
 * TEMP-DEBUG gate for this file's instrumentation.
 *
 * These probes fire per RENDER and per BRUSH POINT, which floods the console
 * hard enough to bury the skeleton-zone diagnostics we actually need to read.
 * They are gated rather than deleted so the instrumentation is still one flag
 * away when the next editor bug turns up.
 *
 *   window.__stroEditorDebug = true   // re-enable, then interact
 */
function dbg(...args: unknown[]): void {
  if (typeof window === 'undefined') return;
  if ((window as unknown as Record<string, unknown>).__stroEditorDebug !== true) return;
  // eslint-disable-next-line no-console
  console.log(...args);
}

dbg(`PHASE-MARKER-${PHASE_MARKER} [module-eval] FrameMaskEditor.tsx module evaluated`);

export interface FrameMaskEditorProps {
  sourceFrame: ImageBitmap;
  mask: AlphaMask;
  frameLabel: string;
  frameIndex?: number;
  frameTotal?: number;
  frameStatus?: 'pending' | 'edited' | 'ready';
  proposalEmpty?: boolean;
  backgroundPlate?: ImageBitmap | null;
  /** Normalized selection box used to auto-zoom the editor on open */
  selectionBox?: StroMotionSubjectBox | null;
  /**
   * The video's native display size (draft.videoWidth/Height). Diagnostic only —
   * the readout compares it against the captured frame so a capture/element size
   * disagreement is visible instead of silently misrendering.
   */
  videoNativeSize?: { width: number; height: number } | null;
  onMaskChange: (mask: AlphaMask) => void;
  onReset: () => void;
  /**
   * Re-run the AI proposal for this frame. Resolves FALSE when the pipeline
   * declined to replace the existing mask (a degenerate result) — the editor
   * tells the coach rather than leaving a silently unchanged canvas looking
   * like a no-op click.
   */
  onRegenerate: () => Promise<boolean | void> | boolean | void;
  onMarkReady?: () => void;
  onMarkReadyAndNext?: () => void;
  onClose: () => void;
  isRegenerating?: boolean;
  /** Tightens backdrop/panel padding and lets the header's text column shrink at narrow viewports. */
  isMobile?: boolean;
  /**
   * SAM embedding-cache key for THIS frame (samRacket.racketFrameKey).
   *
   * Supplied by the caller, which is the only place that knows both the frame
   * index and its timeSec. Null/absent disables the racket tool for this frame —
   * which is also what happens when the pre-encode pass did not run.
   */
  racketKey?: string | null;
}

export default function FrameMaskEditor({
  sourceFrame,
  mask,
  frameLabel,
  frameIndex,
  frameTotal,
  frameStatus = 'edited',
  proposalEmpty = false,
  backgroundPlate = null,
  selectionBox = null,
  videoNativeSize = null,
  onMaskChange,
  onReset,
  onRegenerate,
  onMarkReady,
  onMarkReadyAndNext,
  onClose,
  isRegenerating = false,
  isMobile = false,
  racketKey = null,
}: FrameMaskEditorProps) {
  // TEMP-DEBUG-PHASE-MARKER — fires on every render of THIS component instance.
  // Together with the module-eval log above it separates "chunk never fetched"
  // from "chunk fetched but component never rendered". Remove with the grep tag.
  dbg(`PHASE-MARKER-${PHASE_MARKER} [render] FrameMaskEditor rendering`);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [brushMode, setBrushMode] = useState<EditorTool>('add');
  const [brushSize, setBrushSize] = useState(18);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showCompositePreview, setShowCompositePreview] = useState(false);
  const [autoMatteBusy, setAutoMatteBusy] = useState(false);
  /** Transient feedback when a re-propose declined to replace the mask. */
  const [regenNotice, setRegenNotice] = useState<string | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const paintingRef = useRef(false);
  const panningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const maskRef = useRef(mask);
  const sourcePixelsRef = useRef<Uint8ClampedArray | null>(null);
  maskRef.current = mask;

  // Undo/redo stacks — store AlphaMask snapshots per stroke
  const undoStackRef = useRef<AlphaMask[]>([]);
  const redoStackRef = useRef<AlphaMask[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);

  const pushUndo = useCallback((snapshot: AlphaMask) => {
    undoStackRef.current.push(snapshot);
    if (undoStackRef.current.length > 40) undoStackRef.current.shift();
    redoStackRef.current = [];
    setUndoCount(undoStackRef.current.length);
    setRedoCount(0);
  }, []);

  const handleUndo = useCallback(() => {
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    redoStackRef.current.push(maskRef.current);
    maskRef.current = prev;
    onMaskChange(prev);
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
  }, [onMaskChange]);

  const handleRedo = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(maskRef.current);
    maskRef.current = next;
    onMaskChange(next);
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
  }, [onMaskChange]);

  // ── RACKET TOOL (SAM 2) ──────────────────────────────────────────────────
  //
  // A CLICK tool, not a brush. The coach builds the racket up point by point and
  // the mask GROWS with each click, because every decode is re-run with the FULL
  // accumulated point list — never a fresh segmentation per click. That is the
  // whole difference from what a naive implementation does, and the reason a
  // second click extends the racket instead of replacing it.
  //
  // TWO UNDO LEVELS, deliberately, at two different granularities:
  //   - While building: undo/redo walk the CLICK history (racketPoints), each
  //     click one step, re-decoding what remains. Points and mask can therefore
  //     never drift out of sync — the mask is always a pure function of the
  //     points, so there is no state to corrupt.
  //   - After Apply: the racket becomes ONE entry on the editor's existing mask
  //     undo stack, so mask-level undo removes the whole racket in a single
  //     step rather than making the coach walk back through every click.
  const [racketPoints, setRacketPoints] = useState<SamPoint[]>([]);
  const [racketRedo, setRacketRedo] = useState<SamPoint[]>([]);
  const [racketMask, setRacketMask] = useState<AlphaMask | null>(null);
  const [racketCands, setRacketCands] = useState<SamCandidate[] | null>(null);
  const [racketChosen, setRacketChosen] = useState<number | null>(null);
  const [racketBusy, setRacketBusy] = useState(false);
  const [racketNegative, setRacketNegative] = useState(false);
  const [racketNote, setRacketNote] = useState<string | null>(null);
  const [racketReady, setRacketReady] = useState(false);
  const [racketPreparing, setRacketPreparing] = useState(false);

  /**
   * Reticle position in CANVAS PIXELS — the same space clicks are resolved in.
   *
   * A REF, NOT STATE, and that is the whole fix for the lag. Routing pointermove
   * through setState re-rendered this (large) editor on every mouse move, so the
   * drawn reticle trailed the real pointer — and with a native crosshair also
   * showing, the coach saw two cursors chasing each other. The pointer handler
   * now writes this ref and paints the overlay directly, with no React render in
   * the path at all, and the native cursor is hidden so exactly ONE marker shows.
   */
  const racketCursorPosRef = useRef<{ x: number; y: number } | null>(null);
  const racketCursorCanvasRef = useRef<HTMLCanvasElement>(null);
  /** Bounds of the last reticle, so each repaint clears only what it dirtied. */
  const racketLastDrawRef = useRef<{ x: number; y: number; r: number } | null>(null);
  /** Mirror of the negative toggle, readable from the non-reactive draw path. */
  const racketNegativeRef = useRef(false);
  racketNegativeRef.current = racketNegative;

  /**
   * Draw the racket reticle.
   *
   * SAM is prompted with a single point, so a few pixels of aim decide whether
   * the coach gets the racket or the court behind it — the click target has to
   * be shown exactly, not approximated by a native arrow whose hotspot the coach
   * has to guess at. Hence a drawn reticle with a 1px centre dot.
   *
   * Sized in SCREEN pixels, derived from the canvas's live rendered rect rather
   * than from a fraction of its intrinsic width. The canvas is CSS-scaled (by
   * `zoom`, and again by however the panel fits it), so any fixed canvas-pixel
   * radius is a different on-screen size on every frame size and zoom level —
   * an earlier constant landed at ~4px arms on a 1080×1920 portrait clip, which
   * is far too small to aim with. Converting through the real rect makes the
   * reticle the same comfortable size everywhere.
   */
  const drawRacketReticle = useCallback(() => {
    const c = racketCursorCanvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    // Clear ONLY the previous reticle's box. A full clearRect over a 1080×1920
    // canvas on every pointermove is exactly the kind of per-move cost that
    // makes a cursor feel heavy.
    const last = racketLastDrawRef.current;
    if (last) {
      const pad = last.r + 4;
      ctx.clearRect(last.x - pad, last.y - pad, pad * 2, pad * 2);
    }
    racketLastDrawRef.current = null;

    const pos = racketCursorPosRef.current;
    if (!pos) return;
    const { x, y } = pos;

    // Negative clicks SUBTRACT, so the reticle says which kind is about to land
    // before it lands — red for remove, green for add.
    const colour = racketNegativeRef.current ? '#ff4d4d' : '#39ff88';
    // Screen px → canvas px. Falls back to 1 before first layout.
    const rect = c.getBoundingClientRect();
    const screenToCanvas = rect.width > 0 ? c.width / rect.width : 1;
    const ARM_SCREEN_PX = 13;
    const s = Math.max(2, ARM_SCREEN_PX * screenToCanvas); // arm length
    const gap = s * 0.32;

    ctx.save();
    ctx.lineCap = 'round';
    // Dark under-stroke so the reticle stays readable over a white shoe, the
    // clay, or a bright racket frame alike.
    for (const pass of [
      { w: Math.max(1.5, s * 0.3), c: 'rgba(0,0,0,0.8)' },
      { w: Math.max(0.8, s * 0.14), c: colour },
    ]) {
      ctx.strokeStyle = pass.c;
      ctx.lineWidth = pass.w;
      ctx.beginPath();
      ctx.moveTo(x - s, y); ctx.lineTo(x - gap, y);
      ctx.moveTo(x + gap, y); ctx.lineTo(x + s, y);
      ctx.moveTo(x, y - s); ctx.lineTo(x, y - gap);
      ctx.moveTo(x, y + gap); ctx.lineTo(x, y + s);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, s * 0.55, 0, Math.PI * 2);
      ctx.stroke();
    }
    // The exact pixel the prompt will use.
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.6, s * 0.09), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    racketLastDrawRef.current = { x, y, r: s + Math.max(1.5, s * 0.3) };
  }, []);

  // Repaint on the things the pointer handler does NOT drive: entering racket
  // mode, flipping the negative toggle (colour), and zooming (on-screen size).
  useEffect(() => {
    racketLastDrawRef.current = null; // the overlay remounts/rescales — no stale box
    if (brushMode !== 'racket') racketCursorPosRef.current = null;
    drawRacketReticle();
  }, [brushMode, racketNegative, zoom, sourceFrame, drawRacketReticle]);

  // Is this frame actually encoded? Without an embedding there is nothing to
  // prompt, so the tool reports that plainly instead of silently doing nothing.
  //
  // LAZY, AND ONLY HERE. Nothing about SAM — not the model, not transformers.js,
  // not the ORT wasm, not a single embedding — is touched until the coach
  // actually SELECTS the Racket tool on this frame. The batch pass used to
  // pre-encode every frame on every auto-process run, which cost ~35–60s and
  // ~250MB whether or not the racket was ever used; that pass is gone. The
  // encoder is a one-off per frame (~4–9s) paid by the coach who asked for it.
  useEffect(() => {
    if (brushMode !== 'racket' || !racketKey) return;
    let live = true;
    void (async () => {
      try {
        const { isFrameEncoded, encodeFrameForRacket } = await import('@/lib/stroMotionDraft/samRacket');
        if (!live) return;
        if (isFrameEncoded(racketKey)) {
          setRacketReady(true);
          return;
        }
        setRacketReady(false);
        setRacketPreparing(true);
        const res = await encodeFrameForRacket(racketKey, sourceFrame);
        if (!live) return;
        setRacketReady(!!res);
        if (!res) setRacketNote('Object select unavailable — the segmenter could not load on this machine.');
      } catch (e) {
        console.warn('[samRacket] prepare failed:', e);
        if (live) {
          setRacketReady(false);
          setRacketNote('Object select could not prepare this frame.');
        }
      } finally {
        if (live) setRacketPreparing(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [brushMode, racketKey, sourceFrame]);

  /**
   * Re-decode from a point list. The single path through which the racket mask
   * is ever produced — clicks, undo and redo all funnel here, so they cannot
   * disagree about what the mask should be.
   */
  const racketDecode = useCallback(
    async (points: SamPoint[], forceCandidate?: number) => {
      if (!racketKey) return;
      if (!points.some((p) => p.label === 1)) {
        setRacketMask(null);
        setRacketCands(null);
        setRacketChosen(null);
        setRacketNote(null);
        return;
      }
      setRacketBusy(true);
      try {
        const { decodeRacketMask } = await import('@/lib/stroMotionDraft/samRacket');
        const res = await decodeRacketMask(racketKey, points, forceCandidate);
        if (!res) {
          // Every candidate failed the plausibility gate. Say so — a silent
          // no-op reads as a broken tool, and "no racket beats a wrong racket"
          // only holds if the coach knows the refusal was deliberate.
          setRacketMask(null);
          setRacketCands(null);
          setRacketChosen(null);
          setRacketNote('No racket-shaped mask here — try clicking on the racket itself, or add another point.');
          return;
        }
        setRacketMask(res.mask);
        setRacketCands(res.candidates);
        setRacketChosen(res.chosen);
        setRacketNote(null);
      } catch (e) {
        console.warn('[samRacket] decode failed:', e);
        setRacketNote('Object select failed on this frame.');
      } finally {
        setRacketBusy(false);
      }
    },
    [racketKey],
  );

  /** A click ADDS to the prompt — it never restarts it. */
  const racketAddPoint = useCallback(
    (x: number, y: number, negative: boolean) => {
      const p: SamPoint = { x, y, label: negative ? 0 : 1 };
      const next = [...racketPoints, p];
      setRacketPoints(next);
      setRacketRedo([]); // a new click forks the history, as everywhere else
      void racketDecode(next);
    },
    [racketPoints, racketDecode],
  );

  const racketUndo = useCallback(() => {
    if (!racketPoints.length) return;
    const next = racketPoints.slice(0, -1);
    setRacketRedo((r) => [...r, racketPoints[racketPoints.length - 1]]);
    setRacketPoints(next);
    void racketDecode(next);
  }, [racketPoints, racketDecode]);

  const racketRedoStep = useCallback(() => {
    if (!racketRedo.length) return;
    const p = racketRedo[racketRedo.length - 1];
    const next = [...racketPoints, p];
    setRacketRedo((r) => r.slice(0, -1));
    setRacketPoints(next);
    void racketDecode(next);
  }, [racketPoints, racketRedo, racketDecode]);

  const racketClear = useCallback(() => {
    setRacketPoints([]);
    setRacketRedo([]);
    setRacketMask(null);
    setRacketCands(null);
    setRacketChosen(null);
    setRacketNote(null);
  }, []);

  /**
   * Commit the racket into the frame mask.
   *
   * UNION with max(), the same contract as the bone-core union and
   * proposeFrameMask's step 2c: where the person cutout already has alpha, its
   * own better-fitting value wins; the racket only fills what was missing. This
   * is STRICTLY ADDITIVE and can never lower a cutout pixel, so applying a
   * racket cannot damage the athlete. The soft alpha SAM produced on blurred
   * edges survives on both sides.
   *
   * Afterwards the racket is just pixels in the mask — the existing add/remove
   * brush finishes the details, exactly as Vin specified.
   */
  const racketApply = useCallback(() => {
    if (!racketMask) return;
    void (async () => {
      const { unionRacketIntoMask } = await import('@/lib/stroMotionDraft/samRacket');
      pushUndo(cloneAlphaMask(maskRef.current));
      const merged = unionRacketIntoMask(maskRef.current, racketMask);
      maskRef.current = merged;
      onMaskChange(merged);
      racketClear();
      setRacketNote('Object added — brush to finish the details.');
    })();
  }, [racketMask, pushUndo, onMaskChange, racketClear]);

  // TEMP-DEBUG-FITREADOUT — one-line, on-screen answer to "is the frame squished?".
  // Reports the edit canvas's INTRINSIC vs DISPLAYED rect and both aspects, live,
  // re-measured on every resize. If displayed aspect tracks intrinsic (1.778) the
  // frame is NOT distorted and any perceived squish is outside this canvas.
  // Purely diagnostic — nothing reads it. Remove with the grep tag.
  const [fitReadout, setFitReadout] = useState('measuring…');
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const intrinsic = canvas.width / canvas.height;
      const displayed = r.width / r.height;
      const distorted = Math.abs(displayed - intrinsic) > 0.02;
      // Does the CAPTURED frame agree with the video's own display size? A
      // disagreement here is the squish that no amount of CSS can explain: the
      // picture and the mask would be sized from two different sources.
      const nv = videoNativeSize;
      const sizeMismatch = !!nv && (nv.width !== canvas.width || nv.height !== canvas.height);
      const srcPart = nv
        ? `video ${nv.width}×${nv.height} (${(nv.width / nv.height).toFixed(3)}) · captured `
        : 'captured ';
      setFitReadout(
        `${srcPart}${canvas.width}×${canvas.height} (${intrinsic.toFixed(3)})` +
          `${sizeMismatch ? ' SIZE MISMATCH ✗' : ''} → shown ` +
          `${Math.round(r.width)}×${Math.round(r.height)} (${displayed.toFixed(3)}) · ` +
          `${distorted ? 'DISTORTED ✗' : 'aspect preserved ✓'}`,
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(canvas);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [sourceFrame, videoNativeSize]);

  // Cache source frame pixel data for flood-fill
  useEffect(() => {
    const w = sourceFrame.width;
    const h = sourceFrame.height;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) { sourcePixelsRef.current = null; return; }
    ctx.drawImage(sourceFrame, 0, 0);
    sourcePixelsRef.current = ctx.getImageData(0, 0, w, h).data;
  }, [sourceFrame]);

  // The editor opens at FIT — whole frame visible, zoom 1, pan (0,0), which is
  // simply the initial state of `zoom`/`pan` above.
  //
  // It used to auto-zoom to the selection box on mount so the subject filled ~65%
  // of the view. The maths was right but the behaviour was wrong: with the athlete
  // anywhere near a frame edge the resulting pan pushed the view off the frame —
  // measured at the real container size, a lower-left subject opened showing
  // x −20%..56%, y 32%..108%, i.e. the bottom-left corner with a fifth of the
  // window past the edge. The coach had to zoom out on every single frame.
  //
  // Zoom-to-subject is still one click away: the Focus button runs the same maths
  // on demand, and now it is the coach's choice rather than a forced starting
  // position.

  // Clamp pan so canvas is never entirely off-screen
  const clampPan = useCallback((nextPan: { x: number; y: number }, z: number) => {
    const container = containerRef.current;
    if (!container) return nextPan;
    // clientWidth/Height = PADDING box, which is what the canvas's `width: %` and
    // its top/left:0 origin actually resolve against. getBoundingClientRect()
    // would hand back the border box and put the container's 2px border into
    // every bound.
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const canvasDisplayW = z * cw;
    const canvasDisplayH = canvasDisplayW * (sourceFrame.height / sourceFrame.width);
    const margin = 60; // px — always keep at least this many pixels visible
    return {
      x: Math.min(cw - margin, Math.max(margin - canvasDisplayW, nextPan.x)),
      y: Math.min(ch - margin, Math.max(margin - canvasDisplayH, nextPan.y)),
    };
  }, [sourceFrame]);

  /**
   * THE view transform. Every zoom control — the +/− buttons, the reset button
   * and the scroll wheel — routes through this one function, so there is exactly
   * one place where zoom and pan are related to each other. Two independent
   * zoom paths is how the original "zooms to the top-left" bug happened: the
   * wheel changed `zoom` and left `pan` untouched.
   *
   * `focal` is a CONTAINER-relative CSS point that must stay visually stationary
   * across the zoom change. The wheel passes the cursor; the buttons pass nothing
   * and get the centre of the current view — exactly what the main canvas's +/−
   * buttons do (Canvas.tsx passes `cssW/2, cssH/2` into `applyZoomPanAt`).
   *
   * Zoom is derived from `prevZoom` inside the updater rather than from the
   * rendered `zoom`, so a fast scroll burst cannot drop steps on stale state.
   */
  const zoomBy = useCallback((deltaZoom: number, focalClient?: { x: number; y: number } | null) => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    // Read the CANVAS's own live box. This is deliberately the exact same source
    // `applyAtPoint` uses for the brush, so the point this zoom holds fixed and
    // the point the brush paints are the same point BY CONSTRUCTION rather than
    // by two formulas that have to be kept in agreement.
    //
    // Using the container's getBoundingClientRect() here instead is subtly wrong
    // and measurably so: that returns the BORDER box, but the canvas is laid out
    // against the PADDING box (`position:absolute; top/left:0`, `width:%`), which
    // the container's 2px border insets. That mismatch put a constant offset into
    // the focal maths — small, but it made zoom creep off the intended point.
    const canvasRect = canvas.getBoundingClientRect();
    if (canvasRect.width <= 0 || canvasRect.height <= 0) return;

    // Default focal = centre of the visible box, which is what the main canvas's
    // +/- buttons use (Canvas.tsx passes cssW/2, cssH/2 to applyZoomPanAt).
    // clientLeft/clientTop ARE the border widths, so this is the true centre of
    // the padding box — the visible frame — not of the border box.
    const containerRect = container.getBoundingClientRect();
    const fx = focalClient
      ? focalClient.x
      : containerRect.left + container.clientLeft + container.clientWidth / 2;
    const fy = focalClient
      ? focalClient.y
      : containerRect.top + container.clientTop + container.clientHeight / 2;

    setZoom((prevZoom) => {
      const nextZoom = Math.min(MASK_ZOOM_MAX, Math.max(MASK_ZOOM_MIN, prevZoom + deltaZoom));
      if (Math.abs(nextZoom - prevZoom) < 0.0001) return prevZoom;

      setPan((prevPan) => {
        // 1× IS "fit" — drop any accumulated offset instead of leaving the frame
        // parked off-centre with nowhere to pan back to.
        if (nextZoom <= MASK_ZOOM_MIN) return { x: 0, y: 0 };

        // The canvas pixel currently under the focal point — the brush's formula.
        const canvasX = (fx - canvasRect.left) * (canvas.width / canvasRect.width);
        const canvasY = (fy - canvasRect.top) * (canvas.height / canvasRect.height);

        // The padding-box origin, recovered from the canvas's own position rather
        // than from border widths: the canvas sits at origin + pan, so
        // origin = canvasRect.left - pan.
        const originX = canvasRect.left - prevPan.x;
        const originY = canvasRect.top - prevPan.y;

        // Display scale after the change. `width: zoom*100%` resolves against the
        // padding box, so clientWidth — not the border-box width — is the base.
        const nextScale = (nextZoom * container.clientWidth) / canvas.width;

        return clampPan(
          { x: fx - originX - canvasX * nextScale, y: fy - originY - canvasY * nextScale },
          nextZoom,
        );
      });

      return nextZoom;
    });
  }, [clampPan]);

  /**
   * Shift the view by a fraction of the visible box. Pure translation — zoom is
   * untouched, and `clampPan` still guarantees the frame cannot be pushed fully
   * off-screen. A positive dx moves the canvas right, which reveals content on
   * the LEFT, so the ← button passes a positive dx.
   */
  const panByFraction = useCallback((dxFraction: number, dyFraction: number) => {
    const container = containerRef.current;
    if (!container) return;
    // Padding box, for the same reason as clampPan.
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    setPan((prevPan) => clampPan(
      { x: prevPan.x + cw * dxFraction, y: prevPan.y + ch * dyFraction },
      zoom,
    ));
  }, [clampPan, zoom]);

  /** Back to fit: 1×, centred. Mirrors the main canvas's ⌂ reset button. */
  const resetView = useCallback(() => {
    setZoom(MASK_ZOOM_MIN);
    setPan({ x: 0, y: 0 });
  }, []);

  // Track whether we've already pushed an undo snapshot for the current stroke
  const strokeUndoPushedRef = useRef(false);

  const applyAtPoint = useCallback(
    (clientX: number, clientY: number, isFirstInStroke = false) => {
      dbg(
        `[TEMP-DEBUG-BAIL] applyAtPoint entered, brushMode=${brushMode} isFirstInStroke=${isFirstInStroke} hasCanvasRef=${!!canvasRef.current}`,
      );
      const canvas = canvasRef.current;
      if (!canvas) {
        dbg('[TEMP-DEBUG-BAIL] guard canvas: canvasRef.current=null -> BAILING');
        return;
      }
      // A re-propose is about to replace the whole mask. The editor now stays
      // mounted while that runs (so the undo stack survives), which means the
      // brush is reachable during it — and any stroke made here would be silently
      // overwritten by the commit. Refuse the stroke rather than lose it.
      if (autoMatteBusy || isRegenerating) return;
      // The racket tool paints no pixels of its own — it prompts SAM, and its
      // result only reaches the mask through Apply. Nothing here may run for it.
      if (brushMode === 'racket') return;
      dbg('[TEMP-DEBUG-BAIL] guard canvas: present -> proceeding');
      const rect = canvas.getBoundingClientRect();
      // rect already accounts for CSS transform (zoom + pan), so this gives native canvas coords
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (clientX - rect.left) * scaleX;
      const y = (clientY - rect.top) * scaleY;
      const inBounds = x >= 0 && y >= 0 && x <= canvas.width && y <= canvas.height;
      dbg(
        `[TEMP-DEBUG-BAIL] coords: client=(${Math.round(clientX)},${Math.round(clientY)}) rect=(${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)}x${Math.round(rect.height)}) ` +
          `-> canvas=(${Math.round(x)},${Math.round(y)}) of ${canvas.width}x${canvas.height} inBounds=${inBounds} scaleX=${scaleX.toFixed(3)} scaleY=${scaleY.toFixed(3)}`,
      );

      const maskPresent = !!maskRef.current && !!maskRef.current.data;
      dbg(
        `[TEMP-DEBUG-BAIL] mask check: maskPresent=${maskPresent} maskDataLen=${maskRef.current?.data?.length ?? 'n/a'} maskWH=${maskRef.current?.width}x${maskRef.current?.height}`,
      );

      // Push undo snapshot once per stroke (not per pixel)
      if (isFirstInStroke && !strokeUndoPushedRef.current) {
        dbg('[TEMP-DEBUG-BAIL] undo snapshot: pushing (first-in-stroke, not yet pushed)');
        pushUndo({ ...maskRef.current, data: new Uint8ClampedArray(maskRef.current.data) });
        strokeUndoPushedRef.current = true;
      } else {
        dbg(
          `[TEMP-DEBUG-BAIL] undo snapshot: skipped isFirstInStroke=${isFirstInStroke} alreadyPushed=${strokeUndoPushedRef.current}`,
        );
      }

      let next: AlphaMask;
      if (brushMode === 'flood-remove' && sourcePixelsRef.current) {
        dbg('[TEMP-DEBUG-BAIL] mode branch: flood-remove -> proceeding');
        next = floodRemoveInMask(maskRef.current, sourcePixelsRef.current, canvas.width, x, y);
      } else if (brushMode === 'add' || brushMode === 'remove') {
        dbg(`[TEMP-DEBUG-BAIL] mode branch: ${brushMode} -> proceeding to applyBrushToMask`);
        next = applyBrushToMask(maskRef.current, x, y, brushSize * scaleX, brushMode);
        dbg(
          `[TEMP-DEBUG-BAIL] applyBrushToMask returned: sameRef=${next === maskRef.current} dataLen=${next?.data?.length}`,
        );
      } else {
        // TEMP-DEBUG-PAINT — the one silent no-op in this function: flood mode
        // with no cached source pixels (getImageData failed / tainted canvas).
        console.warn(
          `[TEMP-DEBUG-PAINT] applyAtPoint NO-OP mode=${brushMode} sourcePixels=${!!sourcePixelsRef.current}`,
        );
        dbg(
          `[TEMP-DEBUG-BAIL] guard mode-dispatch: brushMode=${brushMode} sourcePixelsPresent=${!!sourcePixelsRef.current} -> BAILING (fell through all branches)`,
        );
        return;
      }

      // TEMP-DEBUG-PAINT — first point of each stroke only (the O(w*h) count is
      // too expensive per pointermove). Remove this block with the grep tag.
      if (isFirstInStroke) {
        let before = 0;
        let after = 0;
        for (let i = 0; i < next.data.length; i++) {
          if (maskRef.current.data[i] > 0) before++;
          if (next.data[i] > 0) after++;
        }
        dbg(
          `[TEMP-DEBUG-PAINT] applyAtPoint mode=${brushMode} client=(${Math.round(clientX)},${Math.round(clientY)}) ` +
            `→ canvas=(${Math.round(x)},${Math.round(y)}) of ${canvas.width}x${canvas.height} | ` +
            `rect=${Math.round(rect.width)}x${Math.round(rect.height)} scaleX=${scaleX.toFixed(3)} ` +
            `brushPx=${(brushSize * scaleX).toFixed(1)} | maskPx ${before}→${after} (delta ${after - before})`,
        );
      }

      dbg('[TEMP-DEBUG-BAIL] reached end: calling maskRef.current=next then onMaskChange(next)');
      maskRef.current = next;
      onMaskChange(next);
      dbg('[TEMP-DEBUG-BAIL] onMaskChange(next) call returned (onMaskChange is synchronous dispatch)');
    },
    [brushMode, brushSize, onMaskChange, pushUndo, zoom, autoMatteBusy, isRegenerating],
  );

  // Auto BG IS auto-detect, for this one frame: it re-runs the very same
  // skeleton-guided pipeline (MediaPipe on the full frame ∩ the thickened-skeleton
  // zone) that the batch AI-detect runs, via the same call path — so the two
  // cannot drift apart or produce different results. It used to run its own
  // border-flood colour matte over the whole frame, which is why it behaved
  // nothing like AI-detect.
  //
  // "Redo mask" is the same handler. It is the coach's backstop for a single bad
  // frame: because the whole path shares one skeleton resolver, the redo poses THIS
  // frame's own bitmap and rebuilds the zone from it. Both entry points snapshot
  // for undo first, so a redo that lands worse is one Ctrl+Z away. (They are
  // currently the same action under two labels — collapsing them is a button-map
  // decision, not one to make quietly here.)
  const handleAutoRemoveBackground = useCallback(async () => {
    setAutoMatteBusy(true);
    setRegenNotice(null);
    try {
      // Snapshot for undo BEFORE the pipeline replaces the mask (Ctrl+Z recovers).
      pushUndo(cloneAlphaMask(maskRef.current));
      const ok = await onRegenerate();
      if (ok === false) {
        setRegenNotice('The AI came back with almost nothing on this frame — your mask was kept. Try Select Area, or brush it by hand.');
      }
    } finally {
      setAutoMatteBusy(false);
    }
  }, [onRegenerate, pushUndo]);

  // Auto-clear the notice so it reads as transient feedback, not a stuck error.
  useEffect(() => {
    if (!regenNotice) return;
    const id = window.setTimeout(() => setRegenNotice(null), 7000);
    return () => window.clearTimeout(id);
  }, [regenNotice]);

  // TEMP-DEBUG-REDRAW — instrumentation state for the overlay effect below.
  // Purely diagnostic; remove this block and the log inside the effect with the
  // grep tag. Does not participate in any render or draw decision.
  const redrawCountRef = useRef(0);
  const lastMaskIdentityRef = useRef<AlphaMask | null>(null);
  const lastChecksumRef = useRef<number | null>(null);

  // Draw mask overlay on the edit canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = sourceFrame.width;
    const h = sourceFrame.height;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(sourceFrame, 0, 0, w, h);

    // Cyan mask overlay
    const overlay = ctx.getImageData(0, 0, w, h);
    const px = overlay.data;
    for (let i = 0; i < w * h; i++) {
      const a = mask.data[i];
      if (a <= 0) continue;
      px[i * 4]     = Math.round(px[i * 4]     * 0.55 + 0   * 0.45);
      px[i * 4 + 1] = Math.round(px[i * 4 + 1] * 0.55 + 180 * 0.45);
      px[i * 4 + 2] = Math.round(px[i * 4 + 2] * 0.55 + 255 * 0.45);
      px[i * 4 + 3] = Math.max(px[i * 4 + 3], Math.round((a / 255) * 200));
    }
    // RACKET PREVIEW — AMBER, deliberately not the cyan of the committed mask,
    // so the coach can see at a glance what is about to be added versus what is
    // already there. Drawn into the same ImageData pass so it composites with
    // the cyan rather than sitting on top of it as a flat layer.
    if (racketMask && racketMask.width === w && racketMask.height === h) {
      const rp = racketMask.data;
      for (let i = 0; i < w * h; i++) {
        const a = rp[i];
        if (a <= 0) continue;
        const f = (a / 255) * 0.6;
        px[i * 4]     = Math.round(px[i * 4]     * (1 - f) + 255 * f);
        px[i * 4 + 1] = Math.round(px[i * 4 + 1] * (1 - f) + 170 * f);
        px[i * 4 + 2] = Math.round(px[i * 4 + 2] * (1 - f) + 20  * f);
        px[i * 4 + 3] = Math.max(px[i * 4 + 3], Math.round((a / 255) * 210));
      }
    }
    ctx.putImageData(overlay, 0, 0);

    // Prompt points, drawn AFTER putImageData so they sit crisply on top:
    // white = "this IS racket", red = "this is NOT". Seeing the accumulated
    // points is what makes the build-up legible — and makes undo obvious.
    if (racketPoints.length) {
      const r = Math.max(3, w / 260);
      for (const p of racketPoints) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = p.label === 1 ? '#ffffff' : '#ff4d4d';
        ctx.fill();
        ctx.lineWidth = Math.max(1, r * 0.4);
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.stroke();
      }
    }

    // TEMP-DEBUG-REDRAW — did this effect re-run, did the MASK actually differ,
    // and did the resulting PIXELS actually differ? Answers "paint works but
    // screen never redraws" definitively. Read AFTER putImageData so the
    // checksum reflects exactly what was committed to the visible canvas.
    redrawCountRef.current += 1;
    let maskPx = 0;
    for (let i = 0; i < w * h; i++) if (mask.data[i] > 0) maskPx++;
    let checksum = 0;
    for (let i = 0; i < px.length; i += 997) checksum = (checksum + px[i] * (i % 251 + 1)) % 2147483647;
    const sameMaskObject = lastMaskIdentityRef.current === mask;
    const prevChecksum = lastChecksumRef.current;
    dbg(
      `[TEMP-DEBUG-REDRAW] overlay effect run #${redrawCountRef.current} canvas=${w}x${h} ` +
        `isVisibleEditCanvas=${canvas === canvasRef.current} maskPx=${maskPx} of ${w * h} ` +
        `sameMaskObjectAsLastRun=${sameMaskObject} checksum=${checksum} ` +
        `prevChecksum=${prevChecksum === null ? 'none' : prevChecksum} ` +
        `pixelsChanged=${prevChecksum === null ? 'n/a' : checksum !== prevChecksum}`,
    );
    lastMaskIdentityRef.current = mask;
    lastChecksumRef.current = checksum;

  }, [sourceFrame, mask, racketMask, racketPoints]);

  // Draw composite preview (background + masked object)
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !showCompositePreview) return;
    const w = sourceFrame.width;
    const h = sourceFrame.height;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, w, h);
    if (backgroundPlate) {
      ctx.drawImage(backgroundPlate, 0, 0, w, h);
    } else {
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, w, h);
    }

    const scratch = document.createElement('canvas');
    scratch.width = w;
    scratch.height = h;
    const sctx = scratch.getContext('2d');
    if (!sctx) return;
    sctx.drawImage(sourceFrame, 0, 0, w, h);
    const imageData = sctx.getImageData(0, 0, w, h);
    const pxd = imageData.data;
    for (let i = 0; i < w * h; i++) {
      pxd[i * 4 + 3] = Math.round((pxd[i * 4 + 3] * mask.data[i]) / 255);
    }
    sctx.putImageData(imageData, 0, 0);
    ctx.drawImage(scratch, 0, 0, w, h);
  }, [backgroundPlate, mask, showCompositePreview, sourceFrame]);

  // Keyboard shortcuts: Ctrl+Z = undo, Ctrl+Shift+Z or Ctrl+Y = redo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); handleRedo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleUndo, handleRedo]);

  const framePosLabel =
    frameIndex !== undefined && frameTotal !== undefined
      ? ` (${frameIndex + 1}/${frameTotal})`
      : '';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10050,
        background: 'rgba(0,0,0,0.78)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: isMobile ? 8 : 16,
      }}
    >
      <div
        style={{
          width: 'min(1180px, 100%)',
          maxHeight: '94vh',
          overflow: 'auto',
          // Lifted from #1c1c1e so the frame's pure-black surface separates from
          // the panel behind it. Near-identical darks were a large part of why the
          // frame's edge read as "more panel" instead of "edge of the picture".
          background: '#2a2a2e',
          borderRadius: 14,
          border: '1px solid rgba(255,255,255,0.12)',
          padding: isMobile ? 12 : 16,
          color: '#fff',
        }}
      >
        {/* TEMP-DEBUG-PHASE-MARKER — the VISIBLE magenta build stamp is gone: it
            cost ~62px of vertical space directly above the frame and competed with
            the image for visual dominance, which is the exact problem this change
            addresses. Its build-freshness job is done (the bundle has been
            confirmed current repeatedly) and its console probes are still in place
            at module-eval and render, so nothing diagnostic was lost. */}

        {/* TEMP-DEBUG-FITREADOUT — remove with the grep tag. */}
        <div
          data-fit-readout={fitReadout}
          style={{
            // Kept per instruction, but made subordinate to the frame: a compact
            // status strip rather than a full-width shout. Turns loud red only if
            // it ever reports DISTORTED, which is when it should grab the eye.
            background: fitReadout.includes('✗') ? '#FF3B30' : 'rgba(52,199,89,0.14)',
            color: fitReadout.includes('✗') ? '#000' : '#34C759',
            border: '1px solid rgba(52,199,89,0.35)',
            fontWeight: 600,
            fontSize: 10,
            textAlign: 'center',
            padding: '3px 8px',
            borderRadius: 6,
            marginBottom: 8,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {fitReadout}
        </div>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 16 }}>Refine background removal — {frameLabel}{framePosLabel}</strong>
            {frameStatus === 'ready' ? (
              <span style={{ marginLeft: 8, fontSize: 11, color: '#34C759', fontWeight: 700 }}>Ready</span>
            ) : null}
            <p style={{ margin: '6px 0 0', fontSize: 12, lineHeight: 1.45, color: 'rgba(255,255,255,0.65)' }}>
              Cyan overlay = kept pixels. Yellow dashed border = your selection box.
              Add brush keeps subject; Remove brush or Flood remove cuts leftover background.
            </p>
            {proposalEmpty ? (
              <p style={{ margin: '8px 0 0', fontSize: 12, color: '#FF9500', fontWeight: 600 }}>
                AI proposal was empty — tap Auto remove background or paint with Add brush.
              </p>
            ) : null}
          </div>
          <button type="button" onClick={onClose} style={{ ...toolBtn, flexShrink: 0 }}>Close</button>
        </div>

        {/* Toolbar — row 1: brush modes + size + undo/redo */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
          <button
            type="button"
            style={{ ...toolBtn, ...(brushMode === 'add' ? activeTool : {}) }}
            onClick={() => setBrushMode('add')}
            title="Add brush — paint to keep pixels"
          >
            <Brush size={13} style={{ marginRight: 5, verticalAlign: -2 }} />Add
          </button>
          <button
            type="button"
            style={{ ...toolBtn, ...(brushMode === 'remove' ? activeTool : {}) }}
            onClick={() => setBrushMode('remove')}
            title="Remove brush — paint to erase pixels"
          >
            <Eraser size={13} style={{ marginRight: 5, verticalAlign: -2 }} />Remove
          </button>
          <button
            type="button"
            style={{ ...toolBtn, ...(brushMode === 'flood-remove' ? activeTool : {}) }}
            onClick={() => setBrushMode('flood-remove')}
            title="Flood cut — click a colour region to erase connected area"
          >
            <Droplets size={13} style={{ marginRight: 5, verticalAlign: -2 }} />Flood
          </button>
          {racketKey ? (
            <button
              type="button"
              style={{ ...toolBtn, ...(brushMode === 'racket' ? activeTool : {}) }}
              onClick={() => setBrushMode('racket')}
              title="Object select — click on the racket, bat or implement to add it; click again to grow it"
            >
              <Target size={13} style={{ marginRight: 5, verticalAlign: -2 }} />Object
            </button>
          ) : null}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginLeft: 4 }} title="Brush size in canvas pixels">
            <Crosshair size={12} />
            <input
              type="range"
              min={4}
              max={96}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              disabled={brushMode === 'flood-remove'}
              style={{ width: 80 }}
            />
            <span style={{ minWidth: 22, textAlign: 'right' }}>{brushSize}</span>
          </label>
          <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.15)', margin: '0 2px' }} />
          <button
            type="button"
            style={toolBtn}
            onClick={handleUndo}
            disabled={undoCount === 0}
            title="Undo last brush stroke (Ctrl+Z)"
          >
            <Undo2 size={13} style={{ marginRight: 4, verticalAlign: -2 }} />Undo
          </button>
          <button
            type="button"
            style={toolBtn}
            onClick={handleRedo}
            disabled={redoCount === 0}
            title="Redo (Ctrl+Shift+Z)"
          >
            <Redo2 size={13} style={{ marginRight: 4, verticalAlign: -2 }} />Redo
          </button>
          <span style={{ flex: 1 }} />
          {onMarkReadyAndNext && frameStatus !== 'ready' ? (
            <button
              type="button"
              style={{ ...toolBtn, border: '1px solid #34C759', background: 'rgba(52,199,89,0.22)', fontWeight: 700 }}
              onClick={onMarkReadyAndNext}
              title="Mark ready and open next frame"
            >
              <Check size={13} style={{ marginRight: 4, verticalAlign: -2 }} />Ready &amp; Next
              <ChevronRight size={13} style={{ marginLeft: 2, verticalAlign: -2 }} />
            </button>
          ) : null}
          {onMarkReady && frameStatus !== 'ready' ? (
            <button
              type="button"
              style={{ ...toolBtn, border: '1px solid #34C759', background: 'rgba(52,199,89,0.15)', fontWeight: 700 }}
              onClick={onMarkReady}
              title="Mark this frame ready for export"
            >
              <Check size={13} style={{ marginRight: 4, verticalAlign: -2 }} />Mark Ready
            </button>
          ) : null}
        </div>
        {/* Toolbar — RACKET row. Only while the racket tool is selected, so it
            costs nothing visually in the normal brush workflow. */}
        {brushMode === 'racket' ? (
          <div
            style={{
              display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6,
              padding: '6px 8px', borderRadius: 6,
              border: '1px solid rgba(255,170,20,0.35)', background: 'rgba(255,170,20,0.08)',
            }}
          >
            {/* The instruction is part of the feature, not decoration: this is a
                guided workflow, and the coach has to be told that clicks
                ACCUMULATE or they will click once and judge it broken. */}
            <span style={{ fontSize: 12, opacity: 0.9 }}>
              {racketPreparing
                ? 'Preparing the racket tool for this frame — one-off, a few seconds…'
                : !racketReady
                ? 'Object select not ready for this frame.'
                : racketBusy
                  ? 'Segmenting…'
                  : racketPoints.length === 0
                    ? 'Click on the racket. Each extra click grows the mask.'
                    : `${racketPoints.filter((p) => p.label === 1).length} add · ${racketPoints.filter((p) => p.label === 0).length} remove — click again to grow, then Add to mask.`}
            </span>
            <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.15)' }} />
            <button
              type="button"
              style={{ ...toolBtn, ...(racketNegative ? activeTool : {}) }}
              onClick={() => setRacketNegative((v) => !v)}
              title="Remove mode — click a wrongly-grabbed area (court, body) to subtract it"
            >
              <Eraser size={13} style={{ marginRight: 4, verticalAlign: -2 }} />
              {racketNegative ? 'Removing' : 'Remove area'}
            </button>
            <button
              type="button"
              style={toolBtn}
              onClick={racketUndo}
              disabled={!racketPoints.length || racketBusy}
              title="Undo the last racket click"
            >
              <Undo2 size={13} style={{ marginRight: 4, verticalAlign: -2 }} />Undo click
              {racketPoints.length ? ` (${racketPoints.length})` : ''}
            </button>
            <button
              type="button"
              style={toolBtn}
              onClick={racketRedoStep}
              disabled={!racketRedo.length || racketBusy}
              title="Redo the last undone racket click"
            >
              <Redo2 size={13} style={{ marginRight: 4, verticalAlign: -2 }} />Redo
              {racketRedo.length ? ` (${racketRedo.length})` : ''}
            </button>
            <button
              type="button"
              style={toolBtn}
              onClick={racketClear}
              disabled={!racketPoints.length || racketBusy}
              title="Discard the racket in progress"
            >
              <RotateCcw size={13} style={{ marginRight: 4, verticalAlign: -2 }} />Clear
            </button>
            <button
              type="button"
              style={{ ...toolBtn, border: '1px solid #FFAA14', background: 'rgba(255,170,20,0.2)', fontWeight: 700 }}
              onClick={racketApply}
              disabled={!racketMask || racketBusy}
              title="Union the racket into this frame's mask"
            >
              <Check size={13} style={{ marginRight: 4, verticalAlign: -2 }} />Add to mask
            </button>
            {/* Candidate override. SAM returns three masks and its own score is
                NOT a racket-ness score — the probe measured the whole court
                scoring 0.944, the highest of the three. The plausibility gate
                picks by shape instead, and this row lets the coach overrule it
                when the gate and the eye disagree. */}
            {racketCands ? (
              <span style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: 4 }}>
                {racketCands.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => void racketDecode(racketPoints, i)}
                    disabled={racketBusy}
                    style={{
                      ...toolBtn,
                      padding: '2px 6px',
                      fontSize: 11,
                      opacity: c.vetoed ? 0.45 : 1,
                      ...(racketChosen === i ? activeTool : {}),
                    }}
                    title={c.vetoed ? `Rejected: ${c.vetoed}` : `Area ${c.areaPct.toFixed(2)}% of frame`}
                  >
                    {c.areaPct.toFixed(1)}%
                  </button>
                ))}
              </span>
            ) : null}
            {racketNote ? (
              <span style={{ fontSize: 12, color: '#FFD08A', width: '100%' }}>{racketNote}</span>
            ) : null}
          </div>
        ) : null}
        {/* Toolbar — row 2: secondary actions */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <button
            type="button"
            style={{ ...toolBtn, border: '1px solid #5856D6', background: 'rgba(88,86,214,0.22)' }}
            disabled={autoMatteBusy || isRegenerating}
            onClick={() => { void handleAutoRemoveBackground(); }}
            title={selectionBox
              ? 'Optional — let the AI refine the mask inside your selection box (Ctrl+Z to undo)'
              : 'Optional — re-run AI background removal (Ctrl+Z to undo)'}
          >
            <Wand2 size={13} style={{ marginRight: 5, verticalAlign: -2 }} />
            {autoMatteBusy ? 'Working…' : 'Auto BG'}
          </button>
          <button type="button" style={toolBtn} onClick={onReset} title="Reset mask to the AI proposal">
            <RotateCcw size={13} style={{ marginRight: 5, verticalAlign: -2 }} />Reset
          </button>
          <button
            type="button"
            style={toolBtn}
            disabled={autoMatteBusy || isRegenerating}
            onClick={() => { void handleAutoRemoveBackground(); }}
            title="Rebuild this frame's mask from scratch — re-detects the skeleton on THIS exact frame, re-runs segmentation and the intersection (Ctrl+Z to undo)"
          >
            <RefreshCw size={13} style={{ marginRight: 5, verticalAlign: -2 }} />
            {isRegenerating ? 'Working…' : 'Redo mask'}
          </button>
          {selectionBox ? (
            <button
              type="button"
              style={{ ...toolBtn, border: '1px solid #FFD60A', background: 'rgba(255,214,10,0.1)' }}
              title="Zoom canvas to centre on your selection box"
              onClick={() => {
                if (!containerRef.current) return;
                const { width: cw, height: ch } = containerRef.current.getBoundingClientRect();
                const vw = sourceFrame.width;
                const vh = sourceFrame.height;
                const targetFillW = 0.65 / selectionBox.width;
                const targetFillH = (0.65 * ch * vw) / (selectionBox.height * vh * cw);
                const z = Math.min(Math.max(Math.min(targetFillW, targetFillH), 1), 4);
                const boxCx = (selectionBox.x + selectionBox.width / 2) * vw;
                const boxCy = (selectionBox.y + selectionBox.height / 2) * vh;
                const scale = z * cw / vw;
                const px = cw / 2 - boxCx * scale;
                const py = ch / 2 - boxCy * scale;
                setZoom(z);
                setPan(clampPan({ x: px, y: py }, z));
              }}
            >
              <Maximize2 size={13} style={{ marginRight: 5, verticalAlign: -2 }} />Focus
            </button>
          ) : null}
          <button
            type="button"
            style={{ ...toolBtn, ...(showCompositePreview ? activeTool : {}) }}
            onClick={() => setShowCompositePreview((v) => !v)}
            title="Toggle side-by-side composite preview"
          >
            {showCompositePreview
              ? <><EyeOff size={13} style={{ marginRight: 5, verticalAlign: -2 }} />Hide preview</>
              : <><Eye size={13} style={{ marginRight: 5, verticalAlign: -2 }} />Preview</>}
          </button>
          {!backgroundPlate ? (
            <span style={{ fontSize: 11, color: '#FF9500', marginLeft: 4 }}>
              ⚠ No background — set Start frame first
            </span>
          ) : null}
        </div>

        {regenNotice ? (
          <div
            style={{
              marginBottom: 10,
              padding: '7px 10px',
              borderRadius: 8,
              border: '1px solid rgba(255,149,0,0.5)',
              background: 'rgba(255,149,0,0.12)',
              color: '#FFB340',
              fontSize: 12,
              lineHeight: 1.4,
            }}
          >
            {regenNotice}
          </div>
        ) : null}

        {/* Canvas area */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: showCompositePreview ? '1fr 1fr' : '1fr',
            gap: 12,
          }}
        >
          {/* Edit canvas */}
          <div
            ref={containerRef}
            style={{
              overflow: 'hidden',
              borderRadius: 8,
              // The frame's EDGE must be unmistakable. This box is already exactly
              // the video's aspect and the canvas fills it edge-to-edge, so there
              // is no dead space inside it — but at 1px/0.15-alpha the boundary was
              // nearly invisible against the panel (#1c1c1e vs the frame's #000,
              // both dark). With no visible edge the eye takes the WHOLE panel —
              // toolbars and all — to be the picture, and a 16:9 image read as a
              // ~1.1 box looks vertically squashed. Nothing was ever distorted;
              // the boundary just wasn't legible. A bright 2px edge plus a lifting
              // shadow makes the image read as an image.
              border: '2px solid rgba(255,255,255,0.55)',
              boxShadow: '0 0 0 1px rgba(0,0,0,0.65), 0 10px 28px rgba(0,0,0,0.5)',
              maxHeight: 'min(72vh, 720px)',
              // Canvas below is position:absolute (out of flow) so its zoomed +
              // transformed size can never inflate this box or the panel's
              // scrollable overflow — aspectRatio gives this container its own
              // definite height instead of inheriting it from canvas's flow size.
              aspectRatio: `${sourceFrame.width} / ${sourceFrame.height}`,
              touchAction: 'none',
              // Matches the canvas above it. Racket included: the drawn reticle
              // is the only marker, so no native cursor anywhere in this box.
              cursor: brushMode === 'flood-remove' ? 'cell' : 'none',
              background: '#000',
              position: 'relative',
            }}
            onMouseMove={(e) => {
              const rect = containerRef.current?.getBoundingClientRect();
              if (!rect) return;
              setCursorPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
            }}
            onMouseLeave={() => setCursorPos(null)}
            onPointerDown={(e) => {
              // Middle-click or Alt+left-click to pan
              if (e.button === 1 || (e.button === 0 && e.altKey && zoom > 1)) {
                panningRef.current = true;
                panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
                (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
              }
            }}
            onPointerMove={(e) => {
              if (!panningRef.current) return;
              const next = {
                x: panStartRef.current.panX + (e.clientX - panStartRef.current.x),
                y: panStartRef.current.panY + (e.clientY - panStartRef.current.y),
              };
              setPan(clampPan(next, zoom));
            }}
            onPointerUp={() => { panningRef.current = false; }}
            onWheel={(e) => {
              e.preventDefault();
              // Wheel keeps the point under the CURSOR fixed; the buttons keep the
              // view centre fixed. Same helper, different focal point. Client
              // coords, matching the brush's own frame of reference.
              zoomBy(e.deltaY > 0 ? -ZOOM_WHEEL_STEP : ZOOM_WHEEL_STEP, {
                x: e.clientX,
                y: e.clientY,
              });
            }}
          >
            <canvas
              ref={canvasRef}
              // Stable identity for live measurement. `querySelectorAll('canvas')[0]`
              // is index-ordered, and the analysis viewport (Canvas.tsx) mounts
              // BEFORE this modal — so index 0 is that viewport, never this one.
              // Measure via [data-canvas-role="mask-edit"] instead of an index.
              data-canvas-role="mask-edit"
              style={{
                // Out of flow: at zoom > 1 this renders up to 400% of the
                // container's width. In-flow + transform is the classic cross-
                // browser case where overflow:hidden clips paint but not the
                // scrollable-overflow rect. position:absolute removes it from
                // flow entirely, so it can never affect any ancestor's box.
                position: 'absolute',
                top: 0,
                left: 0,
                width: `${zoom * 100}%`,
                height: 'auto',
                transform: `translate(${pan.x}px, ${pan.y}px)`,
                transformOrigin: '0 0',
                touchAction: 'none',
                // This canvas is position:absolute over the whole container, so
                // IT is the element under the pointer and its cursor wins — the
                // container's never applies.
                //
                // 'none' in Racket mode is deliberate: the drawn reticle IS the
                // cursor. Showing a native crosshair as well gave two markers,
                // and since the drawn one trailed the native one, they visibly
                // chased each other. Exactly one marker, drawn, mode-coloured.
                cursor: brushMode === 'flood-remove' ? 'cell' : 'none',
                display: 'block',
              }}
              onPointerDown={(e) => {
                // TEMP-DEBUG-PAINT — proves whether React's handler on THIS canvas
                // receives the stroke at all, independent of whether painting works.
                dbg(
                  `[TEMP-DEBUG-PAINT] canvas pointerdown target=<${(e.target as HTMLElement).tagName.toLowerCase()}> ` +
                    `isEditCanvas=${e.target === canvasRef.current} button=${e.button} alt=${e.altKey} zoom=${zoom}`,
                );
                dbg(
                  `[TEMP-DEBUG-BAIL] onPointerDown entered, brushMode=${brushMode} button=${e.button} altKey=${e.altKey} zoom=${zoom} pointerId=${e.pointerId} pointerType=${e.pointerType}`,
                );
                if (e.altKey && zoom > 1) {
                  dbg(`[TEMP-DEBUG-BAIL] guard altKey-pan: altKey=${e.altKey} zoom=${zoom} (zoom>1) -> BAILING`);
                  return;
                }
                // RACKET is a click tool: one point per press, no stroke, no
                // pointer capture. Handled before the brush so none of the
                // stroke machinery below ever sees it.
                if (brushMode === 'racket') {
                  const rc = canvasRef.current;
                  if (!rc || racketBusy || racketPreparing || !racketReady) return;
                  const rr = rc.getBoundingClientRect();
                  const rx = (e.clientX - rr.left) * (rc.width / rr.width);
                  const ry = (e.clientY - rr.top) * (rc.height / rr.height);
                  if (rx < 0 || ry < 0 || rx > rc.width || ry > rc.height) return;
                  // Alt is the pan modifier once zoomed, so it can only double as
                  // "negative" at zoom 1. The toggle works at any zoom and is the
                  // path the UI actually advertises.
                  racketAddPoint(rx, ry, racketNegative || e.altKey);
                  return;
                }
                dbg(`[TEMP-DEBUG-BAIL] guard altKey-pan: altKey=${e.altKey} zoom=${zoom} -> proceeding`);
                paintingRef.current = true;
                strokeUndoPushedRef.current = false;
                (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
                dbg('[TEMP-DEBUG-BAIL] onPointerDown: paintingRef=true, calling applyAtPoint(isFirstInStroke=true)');
                applyAtPoint(e.clientX, e.clientY, true);
              }}
              onPointerMove={(e) => {
                // RACKET RETICLE — tracked in CANVAS PIXELS through the exact
                // same rect maths the click uses, so "where I see it" and "where
                // it lands" are the same number by construction, not by two
                // transforms that ought to agree. Runs before the painting guard
                // because the racket tool never paints.
                if (brushMode === 'racket') {
                  const rc = canvasRef.current;
                  if (rc) {
                    const rr = rc.getBoundingClientRect();
                    // Ref + direct paint. No setState, so no React render sits
                    // between the pointer and the reticle.
                    racketCursorPosRef.current = {
                      x: (e.clientX - rr.left) * (rc.width / rr.width),
                      y: (e.clientY - rr.top) * (rc.height / rr.height),
                    };
                    drawRacketReticle();
                  }
                  return;
                }
                if (!paintingRef.current || brushMode === 'flood-remove') {
                  dbg(
                    `[TEMP-DEBUG-BAIL] onPointerMove guard: paintingRef=${paintingRef.current} brushMode=${brushMode} -> BAILING`,
                  );
                  return;
                }
                applyAtPoint(e.clientX, e.clientY, false);
              }}
              onPointerUp={() => {
                dbg('[TEMP-DEBUG-BAIL] onPointerUp: paintingRef=false, strokeUndoPushedRef=false');
                paintingRef.current = false; strokeUndoPushedRef.current = false;
              }}
              onPointerLeave={() => {
                dbg('[TEMP-DEBUG-BAIL] onPointerLeave: paintingRef=false, strokeUndoPushedRef=false');
                paintingRef.current = false; strokeUndoPushedRef.current = false;
                racketCursorPosRef.current = null;
                drawRacketReticle();
              }}
            />
            {/* RACKET RETICLE overlay.
                A SEPARATE canvas rather than a repaint of the edit canvas: the
                edit canvas redraw walks every pixel of a 1080×1920 frame plus
                both masks, which is far too heavy to run on pointermove. This one
                carries only the reticle and is cleared each move.
                It mirrors the edit canvas's intrinsic size AND its CSS
                width/transform exactly, so both share one coordinate system and
                zoom/pan move them together — the reticle cannot drift from the
                click point. pointerEvents:none keeps it out of the way. */}
            {brushMode === 'racket' ? (
              <canvas
                ref={racketCursorCanvasRef}
                width={sourceFrame.width}
                height={sourceFrame.height}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: `${zoom * 100}%`,
                  height: 'auto',
                  transform: `translate(${pan.x}px, ${pan.y}px)`,
                  transformOrigin: '0 0',
                  pointerEvents: 'none',
                  display: 'block',
                }}
              />
            ) : null}
            {/* Brush circle cursor */}
            {cursorPos && brushMode !== 'flood-remove' && brushMode !== 'racket' ? (
              <div
                style={{
                  position: 'absolute',
                  left: cursorPos.x - brushSize,
                  top: cursorPos.y - brushSize,
                  width: brushSize * 2,
                  height: brushSize * 2,
                  borderRadius: '50%',
                  border: `2px solid ${brushMode === 'add' ? 'rgba(0,210,255,0.9)' : 'rgba(255,80,80,0.9)'}`,
                  pointerEvents: 'none',
                  boxSizing: 'border-box',
                  boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
                }}
              />
            ) : null}
            {/* Zoom / pan cluster — same placement (bottom-right, over the image)
                and same button styling as the main canvas's controls, so it reads
                as the control the coach already uses. Directional buttons are the
                addition: the main canvas pans by drag only, which is exactly what
                the coach could not do comfortably here. */}
            <div
              style={{
                position: 'absolute',
                bottom: 8,
                right: 8,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                zIndex: 3,
                // The container paints a custom brush cursor and hides the real
                // one; restore a normal pointer over the controls.
                cursor: 'default',
              }}
              // The cluster sits INSIDE the painting surface. Without this, a
              // click that lands on a button would also reach the container and
              // could start a pan/paint gesture underneath it.
              onPointerDown={(e) => e.stopPropagation()}
              onPointerMove={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                style={viewCtrlBtn}
                title="Zoom in"
                aria-label="Zoom in"
                disabled={zoom >= MASK_ZOOM_MAX - 0.0001}
                onClick={() => zoomBy(ZOOM_BUTTON_STEP)}
              >
                <ZoomIn size={16} />
              </button>
              <button
                type="button"
                style={viewCtrlBtn}
                title="Zoom out"
                aria-label="Zoom out"
                disabled={zoom <= MASK_ZOOM_MIN + 0.0001}
                onClick={() => zoomBy(-ZOOM_BUTTON_STEP)}
              >
                <ZoomOut size={16} />
              </button>

              {/* Directional pan — only meaningful once zoomed in, so it appears
                  with the zoom rather than sitting permanently inert. */}
              {zoom > MASK_ZOOM_MIN + 0.0001 ? (
                <>
                  <button
                    type="button"
                    style={viewCtrlBtn}
                    title="Move view up"
                    aria-label="Move view up"
                    onClick={() => panByFraction(0, PAN_BUTTON_STEP)}
                  >
                    <ChevronUp size={16} />
                  </button>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      type="button"
                      style={viewCtrlBtn}
                      title="Move view left"
                      aria-label="Move view left"
                      onClick={() => panByFraction(PAN_BUTTON_STEP, 0)}
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      type="button"
                      style={viewCtrlBtn}
                      title="Move view right"
                      aria-label="Move view right"
                      onClick={() => panByFraction(-PAN_BUTTON_STEP, 0)}
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <button
                    type="button"
                    style={viewCtrlBtn}
                    title="Move view down"
                    aria-label="Move view down"
                    onClick={() => panByFraction(0, -PAN_BUTTON_STEP)}
                  >
                    <ChevronDown size={16} />
                  </button>
                  <button
                    type="button"
                    style={viewCtrlBtn}
                    title="Reset zoom & position"
                    aria-label="Reset zoom and position"
                    onClick={resetView}
                  >
                    <Home size={15} />
                  </button>
                </>
              ) : null}
            </div>

            {/* Zoom level readout */}
            {zoom > 1 ? (
              <div style={{
                position: 'absolute',
                bottom: 8,
                left: 8,
                fontSize: 10,
                color: 'rgba(255,255,255,0.55)',
                background: 'rgba(0,0,0,0.45)',
                padding: '2px 6px',
                borderRadius: 4,
                pointerEvents: 'none',
              }}>
                {Math.round(zoom * 100)}% · buttons, Alt+drag or scroll
              </div>
            ) : null}
          </div>

          {/* Composite preview */}
          {showCompositePreview ? (
            <div
              style={{
                overflow: 'hidden',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.15)',
                maxHeight: 'min(72vh, 720px)',
                background: '#000',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.55)', padding: '8px 10px 0' }}>
                Final composite preview
              </div>
              <canvas
                ref={previewCanvasRef}
                data-canvas-role="mask-preview"
                style={{ width: '100%', height: 'auto', display: 'block' }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Zoom/pan limits and steps.
 *
 * `ZOOM_BUTTON_STEP` deliberately matches Canvas.tsx's constant of the same name,
 * so a click of +/− here moves the view by the same amount it does on the main
 * canvas. The 1×–4× range is this editor's pre-existing range and is left alone —
 * changing it would alter the wheel behaviour that already works.
 */
const MASK_ZOOM_MIN = 1;
const MASK_ZOOM_MAX = 4;
const ZOOM_BUTTON_STEP = 0.2;
const ZOOM_WHEEL_STEP = 0.15;
/** One pan click travels a quarter of the visible box — enough to make progress, small enough to aim. */
const PAN_BUTTON_STEP = 0.25;

/**
 * Floating control button, matching the main canvas's `zoomControlBtnStyle`
 * (Canvas.tsx) — same size, radius, translucent dark fill and blur — so the
 * cluster reads as the same control the coach already knows.
 */
const viewCtrlBtn: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  border: 'none',
  background: 'rgba(0,0,0,0.55)',
  color: '#fff',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  WebkitTapHighlightColor: 'transparent',
  touchAction: 'manipulation',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  padding: 0,
};

const toolBtn: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.18)',
  background: 'rgba(255,255,255,0.06)',
  color: '#fff',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const activeTool: React.CSSProperties = {
  border: '1px solid #007AFF',
  background: 'rgba(0,122,255,0.2)',
};
