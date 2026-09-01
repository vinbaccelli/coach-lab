'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';
import { STROKE_PHASE_DEFINITIONS, STROKE_TYPE_LABELS } from '@/lib/biomechanics/strokePhases';
import type { StrokeType } from '@/lib/biomechanics/types';

export type PhasePreset =
  | { type: 'preset'; strokeType: Exclude<StrokeType, 'custom'>; }
  | { type: 'custom'; count: number; };

interface PhasesPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (preset: PhasePreset) => void;
}

const presets: Array<{ strokeType: Exclude<StrokeType, 'custom'>; label: string; stepCount: number }> = [
  { strokeType: 'forehand', label: '8-step Forehand', stepCount: 8 },
  { strokeType: 'two_handed_backhand', label: '8-step 2H Backhand', stepCount: 8 },
  { strokeType: 'one_handed_backhand', label: '8-step 1H Backhand', stepCount: 8 },
  { strokeType: 'serve', label: '8-step Serve', stepCount: 8 },
  { strokeType: 'volley', label: '2-step Volley', stepCount: 2 },
  { strokeType: 'smash', label: '2-step Smash', stepCount: 2 },
];

const btnStyle: React.CSSProperties = {
  width: '100%', padding: '12px 16px', borderRadius: 12,
  border: '1px solid var(--cl-border)', background: 'var(--cl-bg-panel)', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  fontSize: 14, fontWeight: 600, color: 'var(--cl-text-primary)',
};

export default function PhasesPicker({ open, onClose, onSelect }: PhasesPickerProps) {
  const [customCount, setCustomCount] = useState(4);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9600,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.68)',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: 'min(400px, 90vw)', maxHeight: '80vh', overflow: 'auto',
        background: 'var(--cl-bg-panel)', borderRadius: 20, padding: 24,
        boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--cl-text-primary)' }}>Add Phases</h2>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--cl-text-muted)' }}>
            <X size={20} />
          </button>
        </div>

        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--cl-text-secondary)', lineHeight: 1.5 }}>
          Choose a stroke preset or custom count. Phase markers will appear on the timeline — drag to adjust positions.
        </p>

        {/* Custom count — first option */}
        <div style={{
          padding: 16, borderRadius: 14, border: '1px solid var(--cl-accent)', background: 'rgba(0,122,255,0.04)',
          display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16,
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--cl-text-primary)' }}>Custom</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input
              type="range" min={1} max={20} step={1}
              value={customCount} onChange={e => setCustomCount(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--cl-accent)', minWidth: 28, textAlign: 'center' }}>{customCount}</span>
          </div>
          <button
            type="button"
            onClick={() => { onSelect({ type: 'custom', count: customCount }); onClose(); }}
            style={{
              width: '100%', padding: '10px 0', borderRadius: 10, border: 'none',
              background: 'var(--cl-accent)', color: 'var(--cl-text-on-fill)', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}
          >
            Add {customCount} phase{customCount > 1 ? 's' : ''}
          </button>
        </div>

        {/* Stroke presets */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {presets.map(p => {
            const steps = STROKE_PHASE_DEFINITIONS[p.strokeType];
            return (
              <button
                key={p.strokeType}
                type="button"
                style={btnStyle}
                onClick={() => { onSelect({ type: 'preset', strokeType: p.strokeType }); onClose(); }}
              >
                <span>{p.label}</span>
                <span style={{ fontSize: 11, color: 'var(--cl-text-muted)', fontWeight: 500 }}>
                  {steps.map(s => s.short).join(' → ')}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
