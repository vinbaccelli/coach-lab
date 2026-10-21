'use client';

import React, { useState } from 'react';
import type { TrackQuality } from '@/lib/mediapipePose';
import { defaultScope, scopeChoiceLabels, type TrackScope } from '@/lib/aiTrackScope';

interface Props {
  /** Length of the selected timeline section, or null when none is selected (or it is the whole video). */
  sectionSec: number | null;
  /** Length of the whole video. */
  wholeSec: number;
  onConfirm: (quality: TrackQuality, scope: TrackScope) => void;
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
export default function PrecisionTrackDialog({ sectionSec, wholeSec, onConfirm, onCancel }: Props) {
  const [quality, setQuality] = useState<TrackQuality>('balanced');
  // Starts on the section when there is one; nothing is remembered between runs.
  const [scope, setScope] = useState<TrackScope>(defaultScope(sectionSec));
  const secs = Math.max(0, Math.round(scope === 'section' && sectionSec != null ? sectionSec : wholeSec));
  const labels = sectionSec != null ? scopeChoiceLabels(sectionSec) : null;

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 420, background: 'var(--cl-bg-panel)', color: 'var(--cl-text-primary)',
          borderRadius: 18, padding: '22px 22px 18px',
          boxShadow: '0 24px 68px rgba(0,0,0,0.4)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: -0.3 }}>AI Track</div>
        <p style={{ margin: '6px 0 4px', fontSize: 13.5, color: 'var(--cl-text-secondary)', lineHeight: 1.4 }}>
          Records one perfect skeleton track over your video, then plays it back flawlessly
          aligned at <b>any</b> speed. Runs once now — the slower the pass, the more precise the result.
        </p>
        {labels ? (
          <div role="radiogroup" aria-label="What to track" data-testid="track-scope" style={{ display: 'flex', gap: 8, margin: '10px 0 14px' }}>
            {([['section', labels.section], ['all', labels.all]] as const).map(([k, text]) => {
              const on = scope === k;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  data-testid={`track-scope-${k}`}
                  onClick={() => setScope(k)}
                  style={{
                    flex: 1, minHeight: 44, padding: '8px 10px', borderRadius: 10, cursor: 'pointer',
                    fontSize: 13, fontWeight: 700, color: 'var(--cl-text-primary)',
                    border: on ? '2px solid var(--cl-accent)' : '1px solid var(--cl-border)',
                    background: on ? 'rgba(0,122,255,0.06)' : 'var(--cl-bg-panel)',
                  }}
                >
                  {text}
                </button>
              );
            })}
          </div>
        ) : (
          <div style={{ margin: '10px 0 14px', fontSize: 12.5, fontWeight: 700, color: 'var(--cl-accent)' }}>
            {`Tracking the whole video · ${secs}s`}
          </div>
        )}

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
                  border: active ? '2px solid var(--cl-accent)' : '1px solid var(--cl-border)',
                  background: active ? 'rgba(0,122,255,0.06)' : 'var(--cl-bg-panel)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 800 }}>{o.speed}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 999,
                    background: o.q === 'balanced' ? 'var(--cl-accent)' : 'var(--cl-fill-inactive)',
                    color: o.q === 'balanced' ? 'var(--cl-text-on-fill)' : 'var(--cl-text-secondary)',
                  }}>{o.tag}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--cl-text-secondary)', marginTop: 3, lineHeight: 1.35 }}>{o.desc}</div>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              flex: '0 0 auto', padding: '11px 18px', borderRadius: 11, border: '1px solid var(--cl-border)',
              background: 'var(--cl-bg-panel)', color: 'var(--cl-text-primary)', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(quality, scope)}
            style={{
              flex: 1, padding: '11px 18px', borderRadius: 11, border: 'none',
              background: 'var(--cl-accent)', color: 'var(--cl-text-on-fill)', fontSize: 14, fontWeight: 800, cursor: 'pointer',
            }}
          >
            Start AI Track
          </button>
        </div>
      </div>
    </div>
  );
}
