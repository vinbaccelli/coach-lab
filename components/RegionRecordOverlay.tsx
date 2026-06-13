'use client';

/**
 * RegionRecordOverlay — Phase 3, Section 2.
 *
 * "Set Recording Area" is a UI selection tool ONLY. It does NOT start recording,
 * does NOT touch getDisplayMedia, and does NOT affect the live stream. Confirming
 * just hands back the chosen rectangle + aspect as metadata, which is later used
 * to seed the post-recording crop modal.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CropAspect } from '@/components/PostRecordingCropModal';

export type ViewportRegion = { x: number; y: number; w: number; h: number };

type Props = {
  initialAspect?: CropAspect;
  initialRegion?: ViewportRegion | null;
  onCancel: () => void;
  onConfirm: (region: ViewportRegion, aspect: CropAspect) => void;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function aspectRatioValue(a: CropAspect): number | null {
  if (a === '9:16') return 9 / 16;
  if (a === '16:9') return 16 / 9;
  return null;
}

function fitRegionToViewport(r: ViewportRegion): ViewportRegion {
  const maxW = window.innerWidth;
  const maxH = window.innerHeight;
  let { x, y, w, h } = r;
  w = Math.min(Math.max(120, w), maxW);
  h = Math.min(Math.max(80, h), maxH);
  x = clamp(x, 0, Math.max(0, maxW - w));
  y = clamp(y, 0, Math.max(0, maxH - h));
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

function regionForAspect(aspect: CropAspect, prev?: ViewportRegion | null): ViewportRegion {
  const maxW = window.innerWidth * 0.92;
  const maxH = window.innerHeight * 0.82;
  const ratio = aspectRatioValue(aspect);
  if (ratio == null) {
    return fitRegionToViewport(prev ?? {
      x: Math.round((window.innerWidth - Math.min(maxW, 420)) / 2),
      y: Math.round((window.innerHeight - Math.min(maxH, 420 * (9 / 16))) / 2),
      w: Math.round(Math.min(maxW, 420)),
      h: Math.round(Math.min(maxH, 420 * (9 / 16))),
    });
  }
  let w = Math.min(maxW, prev?.w ?? maxW * 0.55);
  let h = w / ratio;
  if (h > maxH) {
    h = maxH * 0.9;
    w = h * ratio;
  }
  if (w > maxW) {
    w = maxW;
    h = w / ratio;
  }
  return fitRegionToViewport({
    x: Math.round((window.innerWidth - w) / 2),
    y: Math.round((window.innerHeight - h) / 2),
    w: Math.round(w),
    h: Math.round(h),
  });
}

export function RegionRecordOverlay({ initialAspect = 'free', initialRegion, onCancel, onConfirm }: Props) {
  const [aspect, setAspect] = useState<CropAspect>(initialAspect);
  const [region, setRegion] = useState<ViewportRegion>(
    () => fitRegionToViewport(initialRegion ?? regionForAspect(initialAspect)),
  );

  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const resizeRef = useRef<{ sx: number; sy: number; ow: number; oh: number } | null>(null);
  const regionRef = useRef(region);
  regionRef.current = region;
  const aspectRef = useRef(aspect);
  aspectRef.current = aspect;

  const onAspectChange = useCallback((a: CropAspect) => {
    setAspect(a);
    setRegion((r) => regionForAspect(a, r));
  }, []);

  const onMove = useCallback((e: PointerEvent) => {
    const r = regionRef.current;
    if (dragRef.current) {
      const d = dragRef.current;
      setRegion(fitRegionToViewport({
        ...r,
        x: d.ox + (e.clientX - d.sx),
        y: d.oy + (e.clientY - d.sy),
      }));
    } else if (resizeRef.current) {
      const rv = resizeRef.current;
      const ratio = aspectRatioValue(aspectRef.current);
      let nw = Math.max(120, rv.ow + (e.clientX - rv.sx));
      let nh = ratio == null ? Math.max(80, rv.oh + (e.clientY - rv.sy)) : nw / ratio;
      const maxW = window.innerWidth - r.x;
      const maxH = window.innerHeight - r.y;
      nw = Math.min(nw, maxW);
      nh = Math.min(nh, maxH);
      if (ratio != null) {
        nw = Math.min(nw, nh * ratio);
        nh = nw / ratio;
      }
      setRegion(fitRegionToViewport({ ...r, w: Math.round(nw), h: Math.round(nh) }));
    }
  }, []);

  const onUp = useCallback(() => { dragRef.current = null; resizeRef.current = null; }, []);

  useEffect(() => {
    const onResize = () => setRegion((r) => fitRegionToViewport(r));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [onMove, onUp]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200000, pointerEvents: 'auto', touchAction: 'none' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', pointerEvents: 'none' }} />
      <div
        style={{
          position: 'absolute',
          left: region.x,
          top: region.y,
          width: region.w,
          height: region.h,
          border: '2px solid #34C759',
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
          borderRadius: 4,
          touchAction: 'none',
          cursor: 'move',
          pointerEvents: 'auto',
          boxSizing: 'border-box',
        }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).dataset.resize) return;
          dragRef.current = { sx: e.clientX, sy: e.clientY, ox: region.x, oy: region.y };
          e.currentTarget.setPointerCapture(e.pointerId);
          e.preventDefault();
        }}
      >
        <div
          data-resize="1"
          style={{
            position: 'absolute',
            right: 8,
            bottom: 8,
            width: 36,
            height: 36,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'nwse-resize',
            touchAction: 'none',
            zIndex: 2,
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            resizeRef.current = { sx: e.clientX, sy: e.clientY, ow: region.w, oh: region.h };
            e.currentTarget.setPointerCapture(e.pointerId);
            e.preventDefault();
          }}
        >
          <div style={{ width: 20, height: 20, borderRadius: 4, background: '#34C759', border: '2px solid #fff', pointerEvents: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.35)' }} />
        </div>
      </div>
      <div
        style={{
          position: 'fixed',
          top: 12,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          padding: '8px 12px',
          borderRadius: 12,
          background: 'rgba(0,0,0,0.78)',
          color: '#fff',
          fontSize: 12,
          fontWeight: 600,
          backdropFilter: 'blur(8px)',
          pointerEvents: 'auto',
          zIndex: 200001,
          flexWrap: 'wrap',
          maxWidth: '92vw',
          justifyContent: 'center',
        }}
      >
        {(['free', '9:16', '16:9'] as CropAspect[]).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => onAspectChange(a)}
            style={{ padding: '4px 10px', borderRadius: 8, border: 'none', background: aspect === a ? '#007AFF' : 'rgba(255,255,255,0.15)', color: '#fff', cursor: 'pointer' }}
          >
            {a === 'free' ? 'Free' : a}
          </button>
        ))}
        <span style={{ opacity: 0.85 }}>Drag to move · corner to resize</span>
        <button type="button" onClick={onCancel} style={{ padding: '4px 10px', borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.2)', color: '#fff', cursor: 'pointer' }}>Cancel</button>
        <button
          type="button"
          onClick={() => onConfirm(regionRef.current, aspectRef.current)}
          style={{ padding: '4px 12px', borderRadius: 8, border: 'none', background: '#34C759', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
        >
          Confirm area
        </button>
      </div>
    </div>
  );
}
