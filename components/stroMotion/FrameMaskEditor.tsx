'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { buildMatteAlphaMask } from '@/lib/objectMultiplier';
import {
  applyBrushToMask,
  floodRemoveInMask,
  mergeMasksPreferForeground,
  type AlphaMask,
  type BrushMode,
} from '@/lib/stroMotionDraft';

export interface FrameMaskEditorProps {
  sourceFrame: ImageBitmap;
  mask: AlphaMask;
  frameLabel: string;
  frameIndex?: number;
  frameTotal?: number;
  frameStatus?: 'pending' | 'edited' | 'ready';
  proposalEmpty?: boolean;
  backgroundPlate?: ImageBitmap | null;
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
  const [showCompositePreview, setShowCompositePreview] = useState(true);
  const [autoMatteBusy, setAutoMatteBusy] = useState(false);
  const paintingRef = useRef(false);
  const panningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const maskRef = useRef(mask);
  const sourcePixelsRef = useRef<Uint8ClampedArray | null>(null);
  maskRef.current = mask;

  useEffect(() => {
    const w = sourceFrame.width;
    const h = sourceFrame.height;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      sourcePixelsRef.current = null;
      return;
    }
    ctx.drawImage(sourceFrame, 0, 0);
    sourcePixelsRef.current = ctx.getImageData(0, 0, w, h).data;
  }, [sourceFrame]);

  const applyAtPoint = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (clientX - rect.left) * scaleX;
      const y = (clientY - rect.top) * scaleY;

      let next: AlphaMask;
      if (brushMode === 'flood-remove' && sourcePixelsRef.current) {
        next = floodRemoveInMask(maskRef.current, sourcePixelsRef.current, canvas.width, x, y);
      } else if (brushMode === 'add' || brushMode === 'remove') {
        next = applyBrushToMask(maskRef.current, x, y, brushSize / zoom, brushMode);
      } else {
        return;
      }

      maskRef.current = next;
      onMaskChange(next);
    },
    [brushMode, brushSize, onMaskChange, zoom],
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

    const overlay = ctx.getImageData(0, 0, w, h);
    const px = overlay.data;
    for (let i = 0; i < w * h; i++) {
      const a = mask.data[i];
      if (a <= 0) continue;
      px[i * 4] = Math.round(px[i * 4] * 0.55 + 0 * 0.45);
      px[i * 4 + 1] = Math.round(px[i * 4 + 1] * 0.55 + 180 * 0.45);
      px[i * 4 + 2] = Math.round(px[i * 4 + 2] * 0.55 + 255 * 0.45);
      px[i * 4 + 3] = Math.max(px[i * 4 + 3], Math.round((a / 255) * 200));
    }
    ctx.putImageData(overlay, 0, 0);
  }, [sourceFrame, mask]);

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
    const px = imageData.data;
    for (let i = 0; i < w * h; i++) {
      px[i * 4 + 3] = Math.round((px[i * 4 + 3] * mask.data[i]) / 255);
    }
    sctx.putImageData(imageData, 0, 0);
    ctx.drawImage(scratch, 0, 0, w, h);
  }, [backgroundPlate, mask, showCompositePreview, sourceFrame]);

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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, gap: 12 }}>
          <div>
            <strong style={{ fontSize: 16 }}>Refine background removal — {frameLabel}{framePosLabel}</strong>
            {frameStatus === 'ready' ? (
              <span style={{ marginLeft: 8, fontSize: 11, color: '#34C759', fontWeight: 700 }}>Ready</span>
            ) : null}
            <p style={{ margin: '6px 0 0', fontSize: 12, lineHeight: 1.45, color: 'rgba(255,255,255,0.65)' }}>
              Auto-remove clears court/wall background. Add brush keeps subject; Remove brush or Flood remove cuts leftover background.
            </p>
            {proposalEmpty ? (
              <p style={{ margin: '8px 0 0', fontSize: 12, color: '#FF9500', fontWeight: 600 }}>
                AI proposal was empty — tap Auto remove background or paint with Add brush.
              </p>
            ) : null}
          </div>
          <button type="button" onClick={onClose} style={toolBtn}>Close</button>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <button
            type="button"
            style={{ ...toolBtn, borderColor: '#5856D6', background: 'rgba(88,86,214,0.22)' }}
            disabled={autoMatteBusy || isRegenerating}
            onClick={() => { void handleAutoRemoveBackground(); }}
          >
            {autoMatteBusy ? 'Removing background…' : 'Auto remove background'}
          </button>
          <button type="button" style={{ ...toolBtn, ...(brushMode === 'add' ? activeTool : {}) }} onClick={() => setBrushMode('add')}>
            Add brush
          </button>
          <button type="button" style={{ ...toolBtn, ...(brushMode === 'remove' ? activeTool : {}) }} onClick={() => setBrushMode('remove')}>
            Remove brush
          </button>
          <button type="button" style={{ ...toolBtn, ...(brushMode === 'flood-remove' ? activeTool : {}) }} onClick={() => setBrushMode('flood-remove')}>
            Flood remove
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            Size
            <input type="range" min={4} max={96} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} disabled={brushMode === 'flood-remove'} />
            {brushSize}px
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            Zoom
            <input type="range" min={1} max={3} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
            {Math.round(zoom * 100)}%
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={showCompositePreview} onChange={(e) => setShowCompositePreview(e.target.checked)} />
            Show final preview
          </label>
          <button type="button" style={toolBtn} onClick={onReset}>Reset to AI proposal</button>
          <button type="button" style={toolBtn} disabled={isRegenerating} onClick={onRegenerate}>
            {isRegenerating ? 'Re-proposing…' : 'Re-propose mask'}
          </button>
          {onMarkReadyAndNext && frameStatus !== 'ready' ? (
            <button
              type="button"
              style={{ ...toolBtn, borderColor: '#34C759', background: 'rgba(52,199,89,0.22)' }}
              onClick={onMarkReadyAndNext}
            >
              Mark Ready &amp; Next
            </button>
          ) : null}
          {onMarkReady && frameStatus !== 'ready' ? (
            <button type="button" style={{ ...toolBtn, borderColor: '#34C759', background: 'rgba(52,199,89,0.15)' }} onClick={onMarkReady}>
              Mark Ready
            </button>
          ) : null}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: showCompositePreview ? '1fr 1fr' : '1fr',
            gap: 12,
          }}
        >
          <div
            ref={containerRef}
            style={{
              overflow: 'hidden',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.15)',
              maxHeight: 'min(72vh, 720px)',
              touchAction: 'none',
              cursor: zoom > 1 ? 'grab' : brushMode === 'flood-remove' ? 'cell' : 'crosshair',
              background: '#000',
            }}
            onPointerDown={(e) => {
              if (e.button === 1 || (e.button === 0 && e.altKey && zoom > 1)) {
                panningRef.current = true;
                panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
                (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
              }
            }}
            onPointerMove={(e) => {
              if (!panningRef.current) return;
              setPan({
                x: panStartRef.current.panX + (e.clientX - panStartRef.current.x),
                y: panStartRef.current.panY + (e.clientY - panStartRef.current.y),
              });
            }}
            onPointerUp={() => { panningRef.current = false; }}
          >
            <canvas
              ref={canvasRef}
              style={{
                width: `${zoom * 100}%`,
                height: 'auto',
                transform: `translate(${pan.x}px, ${pan.y}px)`,
                touchAction: 'none',
                cursor: brushMode === 'flood-remove' ? 'cell' : 'crosshair',
                display: 'block',
              }}
              onPointerDown={(e) => {
                if (e.altKey && zoom > 1) return;
                paintingRef.current = true;
                (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
                applyAtPoint(e.clientX, e.clientY);
              }}
              onPointerMove={(e) => {
                if (!paintingRef.current || brushMode === 'flood-remove') return;
                applyAtPoint(e.clientX, e.clientY);
              }}
              onPointerUp={() => {
                paintingRef.current = false;
              }}
              onPointerLeave={() => {
                paintingRef.current = false;
              }}
            />
          </div>

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
                style={{
                  width: '100%',
                  height: 'auto',
                  display: 'block',
                }}
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
  borderColor: '#007AFF',
  background: 'rgba(0,122,255,0.2)',
};
