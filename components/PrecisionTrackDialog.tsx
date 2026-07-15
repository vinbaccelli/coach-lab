'use client';

import React, { useState } from 'react';
import type { TrackQuality } from '@/lib/mediapipePose';

interface Props {
  scope: 'all' | 'section';
  lengthSec: number;
  onConfirm: (quality: TrackQuality) => void;
  onCancel: () => void;
}

const OPTIONS: Array<{ q: TrackQuality; speed: string; tag: string; desc: string }> = [
  { q: 'max', speed: '0.1×', tag: 'Extremely precise', desc: 'Slowest. Heavy model + refinement pass — for making a short section flawless.' },
  { q: 'balanced', speed: '0.25×', tag: 'Recommended', desc: 'Heavy model. Excellent precision at a sensible speed.' },
  { q: 'fast', speed: '0.5×', tag: 'Fastest', desc: 'Quick pass — good for a first look or a long clip.' },
];

/**
 * Explains the Precision AI Track and asks for a tracking speed. Slower =
 * denser sampling + bigger model + refinement = more precise. One button opens
 * this; the chosen speed drives the pass.
 */
export default function PrecisionTrackDialog({ scope, lengthSec, onConfirm, onCancel }: Props) {
  const [quality, setQuality] = useState<TrackQuality>('balanced');
  const secs = Math.max(0, Math.round(lengthSec));

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 420, background: '#fff', color: '#1D1D1F',
          borderRadius: 18, padding: '22px 22px 18px',
          boxShadow: '0 24px 68px rgba(0,0,0,0.4)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: -0.3 }}>AI Track</div>
        <p style={{ margin: '6px 0 4px', fontSize: 13.5, color: '#6E6E73', lineHeight: 1.4 }}>
          Records one perfect skeleton track over your video, then plays it back flawlessly
          aligned at <b>any</b> speed. Runs once now — the slower the pass, the more precise the result.
        </p>
        <div style={{ margin: '10px 0 14px', fontSize: 12.5, fontWeight: 700, color: '#007AFF' }}>
          {scope === 'section' ? `Tracking your selected section · ${secs}s` : `Tracking the whole video · ${secs}s`}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {OPTIONS.map((o) => {
            const active = quality === o.q;
            return (
              <button
                key={o.q}
                type="button"
                onClick={() => setQuality(o.q)}
                style={{
                  textAlign: 'left', padding: '11px 13px', borderRadius: 12, cursor: 'pointer',
                  border: active ? '2px solid #007AFF' : '1px solid #E5E5EA',
                  background: active ? 'rgba(0,122,255,0.06)' : '#fff',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 800 }}>{o.speed}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 999,
                    background: o.q === 'balanced' ? '#007AFF' : '#EDEDED',
                    color: o.q === 'balanced' ? '#fff' : '#6E6E73',
                  }}>{o.tag}</span>
                </div>
                <div style={{ fontSize: 12, color: '#6E6E73', marginTop: 3, lineHeight: 1.35 }}>{o.desc}</div>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              flex: '0 0 auto', padding: '11px 18px', borderRadius: 11, border: '1px solid #D1D1D6',
              background: '#fff', color: '#1D1D1F', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(quality)}
            style={{
              flex: 1, padding: '11px 18px', borderRadius: 11, border: 'none',
              background: '#007AFF', color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer',
            }}
          >
            Start AI Track
          </button>
        </div>
      </div>
    </div>
  );
}
