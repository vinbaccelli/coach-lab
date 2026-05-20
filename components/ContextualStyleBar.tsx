'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { Eraser, Sparkles, X } from 'lucide-react';

export type ContextualStyleSnapshot = {
  color: string;
  lineWidth: number;
  opacity: number;
  dashed: boolean;
  spinning: boolean;
  outlineEraserEnabled: boolean;
  outlineEraserSize: number;
};

export type ContextualStyleBarProps = {
  open: boolean;
  /** Viewport coordinates for anchoring the card */
  anchorX: number;
  anchorY: number;
  mobile: boolean;
  snapshot: ContextualStyleSnapshot;
  onChange: (patch: Partial<ContextualStyleSnapshot>) => void;
  onClose: () => void;
  /** After outline eraser enabled — coach drags on the shape */
  onBeginOutlineEraser?: () => void;
};

const PRESET_COLORS = ['#FFFFFF', '#111827', '#DC2626', '#2563EB'] as const;

export default function ContextualStyleBar({
  open,
  anchorX,
  anchorY,
  mobile,
  snapshot,
  onChange,
  onClose,
  onBeginOutlineEraser,
}: ContextualStyleBarProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const clampPos = useCallback(() => {
    const pad = 12;
    const w = mobile ? Math.min(360, window.innerWidth - pad * 2) : 280;
    const h = 200;
    let left = anchorX - w / 2;
    let top = anchorY - h - 14;
    if (mobile) {
      left = (window.innerWidth - w) / 2;
      top = Math.min(
        window.innerHeight - h - pad - 80,
        Math.max(pad + 48, anchorY - h - 8),
      );
    } else {
      left = Math.max(pad, Math.min(window.innerWidth - w - pad, left));
      top = Math.max(pad + 48, Math.min(window.innerHeight - h - pad, top));
    }
    return { left, top, width: w };
  }, [anchorX, anchorY, mobile]);

  if (!open) return null;

  const { left, top, width } = clampPos();

  const shell: React.CSSProperties = {
    position: 'fixed',
    left,
    top,
    width,
    zIndex: 200,
    pointerEvents: 'auto',
    background: 'rgba(250, 249, 247, 0.96)',
    border: '1px solid rgba(0,0,0,0.08)',
    borderRadius: 14,
    boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
    padding: mobile ? '10px 12px' : '12px 14px',
    fontFamily: 'inherit',
    color: '#1A1A1A',
    touchAction: 'manipulation',
  };

  const row: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  };

  const label: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    color: '#6B7280',
    minWidth: mobile ? 72 : 64,
  };

  const toggleBtn = (on: boolean, onPress: () => void, icon: React.ReactNode, text: string) => (
    <button
      type="button"
      onPointerDown={(e) => {
        e.preventDefault();
        onPress();
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flex: 1,
        minHeight: 36,
        padding: '6px 10px',
        borderRadius: 10,
        border: on ? '1px solid #35679A' : '1px solid #E5E5E5',
        background: on ? 'rgba(53,103,154,0.12)' : '#FFFFFF',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {icon}
      {text}
    </button>
  );

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Shape style"
      data-contextual-style-bar
      style={shell}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 800 }}>Style this mark</span>
        <button
          type="button"
          aria-label="Close"
          onPointerDown={(e) => {
            e.preventDefault();
            onClose();
          }}
          style={{
            width: 32,
            height: 32,
            border: 'none',
            background: 'transparent',
            borderRadius: 8,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <X size={18} />
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Color ${c}`}
            onPointerDown={(e) => {
              e.preventDefault();
              onChange({ color: c });
            }}
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: c,
              border: snapshot.color === c ? '2px solid #35679A' : '1px solid #D1D5DB',
              cursor: 'pointer',
            }}
          />
        ))}
        <input
          type="color"
          value={snapshot.color}
          onChange={(e) => onChange({ color: e.target.value })}
          aria-label="Custom color"
          style={{ width: 36, height: 28, border: 'none', background: 'transparent' }}
        />
      </div>

      <div style={row}>
        <span style={label}>Thickness</span>
        <input
          type="range"
          min={1}
          max={12}
          step={1}
          value={snapshot.lineWidth}
          onChange={(e) => onChange({ lineWidth: Number(e.target.value) })}
          style={{ flex: 1, accentColor: '#35679A' }}
        />
        <span style={{ fontSize: 12, fontWeight: 700, minWidth: 28, textAlign: 'right' }}>
          {snapshot.lineWidth}px
        </span>
      </div>

      <div style={row}>
        <span style={label}>Opacity</span>
        <input
          type="range"
          min={10}
          max={100}
          step={5}
          value={Math.round(snapshot.opacity * 100)}
          onChange={(e) => onChange({ opacity: Number(e.target.value) / 100 })}
          style={{ flex: 1, accentColor: '#35679A' }}
        />
        <span style={{ fontSize: 12, fontWeight: 700, minWidth: 32, textAlign: 'right' }}>
          {Math.round(snapshot.opacity * 100)}%
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        {toggleBtn(
          snapshot.spinning,
          () => onChange({ spinning: !snapshot.spinning }),
          <Sparkles size={16} />,
          'Highlight pulse',
        )}
        {toggleBtn(
          snapshot.outlineEraserEnabled,
          () => {
            const next = !snapshot.outlineEraserEnabled;
            onChange({
              outlineEraserEnabled: next,
              outlineEraserSize: next && snapshot.outlineEraserSize < 5 ? 15 : snapshot.outlineEraserSize,
            });
            if (next) onBeginOutlineEraser?.();
          },
          <Eraser size={16} />,
          'Erase part of line',
        )}
      </div>

      {snapshot.outlineEraserEnabled ? (
        <div style={{ ...row, marginTop: 4 }}>
          <span style={label}>Eraser</span>
          <input
            type="range"
            min={5}
            max={50}
            step={1}
            value={snapshot.outlineEraserSize}
            onChange={(e) => onChange({ outlineEraserSize: Number(e.target.value) })}
            style={{ flex: 1, accentColor: '#35679A' }}
          />
          <span style={{ fontSize: 12, fontWeight: 700, minWidth: 32, textAlign: 'right' }}>
            {snapshot.outlineEraserSize}px
          </span>
        </div>
      ) : null}

      {snapshot.outlineEraserEnabled ? (
        <p style={{ margin: '8px 0 0', fontSize: 11, color: '#6B7280', lineHeight: 1.4 }}>
          Drag on the line to erase part of it.
        </p>
      ) : null}
    </div>
  );
}
