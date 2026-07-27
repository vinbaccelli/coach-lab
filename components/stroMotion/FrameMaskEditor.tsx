'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Brush,
  Check,
  ChevronRight,
  Crosshair,
  Droplets,
  Eraser,
  Eye,
  EyeOff,
  Maximize2,
  Redo2,
  RefreshCw,
  RotateCcw,
  Undo2,
  Wand2,
} from 'lucide-react';
import { buildMatteAlphaMask } from '@/lib/objectMultiplier';
import {
  applyBrushToMask,
  cloneAlphaMask,
  floodRemoveInMask,
  intersectMaskWithBox,
  type AlphaMask,
  type BrushMode,
} from '@/lib/stroMotionDraft';
import type { StroMotionSubjectBox } from '@/lib/stroMotion';

// TEMP-DEBUG-PHASE-MARKER — build-freshness probe ONLY. No editor logic depends
// on this. Fires once when this module is EVALUATED (i.e. when the lazy chunk is
// actually fetched and run by the browser), which is the question being asked:
// is the browser running THIS source, or a cached bundle? Remove with the grep
// tag once the pipeline question is settled.
const PHASE_MARKER = '106245';
console.log(`PHASE-MARKER-${PHASE_MARKER} [module-eval] FrameMaskEditor.tsx module evaluated`);

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
  onRegenerate: () => void;
  onMarkReady?: () => void;
  onMarkReadyAndNext?: () => void;
  onClose: () => void;
  isRegenerating?: boolean;
  /** Tightens backdrop/panel padding and lets the header's text column shrink at narrow viewports. */
  isMobile?: boolean;
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
}: FrameMaskEditorProps) {
  // TEMP-DEBUG-PHASE-MARKER — fires on every render of THIS component instance.
  // Together with the module-eval log above it separates "chunk never fetched"
  // from "chunk fetched but component never rendered". Remove with the grep tag.
  console.log(`PHASE-MARKER-${PHASE_MARKER} [render] FrameMaskEditor rendering`);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [brushMode, setBrushMode] = useState<BrushMode>('add');
  const [brushSize, setBrushSize] = useState(18);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showCompositePreview, setShowCompositePreview] = useState(false);
  const [autoMatteBusy, setAutoMatteBusy] = useState(false);
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

  // Auto-zoom to selection box on mount
  useLayoutEffect(() => {
    if (!selectionBox || !containerRef.current) return;
    const { width: cw, height: ch } = containerRef.current.getBoundingClientRect();
    if (cw <= 0 || ch <= 0) return;
    const vw = sourceFrame.width;
    const vh = sourceFrame.height;

    // Scale factor: canvas pixel → CSS pixel = zoom * cw / vw (same for both axes since height: auto)
    // We want the selection box to fill ~65% of the visible area
    const targetFillW = 0.65 / selectionBox.width;
    const targetFillH = (0.65 * ch * vw) / (selectionBox.height * vh * cw);
    const z = Math.min(Math.max(Math.min(targetFillW, targetFillH), 1), 4);

    // Center the selection box
    const boxCx = (selectionBox.x + selectionBox.width / 2) * vw;
    const boxCy = (selectionBox.y + selectionBox.height / 2) * vh;
    const scale = z * cw / vw;
    const px = cw / 2 - boxCx * scale;
    const py = ch / 2 - boxCy * scale;

    setZoom(z);
    setPan({ x: px, y: py });
  // Only run on mount — selectionBox and sourceFrame are stable references
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clamp pan so canvas is never entirely off-screen
  const clampPan = useCallback((nextPan: { x: number; y: number }, z: number) => {
    const container = containerRef.current;
    if (!container) return nextPan;
    const { width: cw, height: ch } = container.getBoundingClientRect();
    const canvasDisplayW = z * cw;
    const canvasDisplayH = canvasDisplayW * (sourceFrame.height / sourceFrame.width);
    const margin = 60; // px — always keep at least this many pixels visible
    return {
      x: Math.min(cw - margin, Math.max(margin - canvasDisplayW, nextPan.x)),
      y: Math.min(ch - margin, Math.max(margin - canvasDisplayH, nextPan.y)),
    };
  }, [sourceFrame]);

  // Track whether we've already pushed an undo snapshot for the current stroke
  const strokeUndoPushedRef = useRef(false);

  const applyAtPoint = useCallback(
    (clientX: number, clientY: number, isFirstInStroke = false) => {
      console.log(
        `[TEMP-DEBUG-BAIL] applyAtPoint entered, brushMode=${brushMode} isFirstInStroke=${isFirstInStroke} hasCanvasRef=${!!canvasRef.current}`,
      );
      const canvas = canvasRef.current;
      if (!canvas) {
        console.log('[TEMP-DEBUG-BAIL] guard canvas: canvasRef.current=null -> BAILING');
        return;
      }
      console.log('[TEMP-DEBUG-BAIL] guard canvas: present -> proceeding');
      const rect = canvas.getBoundingClientRect();
      // rect already accounts for CSS transform (zoom + pan), so this gives native canvas coords
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (clientX - rect.left) * scaleX;
      const y = (clientY - rect.top) * scaleY;
      const inBounds = x >= 0 && y >= 0 && x <= canvas.width && y <= canvas.height;
      console.log(
        `[TEMP-DEBUG-BAIL] coords: client=(${Math.round(clientX)},${Math.round(clientY)}) rect=(${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)}x${Math.round(rect.height)}) ` +
          `-> canvas=(${Math.round(x)},${Math.round(y)}) of ${canvas.width}x${canvas.height} inBounds=${inBounds} scaleX=${scaleX.toFixed(3)} scaleY=${scaleY.toFixed(3)}`,
      );

      const maskPresent = !!maskRef.current && !!maskRef.current.data;
      console.log(
        `[TEMP-DEBUG-BAIL] mask check: maskPresent=${maskPresent} maskDataLen=${maskRef.current?.data?.length ?? 'n/a'} maskWH=${maskRef.current?.width}x${maskRef.current?.height}`,
      );

      // Push undo snapshot once per stroke (not per pixel)
      if (isFirstInStroke && !strokeUndoPushedRef.current) {
        console.log('[TEMP-DEBUG-BAIL] undo snapshot: pushing (first-in-stroke, not yet pushed)');
        pushUndo({ ...maskRef.current, data: new Uint8ClampedArray(maskRef.current.data) });
        strokeUndoPushedRef.current = true;
      } else {
        console.log(
          `[TEMP-DEBUG-BAIL] undo snapshot: skipped isFirstInStroke=${isFirstInStroke} alreadyPushed=${strokeUndoPushedRef.current}`,
        );
      }

      let next: AlphaMask;
      if (brushMode === 'flood-remove' && sourcePixelsRef.current) {
        console.log('[TEMP-DEBUG-BAIL] mode branch: flood-remove -> proceeding');
        next = floodRemoveInMask(maskRef.current, sourcePixelsRef.current, canvas.width, x, y);
      } else if (brushMode === 'add' || brushMode === 'remove') {
        console.log(`[TEMP-DEBUG-BAIL] mode branch: ${brushMode} -> proceeding to applyBrushToMask`);
        next = applyBrushToMask(maskRef.current, x, y, brushSize * scaleX, brushMode);
        console.log(
          `[TEMP-DEBUG-BAIL] applyBrushToMask returned: sameRef=${next === maskRef.current} dataLen=${next?.data?.length}`,
        );
      } else {
        // TEMP-DEBUG-PAINT — the one silent no-op in this function: flood mode
        // with no cached source pixels (getImageData failed / tainted canvas).
        console.warn(
          `[TEMP-DEBUG-PAINT] applyAtPoint NO-OP mode=${brushMode} sourcePixels=${!!sourcePixelsRef.current}`,
        );
        console.log(
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
        console.log(
          `[TEMP-DEBUG-PAINT] applyAtPoint mode=${brushMode} client=(${Math.round(clientX)},${Math.round(clientY)}) ` +
            `→ canvas=(${Math.round(x)},${Math.round(y)}) of ${canvas.width}x${canvas.height} | ` +
            `rect=${Math.round(rect.width)}x${Math.round(rect.height)} scaleX=${scaleX.toFixed(3)} ` +
            `brushPx=${(brushSize * scaleX).toFixed(1)} | maskPx ${before}→${after} (delta ${after - before})`,
        );
      }

      console.log('[TEMP-DEBUG-BAIL] reached end: calling maskRef.current=next then onMaskChange(next)');
      maskRef.current = next;
      onMaskChange(next);
      console.log('[TEMP-DEBUG-BAIL] onMaskChange(next) call returned (onMaskChange is synchronous dispatch)');
    },
    [brushMode, brushSize, onMaskChange, pushUndo, zoom],
  );

  const handleAutoRemoveBackground = useCallback(async () => {
    setAutoMatteBusy(true);
    try {
      // `buildMatteAlphaMask` mattes the WHOLE frame — it takes a bitmap, not a
      // box — so unscoped it floods everything outside the coach's selection
      // with "keep". Clip it back to the drawn box.
      const rawMatte = await buildMatteAlphaMask(sourceFrame);
      const matte = selectionBox ? intersectMaskWithBox(rawMatte, selectionBox, 0) : rawMatte;

      // REPLACE inside the box rather than max-merge with the current mask. The
      // editor now opens on a SOLID box fill, and max-merge against a solid box
      // is a no-op — Auto BG could never cut background away, only add. Replacing
      // is what makes "let the AI refine my box" actually do something. The undo
      // snapshot below keeps it reversible (Ctrl+Z), since this is destructive.
      pushUndo(cloneAlphaMask(maskRef.current));
      maskRef.current = matte;
      onMaskChange(matte);
    } catch (err) {
      console.error('[FrameMaskEditor] Auto background removal failed:', err);
    } finally {
      setAutoMatteBusy(false);
    }
  }, [onMaskChange, pushUndo, selectionBox, sourceFrame]);

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
    ctx.putImageData(overlay, 0, 0);

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
    console.log(
      `[TEMP-DEBUG-REDRAW] overlay effect run #${redrawCountRef.current} canvas=${w}x${h} ` +
        `isVisibleEditCanvas=${canvas === canvasRef.current} maskPx=${maskPx} of ${w * h} ` +
        `sameMaskObjectAsLastRun=${sameMaskObject} checksum=${checksum} ` +
        `prevChecksum=${prevChecksum === null ? 'none' : prevChecksum} ` +
        `pixelsChanged=${prevChecksum === null ? 'n/a' : checksum !== prevChecksum}`,
    );
    lastMaskIdentityRef.current = mask;
    lastChecksumRef.current = checksum;

  }, [sourceFrame, mask]);

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
          <button type="button" style={toolBtn} disabled={isRegenerating} onClick={onRegenerate} title="Re-run AI proposal from scratch">
            <RefreshCw size={13} style={{ marginRight: 5, verticalAlign: -2 }} />
            {isRegenerating ? 'Working…' : 'Re-propose'}
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
              const delta = e.deltaY > 0 ? -0.15 : 0.15;
              setZoom((prev) => {
                const next = Math.min(4, Math.max(1, prev + delta));
                setPan((p) => clampPan(p, next));
                return next;
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
                cursor: 'none',
                display: 'block',
              }}
              onPointerDown={(e) => {
                // TEMP-DEBUG-PAINT — proves whether React's handler on THIS canvas
                // receives the stroke at all, independent of whether painting works.
                console.log(
                  `[TEMP-DEBUG-PAINT] canvas pointerdown target=<${(e.target as HTMLElement).tagName.toLowerCase()}> ` +
                    `isEditCanvas=${e.target === canvasRef.current} button=${e.button} alt=${e.altKey} zoom=${zoom}`,
                );
                console.log(
                  `[TEMP-DEBUG-BAIL] onPointerDown entered, brushMode=${brushMode} button=${e.button} altKey=${e.altKey} zoom=${zoom} pointerId=${e.pointerId} pointerType=${e.pointerType}`,
                );
                if (e.altKey && zoom > 1) {
                  console.log(`[TEMP-DEBUG-BAIL] guard altKey-pan: altKey=${e.altKey} zoom=${zoom} (zoom>1) -> BAILING`);
                  return;
                }
                console.log(`[TEMP-DEBUG-BAIL] guard altKey-pan: altKey=${e.altKey} zoom=${zoom} -> proceeding`);
                paintingRef.current = true;
                strokeUndoPushedRef.current = false;
                (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
                console.log('[TEMP-DEBUG-BAIL] onPointerDown: paintingRef=true, calling applyAtPoint(isFirstInStroke=true)');
                applyAtPoint(e.clientX, e.clientY, true);
              }}
              onPointerMove={(e) => {
                if (!paintingRef.current || brushMode === 'flood-remove') {
                  console.log(
                    `[TEMP-DEBUG-BAIL] onPointerMove guard: paintingRef=${paintingRef.current} brushMode=${brushMode} -> BAILING`,
                  );
                  return;
                }
                applyAtPoint(e.clientX, e.clientY, false);
              }}
              onPointerUp={() => {
                console.log('[TEMP-DEBUG-BAIL] onPointerUp: paintingRef=false, strokeUndoPushedRef=false');
                paintingRef.current = false; strokeUndoPushedRef.current = false;
              }}
              onPointerLeave={() => {
                console.log('[TEMP-DEBUG-BAIL] onPointerLeave: paintingRef=false, strokeUndoPushedRef=false');
                paintingRef.current = false; strokeUndoPushedRef.current = false;
              }}
            />
            {/* Brush circle cursor */}
            {cursorPos && brushMode !== 'flood-remove' ? (
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
            {/* Zoom hint */}
            {zoom > 1 ? (
              <div style={{
                position: 'absolute',
                bottom: 8,
                right: 8,
                fontSize: 10,
                color: 'rgba(255,255,255,0.55)',
                background: 'rgba(0,0,0,0.45)',
                padding: '2px 6px',
                borderRadius: 4,
                pointerEvents: 'none',
              }}>
                {Math.round(zoom * 100)}% · Alt+drag or scroll to navigate
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
