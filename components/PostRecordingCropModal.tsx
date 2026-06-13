'use client';

/**
 * PostRecordingCropModal — Phase 3, Sections 4 & 5.
 *
 * The screen is always recorded full. After it stops this modal opens on the
 * "Recording Complete" chooser:
 *   - Download Full Video
 *   - Crop Before Download   -> crop phase
 *   - Cancel
 *
 * Crop phase = video preview + draggable/resizable rectangle with Free / 9:16 /
 * 16:9 presets. The crop is applied at export time (canvas-based) by the parent
 * via onExportCrop. This component only collects the pixel region.
 *
 * Icon semantics (V1): Crop = crop/region tool; Trim (future) = scissors;
 * Background removal (hub) = landscape cut-out icon — keep meanings distinct.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export type CropAspect = 'free' | '9:16' | '16:9';
export type PixelRegion = { x: number; y: number; w: number; h: number };
/** Crop seed expressed as fractions (0..1) of the full screen, from the optional pre-record area. */
export type RegionFraction = { x: number; y: number; w: number; h: number };

interface Props {
  blob: Blob;
  ext: string;
  /** Optional seed from the pre-record "Set Recording Area" metadata. */
  seedRegionFrac?: RegionFraction | null;
  seedAspect?: CropAspect;
  /** Open straight into the crop phase (used when an area was pre-selected). */
  startInCrop?: boolean;
  onCancel: () => void;
  onDownloadFull: () => void;
  /** region in intrinsic video pixels. May return a promise to show progress. */
  onExportCrop: (region: PixelRegion, aspect: CropAspect) => Promise<void> | void;
}

type Rect = { x: number; y: number; w: number; h: number };
type ContentBox = { left: number; top: number; w: number; h: number };

function aspectRatioValue(a: CropAspect): number | null {
  if (a === '9:16') return 9 / 16;
  if (a === '16:9') return 16 / 9;
  return null;
}

export default function PostRecordingCropModal({
  blob,
  ext,
  seedRegionFrac,
  seedAspect = 'free',
  startInCrop = false,
  onCancel,
  onDownloadFull,
  onExportCrop,
}: Props) {
  const url = useRef<string>('');
  if (!url.current) url.current = URL.createObjectURL(blob);
  useEffect(() => () => { if (url.current) URL.revokeObjectURL(url.current); }, []);

  const [phase, setPhase] = useState<'choose' | 'crop'>(startInCrop ? 'crop' : 'choose');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [intrinsic, setIntrinsic] = useState<{ w: number; h: number } | null>(null);
  const [content, setContent] = useState<ContentBox | null>(null);
  const [aspect, setAspect] = useState<CropAspect>(seedAspect);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seededRef = useRef(false);

  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const resizeRef = useRef<{ sx: number; sy: number; ow: number; oh: number } | null>(null);
  const cropRef = useRef<Rect | null>(null);
  cropRef.current = crop;
  const contentRef = useRef<ContentBox | null>(null);
  contentRef.current = content;

  const recomputeContent = useCallback(() => {
    const v = videoRef.current;
    if (!v || !intrinsic) return;
    const r = v.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const ar = intrinsic.w / intrinsic.h;
    let dispW = r.width;
    let dispH = r.width / ar;
    if (dispH > r.height) { dispH = r.height; dispW = r.height * ar; }
    setContent({ left: (r.width - dispW) / 2, top: (r.height - dispH) / 2, w: dispW, h: dispH });
  }, [intrinsic]);

  useLayoutEffect(() => { recomputeContent(); }, [recomputeContent, phase]);
  useEffect(() => {
    const v = videoRef.current;
    if (!v || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => recomputeContent());
    ro.observe(v);
    window.addEventListener('resize', recomputeContent);
    return () => { ro.disconnect(); window.removeEventListener('resize', recomputeContent); };
  }, [recomputeContent]);

  const reshapeForAspect = useCallback((box: ContentBox, a: CropAspect, prev: Rect | null): Rect => {
    const ratio = aspectRatioValue(a);
    if (ratio == null) {
      if (prev) {
        const x = Math.min(prev.x, box.w);
        const y = Math.min(prev.y, box.h);
        return { x, y, w: Math.min(prev.w, box.w - x), h: Math.min(prev.h, box.h - y) };
      }
      const w = box.w * 0.6;
      const h = box.h * 0.6;
      return { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h };
    }
    let w = box.w * 0.7;
    let h = w / ratio;
    if (h > box.h) { h = box.h * 0.9; w = h * ratio; }
    if (w > box.w) { w = box.w; h = w / ratio; }
    return { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h };
  }, []);

  // Seed the crop box once content is measured (uses pre-record area if present).
  useEffect(() => {
    if (phase !== 'crop' || !content) return;
    if (seededRef.current) return;
    seededRef.current = true;
    if (seedRegionFrac) {
      const x = Math.max(0, Math.min(content.w, seedRegionFrac.x * content.w));
      const y = Math.max(0, Math.min(content.h, seedRegionFrac.y * content.h));
      const w = Math.max(40, Math.min(content.w - x, seedRegionFrac.w * content.w));
      const h = Math.max(40, Math.min(content.h - y, seedRegionFrac.h * content.h));
      setCrop({ x, y, w, h });
    } else {
      setCrop(reshapeForAspect(content, aspect, null));
    }
  }, [phase, content, seedRegionFrac, aspect, reshapeForAspect]);

  const onAspectChange = useCallback((a: CropAspect) => {
    setAspect(a);
    setCrop((prev) => (content ? reshapeForAspect(content, a, prev) : prev));
  }, [content, reshapeForAspect]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const box = contentRef.current;
    const c = cropRef.current;
    if (!box || !c) return;
    if (dragRef.current) {
      const d = dragRef.current;
      const nx = Math.max(0, Math.min(box.w - c.w, d.ox + (e.clientX - d.sx)));
      const ny = Math.max(0, Math.min(box.h - c.h, d.oy + (e.clientY - d.sy)));
      setCrop({ ...c, x: nx, y: ny });
    } else if (resizeRef.current) {
      const rz = resizeRef.current;
      const ratio = aspectRatioValue(aspect);
      let nw = Math.max(40, rz.ow + (e.clientX - rz.sx));
      let nh = ratio == null ? Math.max(40, rz.oh + (e.clientY - rz.sy)) : nw / ratio;
      nw = Math.min(nw, box.w - c.x);
      nh = Math.min(nh, box.h - c.y);
      if (ratio != null) { nw = Math.min(nw, nh * ratio); nh = nw / ratio; }
      setCrop({ ...c, w: nw, h: nh });
    }
  }, [aspect]);

  const onPointerUp = useCallback(() => { dragRef.current = null; resizeRef.current = null; }, []);

  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  const handleExport = useCallback(async () => {
    if (busy || !crop || !content || !intrinsic) return;
    setError(null);
    const scale = intrinsic.w / content.w;
    const region: PixelRegion = {
      x: crop.x * scale,
      y: crop.y * scale,
      w: crop.w * scale,
      h: crop.h * scale,
    };
    try {
      setBusy(true);
      setProgress('Exporting…');
      await onExportCrop(region, aspect);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not export the crop.');
      setBusy(false);
      setProgress(null);
    }
  }, [busy, crop, content, intrinsic, aspect, onExportCrop]);

  const tabBtn = (selected: boolean): React.CSSProperties => ({
    padding: '6px 14px',
    borderRadius: 8,
    border: 'none',
    background: selected ? '#007AFF' : 'rgba(255,255,255,0.14)',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  });

  const bigBtn = (bg: string): React.CSSProperties => ({
    padding: '12px 20px',
    borderRadius: 12,
    border: 'none',
    background: bg,
    color: '#fff',
    fontSize: 15,
    fontWeight: 700,
    cursor: busy ? 'not-allowed' : 'pointer',
    opacity: busy ? 0.7 : 1,
  });

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200010,
        background: 'rgba(0,0,0,0.8)',
        display: 'flex',
        flexDirection: 'column',
        padding: 'max(16px, env(safe-area-inset-top, 0px)) 16px 16px',
        gap: 12,
        touchAction: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', color: '#fff' }}>
        <strong style={{ fontSize: 16 }}>{phase === 'choose' ? 'Recording complete' : 'Crop recording'}</strong>
        {phase === 'crop' ? (
          <div style={{ display: 'flex', gap: 6 }}>
            {(['free', '9:16', '16:9'] as CropAspect[]).map((a) => (
              <button key={a} type="button" style={tabBtn(aspect === a)} onClick={() => onAspectChange(a)} disabled={busy}>
                {a === 'free' ? 'Free' : a}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          <video
            ref={videoRef}
            src={url.current}
            controls={phase === 'choose'}
            loop={phase === 'choose'}
            autoPlay
            muted
            playsInline
            onLoadedMetadata={(e) => setIntrinsic({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
            style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000', borderRadius: 8 }}
          />
          {phase === 'crop' && content && crop ? (
            <div
              style={{
                position: 'absolute',
                left: content.left + crop.x,
                top: content.top + crop.y,
                width: crop.w,
                height: crop.h,
                border: '2px solid #34C759',
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
                borderRadius: 4,
                cursor: 'move',
                touchAction: 'none',
              }}
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).dataset.resize) return;
                dragRef.current = { sx: e.clientX, sy: e.clientY, ox: crop.x, oy: crop.y };
                e.currentTarget.setPointerCapture(e.pointerId);
                e.preventDefault();
              }}
            >
              <div
                data-resize="1"
                style={{
                  position: 'absolute',
                  right: -14,
                  bottom: -14,
                  width: 32,
                  height: 32,
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'nwse-resize',
                  touchAction: 'none',
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  resizeRef.current = { sx: e.clientX, sy: e.clientY, ow: crop.w, oh: crop.h };
                  e.currentTarget.setPointerCapture(e.pointerId);
                  e.preventDefault();
                }}
              >
                <div style={{ width: 18, height: 18, borderRadius: 4, background: '#34C759', border: '2px solid #fff', pointerEvents: 'none' }} />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {error ? <span style={{ color: '#FF6B60', fontSize: 12, marginRight: 'auto' }}>{error}</span> : null}
        {busy ? <span style={{ color: '#fff', fontSize: 13, marginRight: 'auto' }}>{progress ?? 'Working…'}</span> : null}
        {phase === 'choose' ? (
          <>
            <button type="button" style={bigBtn('rgba(255,255,255,0.16)')} onClick={onCancel} disabled={busy}>Cancel</button>
            <button type="button" style={bigBtn('#007AFF')} onClick={() => setPhase('crop')} disabled={busy}>Crop before download</button>
            <button type="button" style={bigBtn('#16A34A')} onClick={onDownloadFull} disabled={busy}>Download full ({ext.toUpperCase()})</button>
          </>
        ) : (
          <>
            <button type="button" style={bigBtn('rgba(255,255,255,0.16)')} onClick={() => setPhase('choose')} disabled={busy}>Back</button>
            <button type="button" style={bigBtn('#16A34A')} onClick={handleExport} disabled={busy || !crop}>Crop &amp; download MP4</button>
          </>
        )}
      </div>
    </div>
  );
}
