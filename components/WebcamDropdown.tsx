'use client';

import React, { useRef, useEffect, useState } from 'react';
import type { WebcamPipMode } from '@/components/ToolPalette';

interface WebcamDropdownProps {
  webcamActive: boolean;
  onToggleWebcam: () => void;
  webcamPipMode: WebcamPipMode;
  onWebcamPipModeChange: (mode: WebcamPipMode) => void;
  webcamOpacity: number;
  onWebcamOpacityChange: (v: number) => void;
  webcamCutout: boolean;
  onWebcamCutoutChange: (v: boolean) => void;
  /** Optional style overrides for the trigger button */
  triggerStyle?: React.CSSProperties;
  /** Compact label for narrow layouts (e.g. reels) */
  compact?: boolean;
}

export default function WebcamDropdown({
  webcamActive,
  onToggleWebcam,
  webcamPipMode,
  onWebcamPipModeChange,
  webcamOpacity,
  onWebcamOpacityChange,
  webcamCutout,
  onWebcamCutoutChange,
  triggerStyle,
  compact = false,
}: WebcamDropdownProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent | TouchEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('touchstart', onClick);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('touchstart', onClick);
    };
  }, [open]);

  const pillBtn = (active: boolean): React.CSSProperties => ({
    padding: '4px 10px',
    borderRadius: 8,
    border: `1px solid ${active ? '#35679A' : '#E5E5EA'}`,
    background: active ? '#35679A' : '#fff',
    color: active ? '#fff' : '#1D1D1F',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  });

  return (
    <div ref={wrapperRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 10px',
          borderRadius: 8,
          border: '1px solid #E5E5EA',
          background: webcamActive ? 'rgba(74,222,128,0.12)' : '#fff',
          color: webcamActive ? '#16a34a' : '#1D1D1F',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          ...triggerStyle,
        }}
        title="Webcam settings"
      >
        {webcamActive && <span style={{ fontSize: 8 }}>●</span>}
        {compact ? 'Cam ▾' : 'Webcam ▾'}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 220,
            background: '#fff',
            borderRadius: 14,
            boxShadow: '0 4px 24px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.06)',
            padding: '14px 16px',
            zIndex: 200,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* On / Off */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#1D1D1F' }}>Camera</span>
            <button
              type="button"
              onClick={() => { onToggleWebcam(); }}
              style={{
                width: 44,
                height: 24,
                borderRadius: 12,
                border: 'none',
                background: webcamActive ? '#34C759' : '#E5E5EA',
                cursor: 'pointer',
                position: 'relative',
                transition: 'background 0.2s',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 2,
                  left: webcamActive ? 22 : 2,
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: '#fff',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
                  transition: 'left 0.2s',
                }}
              />
            </button>
          </div>

          {/* Background removal */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: '#3C3C43' }}>Background removal</span>
            <button
              type="button"
              onClick={() => onWebcamCutoutChange(!webcamCutout)}
              style={{
                width: 44,
                height: 24,
                borderRadius: 12,
                border: 'none',
                background: webcamCutout ? '#34C759' : '#E5E5EA',
                cursor: 'pointer',
                position: 'relative',
                transition: 'background 0.2s',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 2,
                  left: webcamCutout ? 22 : 2,
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: '#fff',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
                  transition: 'left 0.2s',
                }}
              />
            </button>
          </div>

          {/* Opacity */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: '#3C3C43' }}>Opacity</span>
              <span style={{ fontSize: 11, color: '#8E8E93', fontWeight: 600 }}>
                {Math.round(webcamOpacity * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(webcamOpacity * 100)}
              onChange={(e) => onWebcamOpacityChange(Number(e.target.value) / 100)}
              style={{ width: '100%', accentColor: '#35679A' }}
            />
          </div>

          {/* PiP mode */}
          <div>
            <span style={{ fontSize: 12, fontWeight: 500, color: '#3C3C43', display: 'block', marginBottom: 6 }}>
              PiP shape
            </span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(['rectangle', 'circle'] as WebcamPipMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  style={pillBtn(webcamPipMode === m)}
                  onClick={() => onWebcamPipModeChange(m)}
                >
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Hint */}
          <p style={{ fontSize: 10, color: '#8E8E93', lineHeight: 1.4, margin: 0 }}>
            Drag the PiP window on canvas to reposition. Pinch or corner-drag to resize.
          </p>
        </div>
      )}
    </div>
  );
}
