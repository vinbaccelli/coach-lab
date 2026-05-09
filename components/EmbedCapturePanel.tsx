'use client';

import React, { useCallback, useMemo, useState } from 'react';

/** Parse "1:20", "01:25:30", or "90" seconds */
export function parseTimeToSeconds(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const parts = t.split(':').map((p) => Number(p.trim()));
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export type CaptureModeChoice = 'full' | 'section';

export default function EmbedCapturePanel({
  visible,
  sectionSeekSupported,
  genericIframeNote,
  busy,
  onCapture,
}: {
  visible: boolean;
  /** When false (e.g. Instagram iframe), section shows times as hints only — user scrubs manually */
  sectionSeekSupported: boolean;
  genericIframeNote?: string;
  busy: boolean;
  onCapture: (opts: {
    mode: CaptureModeChoice;
    startSec: number | null;
    endSec: number | null;
  }) => void;
}) {
  const [mode, setMode] = useState<CaptureModeChoice>('full');
  const [startStr, setStartStr] = useState('0:00');
  const [endStr, setEndStr] = useState('0:30');

  const parsed = useMemo(() => ({
    start: parseTimeToSeconds(startStr),
    end: parseTimeToSeconds(endStr),
  }), [startStr, endStr]);

  const sectionInvalid =
    mode === 'section' &&
    parsed.start !== null &&
    parsed.end !== null &&
    parsed.end <= parsed.start;

  const handleCapture = useCallback(() => {
    if (busy || sectionInvalid) return;
    if (mode === 'full') {
      onCapture({ mode: 'full', startSec: null, endSec: null });
      return;
    }
    onCapture({
      mode: 'section',
      startSec: parsed.start,
      endSec: parsed.end,
    });
  }, [busy, mode, onCapture, parsed.end, parsed.start, sectionInvalid]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: 12,
        right: 12,
        top: 12,
        zIndex: 85,
        maxWidth: 520,
        maxHeight: 'min(70vh, calc(100% - 24px))',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        margin: '0 auto',
        padding: '14px 16px',
        borderRadius: 14,
        background: 'rgba(15, 15, 18, 0.92)',
        border: '1px solid rgba(255,255,255,0.14)',
        color: '#fff',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
        pointerEvents: 'auto',
        fontSize: 13,
        lineHeight: 1.45,
      }}
    >
      <p style={{ margin: '0 0 12px', opacity: 0.92, fontWeight: 600 }}>
        Record this video for analysis
      </p>
      <p style={{ margin: '0 0 10px', opacity: 0.78, fontSize: 12 }}>
        When you tap Capture, your browser will ask what to share. Choose{' '}
        <strong style={{ opacity: 1 }}>This tab</strong> (sometimes labelled “Chrome Tab”) — not your whole screen — so only this page is recorded.
      </p>
      <p style={{ margin: '0 0 14px', opacity: 0.72, fontSize: 11.5 }}>
        Then tap <strong style={{ opacity: 0.95 }}>Allow</strong>. You&apos;ll see the live picture here right away while we finish recording.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <input
            type="radio"
            name="capmode"
            checked={mode === 'full'}
            onChange={() => setMode('full')}
            disabled={busy}
          />
          <span>Full video</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
          <input
            type="radio"
            name="capmode"
            checked={mode === 'section'}
            onChange={() => setMode('section')}
            disabled={busy}
            style={{ marginTop: 3 }}
          />
          <span style={{ flex: 1 }}>
            Part of the video
            {mode === 'section' && (
              <span style={{ display: 'block', marginTop: 8, fontWeight: 400, opacity: 0.88 }}>
                <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <span>Starts at</span>
                  <input
                    type="text"
                    value={startStr}
                    onChange={(e) => setStartStr(e.target.value)}
                    placeholder="1:20"
                    disabled={busy}
                    style={{
                      width: 72,
                      padding: '6px 8px',
                      borderRadius: 8,
                      border: '1px solid rgba(255,255,255,0.2)',
                      background: 'rgba(255,255,255,0.08)',
                      color: '#fff',
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: 13,
                    }}
                  />
                  <span>Ends at</span>
                  <input
                    type="text"
                    value={endStr}
                    onChange={(e) => setEndStr(e.target.value)}
                    placeholder="1:25"
                    disabled={busy}
                    style={{
                      width: 72,
                      padding: '6px 8px',
                      borderRadius: 8,
                      border: '1px solid rgba(255,255,255,0.2)',
                      background: 'rgba(255,255,255,0.08)',
                      color: '#fff',
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: 13,
                    }}
                  />
                </span>
                {!sectionSeekSupported && (
                  <span style={{ display: 'block', marginTop: 6, fontSize: 11, opacity: 0.65 }}>
                    Move the video to where you want to begin first. Recording stops automatically at the “Ends at” time you entered.
                  </span>
                )}
                {sectionInvalid && (
                  <span style={{ display: 'block', marginTop: 6, fontSize: 11, color: '#fca5a5' }}>
                    The end time needs to come after the start time.
                  </span>
                )}
              </span>
            )}
          </span>
        </label>
      </div>

      {genericIframeNote ? (
        <p style={{ margin: '0 0 12px', fontSize: 11, opacity: 0.65 }}>{genericIframeNote}</p>
      ) : null}

      <button
        type="button"
        disabled={busy || sectionInvalid || (mode === 'section' && (parsed.start === null || parsed.end === null))}
        onClick={handleCapture}
        style={{
          width: '100%',
          padding: '12px 16px',
          borderRadius: 10,
          border: 'none',
          background: busy ? 'rgba(53,103,154,0.45)' : '#35679A',
          color: '#fff',
          fontWeight: 700,
          fontSize: 14,
          cursor: busy || sectionInvalid ? 'not-allowed' : 'pointer',
        }}
      >
        {busy ? 'Waiting for your browser…' : 'Capture'}
      </button>
    </div>
  );
}
