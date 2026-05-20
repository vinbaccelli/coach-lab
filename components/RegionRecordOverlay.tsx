'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

export type ViewportRegion = { x: number; y: number; w: number; h: number };

type Props = {
  aspect: '16:9' | '9:16';
  onAspectChange: (a: '16:9' | '9:16') => void;
  region: ViewportRegion;
  onRegionChange: (r: ViewportRegion) => void;
  onClose: () => void;
};

function defaultRegion(aspect: '16:9' | '9:16'): ViewportRegion {
  const maxW = Math.min(window.innerWidth * 0.85, 420);
  const w = maxW;
  const h = aspect === '16:9' ? w * (9 / 16) : w * (16 / 9);
  return {
    x: Math.round((window.innerWidth - w) / 2),
    y: Math.round((window.innerHeight - h) / 2),
    w: Math.round(w),
    h: Math.round(h),
  };
}

export function RegionRecordOverlay({ aspect, onAspectChange, region, onRegionChange, onClose }: Props) {
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const resizeRef = useRef<{ sx: number; sy: number; ow: number; oh: number } | null>(null);
  const [hint, setHint] = useState('Drag to move · corner to resize');

  useEffect(() => {
    onRegionChange(defaultRegion(aspect));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspect]);

  const onMove = useCallback(
    (e: PointerEvent) => {
      if (dragRef.current) {
        const d = dragRef.current;
        onRegionChange({
          ...region,
          x: Math.max(0, Math.min(window.innerWidth - region.w, d.ox + (e.clientX - d.sx))),
          y: Math.max(0, Math.min(window.innerHeight - region.h, d.oy + (e.clientY - d.sy))),
        });
      }
      if (resizeRef.current) {
        const r = resizeRef.current;
        const nw = Math.max(120, r.ow + (e.clientX - r.sx));
        const nh = aspect === '16:9' ? nw * (9 / 16) : nw * (16 / 9);
        onRegionChange({
          ...region,
          w: Math.round(nw),
          h: Math.round(nh),
        });
      }
    },
    [aspect, onRegionChange, region],
  );

  const onUp = useCallback(() => {
    dragRef.current = null;
    resizeRef.current = null;
  }, []);

  useEffect(() => {
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [onMove, onUp]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200000,
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.45)',
          pointerEvents: 'none',
        }}
      />
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
        }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).dataset.resize) return;
          dragRef.current = { sx: e.clientX, sy: e.clientY, ox: region.x, oy: region.y };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
      >
        <div
          data-resize="1"
          style={{
            position: 'absolute',
            right: -6,
            bottom: -6,
            width: 18,
            height: 18,
            borderRadius: 4,
            background: '#34C759',
            border: '2px solid #fff',
            cursor: 'nwse-resize',
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            resizeRef.current = { sx: e.clientX, sy: e.clientY, ow: region.w, oh: region.h };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
        />
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
          background: 'rgba(0,0,0,0.75)',
          color: '#fff',
          fontSize: 12,
          fontWeight: 600,
          backdropFilter: 'blur(8px)',
        }}
      >
        <button type="button" onClick={() => onAspectChange('16:9')} style={{ padding: '4px 10px', borderRadius: 8, border: 'none', background: aspect === '16:9' ? '#35679A' : 'rgba(255,255,255,0.15)', color: '#fff', cursor: 'pointer' }}>16:9</button>
        <button type="button" onClick={() => onAspectChange('9:16')} style={{ padding: '4px 10px', borderRadius: 8, border: 'none', background: aspect === '9:16' ? '#35679A' : 'rgba(255,255,255,0.15)', color: '#fff', cursor: 'pointer' }}>9:16</button>
        <span style={{ opacity: 0.85 }}>{hint}</span>
        <button type="button" onClick={onClose} style={{ padding: '4px 10px', borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.2)', color: '#fff', cursor: 'pointer' }}>Done</button>
      </div>
    </div>
  );
}

export function useViewportRegion(aspect: '16:9' | '9:16') {
  const [region, setRegion] = useState<ViewportRegion>(() =>
    typeof window !== 'undefined' ? defaultRegion(aspect) : { x: 0, y: 0, w: 320, h: 568 },
  );
  return { region, setRegion };
}
