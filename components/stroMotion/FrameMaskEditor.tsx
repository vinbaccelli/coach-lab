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
  floodRemoveInMask,
  mergeMasksPreferForeground,
  type AlphaMask,
  type BrushMode,
} from '@/lib/stroMotionDraft';
import type { StroMotionSubjectBox } from '@/lib/stroMotion';

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
  onMaskChange: (mask: AlphaMask) => void;
  onReset: () => void;
  onRegenerate: () => void;
  onMarkReady?: () => void;
  onMarkReadyAndNext?: () => void;
  onClose: () => void;
  isRegenerating?: boolean;
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
  onMaskChange,
  onReset,
  onRegenerate,
  onMarkReady,
  onMarkReadyAndNext,
  onClose,
  isRegenerating = false,
}: FrameMaskEditorProps) {
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
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      // rect already accounts for CSS transform (zoom + pan), so this gives native canvas coords
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (clientX - rect.left) * scaleX;
      const y = (clientY - rect.top) * scaleY;

      // Push undo snapshot once per stroke (not per pixel)
      if (isFirstInStroke && !strokeUndoPushedRef.current) {
        pushUndo({ ...maskRef.current, data: new Uint8ClampedArray(maskRef.current.data) });
        strokeUndoPushedRef.current = true;
      }

      let next: AlphaMask;
      if (brushMode === 'flood-remove' && sourcePixelsRef.current) {
        next = floodRemoveInMask(maskRef.current, sourcePixelsRef.current, canvas.width, x, y);
      } else if (brushMode === 'add' || brushMode === 'remove') {
        next = applyBrushToMask(maskRef.current, x, y, brushSize * scaleX, brushMode);
      } else {
        return;
      }

      maskRef.current = next;
      onMaskChange(next);
    },
    [brushMode, brushSize, onMaskChange, pushUndo, zoom],
  );

  const handleAutoRemoveBackground = useCallback(async () => {
    setAutoMatteBusy(true);
    try {
      const matte = await buildMatteAlphaMask(sourceFrame);
      const next = maskHasAnyContent(maskRef.current)
        ? mergeMasksPreferForeground(matte, maskRef.current)
        : matte;
      maskRef.current = next;
      onMaskChange(next);
    } catch (err) {
      console.error('[FrameMaskEditor] Auto background removal failed:', err);
    } finally {
      setAutoMatteBusy(false);
    }
  }, [onMaskChange, sourceFrame]);

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
        padding: 16,
      }}
    >
      <div
        style={{
          width: 'min(1180px, 100%)',
          maxHeight: '94vh',
          overflow: 'auto',
          background: '#1c1c1e',
          borderRadius: 14,
          border: '1px solid rgba(255,255,255,0.12)',
          padding: 16,
          color: '#fff',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, gap: 12 }}>
          <div>
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
          <button type="button" onClick={onClose} style={toolBtn}>Close</button>
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
            title="Re-run AI background removal on the full frame"
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
              border: '1px solid rgba(255,255,255,0.15)',
              maxHeight: 'min(72vh, 720px)',
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
              style={{
                width: `${zoom * 100}%`,
                height: 'auto',
                transform: `translate(${pan.x}px, ${pan.y}px)`,
                transformOrigin: '0 0',
                touchAction: 'none',
                cursor: 'none',
                display: 'block',
              }}
              onPointerDown={(e) => {
                if (e.altKey && zoom > 1) return;
                paintingRef.current = true;
                strokeUndoPushedRef.current = false;
                (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
                applyAtPoint(e.clientX, e.clientY, true);
              }}
              onPointerMove={(e) => {
                if (!paintingRef.current || brushMode === 'flood-remove') return;
                applyAtPoint(e.clientX, e.clientY, false);
              }}
              onPointerUp={() => { paintingRef.current = false; strokeUndoPushedRef.current = false; }}
              onPointerLeave={() => { paintingRef.current = false; strokeUndoPushedRef.current = false; }}
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
                style={{ width: '100%', height: 'auto', display: 'block' }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function maskHasAnyContent(mask: AlphaMask): boolean {
  for (let i = 0; i < mask.data.length; i++) {
    if (mask.data[i] > 0) return true;
  }
  return false;
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
