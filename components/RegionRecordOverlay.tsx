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

function aspectRatioValue(a: CropAspect): number | null {
  if (a === '9:16') return 9 / 16;
  if (a === '16:9') return 16 / 9;
  return null;
}

function defaultRegion(aspect: CropAspect): ViewportRegion {
  const w = Math.min(window.innerWidth * 0.85, 420);
  const ratio = aspectRatioValue(aspect);
  const h = ratio == null ? w * (9 / 16) : w / ratio;
  return {
    x: Math.round((window.innerWidth - w) / 2),
    y: Math.round((window.innerHeight - h) / 2),
    w: Math.round(w),
    h: Math.round(h),
  };
}

export function RegionRecordOverlay({ initialAspect = 'free', initialRegion, onCancel, onConfirm }: Props) {
  const [aspect, setAspect] = useState<CropAspect>(initialAspect);
  const [region, setRegion] = useState<ViewportRegion>(
    () => initialRegion ?? defaultRegion(initialAspect),
  );

  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const resizeRef = useRef<{ sx: number; sy: number; ow: number; oh: number } | null>(null);
  const regionRef = useRef(region);
  regionRef.current = region;
  const aspectRef = useRef(aspect);
  aspectRef.current = aspect;

  const onAspectChange = useCallback((a: CropAspect) => {
    setAspect(a);
    setRegion((r) => {
      const ratio = aspectRatioValue(a);
      if (ratio == null) return r;
      const h = r.w / ratio;
      return { ...r, h: Math.round(h) };
    });
  }, []);

  const onMove = useCallback((e: PointerEvent) => {
    const r = regionRef.current;
    if (dragRef.current) {
      const d = dragRef.current;
      setRegion({
        ...r,
        x: Math.max(0, Math.min(window.innerWidth - r.w, d.ox + (e.clientX - d.sx))),
        y: Math.max(0, Math.min(window.innerHeight - r.h, d.oy + (e.clientY - d.sy))),
      });
    } else if (resizeRef.current) {
      const rv = resizeRef.current;
      const ratio = aspectRatioValue(aspectRef.current);
      let nw = Math.max(120, rv.ow + (e.clientX - rv.sx));
      let nh = ratio == null ? Math.max(80, rv.oh + (e.clientY - rv.sy)) : nw / ratio;
      nw = Math.min(nw, window.innerWidth - r.x);
      nh = Math.min(nh, window.innerHeight - r.y);
      if (ratio != null) { nw = Math.min(nw, nh * ratio); nh = nw / ratio; }
      setRegion({ ...r, w: Math.round(nw), h: Math.round(nh) });
    }
  }, []);

  const onUp = useCallback(() => { dragRef.current = null; resizeRef.current = null; }, []);

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
            resizeRef.current = { sx: e.clientX, sy: e.clientY, ow: region.w, oh: region.h };
            e.currentTarget.setPointerCapture(e.pointerId);
            e.preventDefault();
          }}
        >
          <div style={{ width: 18, height: 18, borderRadius: 4, background: '#34C759', border: '2px solid #fff', pointerEvents: 'none' }} />
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
