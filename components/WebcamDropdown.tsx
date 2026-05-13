'use client';

import React, { useRef, useEffect, useState } from 'react';
import { ChevronLeft, Camera } from 'lucide-react';
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
  triggerStyle?: React.CSSProperties;
  compact?: boolean;
}

function haptic() {
  try {
    navigator?.vibrate?.(10);
  } catch {
    /* noop */
  }
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const close = () => setOpen(false);

  const row = (opts: { onPress: () => void; children: React.ReactNode }) => (
    <button
      type="button"
      onPointerDown={(e) => {
        e.preventDefault();
        haptic();
        opts.onPress();
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        minHeight: 48,
        padding: '12px 14px',
        borderRadius: 12,
        border: '1px solid #E8E6E1',
        background: '#FAF8F5',
        color: '#1A1A1A',
        fontSize: 14,
        fontWeight: 600,
        cursor: 'pointer',
        textAlign: 'left' as const,
        touchAction: 'manipulation',
        transition: 'transform 0.12s ease',
      }}
    >
      {opts.children}
    </button>
  );

  const toggleRow = (label: string, on: boolean, flip: () => void) =>
    row({
      onPress: flip,
      children: (
        <>
          <span>{label}</span>
          <span
            aria-hidden
            style={{
              width: 44,
              height: 26,
              borderRadius: 13,
              background: on ? '#34C759' : '#E5E5EA',
              position: 'relative',
              flexShrink: 0,
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: 3,
                left: on ? 22 : 3,
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: '#fff',
                boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
                transition: 'left 0.2s',
              }}
            />
          </span>
        </>
      ),
    });

  return (
    <div ref={wrapperRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onPointerDown={(e) => {
          e.preventDefault();
          haptic();
          setOpen((p) => !p);
        }}
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
          touchAction: 'manipulation',
          ...triggerStyle,
        }}
        title="Webcam"
      >
        {webcamActive && <span style={{ fontSize: 8 }}>●</span>}
        {compact ? 'Cam' : 'Webcam'}
      </button>

      {open && (
        <>
          <div
            role="presentation"
            onPointerDown={(e) => {
              e.preventDefault();
              close();
            }}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.35)',
              zIndex: 280,
              touchAction: 'none',
            }}
          />
          <div
            style={{
              position: 'fixed',
              left: 0,
              top: 'calc(44px + env(safe-area-inset-top, 0px))',
              bottom: 0,
              width: 'min(100vw, 300px)',
              maxWidth: '100%',
              zIndex: 300,
              display: 'flex',
              flexDirection: 'column',
              background: '#FDFCF9',
              borderRight: '1px solid #E8E6E1',
              boxShadow: '8px 0 32px rgba(0,0,0,0.12)',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                flexShrink: 0,
                padding: '10px 12px',
                borderBottom: '1px solid #E8E6E1',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <button
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  haptic();
                  close();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  minHeight: 44,
                  padding: '0 4px',
                  border: 'none',
                  background: 'none',
                  color: '#35679A',
                  fontWeight: 700,
                  fontSize: 15,
                  cursor: 'pointer',
                  touchAction: 'manipulation',
                }}
              >
                <ChevronLeft size={22} />
                Back
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 4 }}>
                <span
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: '#1A1A1A',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Camera size={18} color="#fff" />
                </span>
                <div style={{ fontWeight: 800, fontSize: 16, color: '#111827' }}>Webcam</div>
              </div>
            </div>

            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                WebkitOverflowScrolling: 'touch',
                padding: '12px 14px calc(24px + env(safe-area-inset-bottom, 0px))',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              {toggleRow('Camera on', webcamActive, () => {
                onToggleWebcam();
              })}
              {toggleRow('Background removal', webcamCutout, () => onWebcamCutoutChange(!webcamCutout))}

              <div style={{ padding: '4px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13, fontWeight: 600 }}>
                  <span>Opacity</span>
                  <span style={{ color: '#6B7280' }}>{Math.round(webcamOpacity * 100)}%</span>
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

              <div style={{ fontSize: 12, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                PiP shape
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(['rectangle', 'circle'] as WebcamPipMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      haptic();
                      onWebcamPipModeChange(m);
                    }}
                    style={{
                      minHeight: 46,
                      borderRadius: 12,
                      border: webcamPipMode === m ? '2px solid #35679A' : '1px solid #E8E6E1',
                      background: webcamPipMode === m ? 'rgba(53,103,154,0.08)' : '#FAF8F5',
                      fontWeight: 600,
                      fontSize: 14,
                      cursor: 'pointer',
                      touchAction: 'manipulation',
                    }}
                  >
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>

              <p style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.45, margin: '8px 0 0' }}>
                Drag the PiP on the canvas to move it. Use the corner handle to resize.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
