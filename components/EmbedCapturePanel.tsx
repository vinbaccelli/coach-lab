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
  embedReady,
  sectionSeekSupported,
  genericIframeNote,
  busy,
  onCapture,
}: {
  visible: boolean;
  /** When false, Capture stays disabled and panel shows a loading state */
  embedReady: boolean;
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

  const captureAllowed =
    embedReady && !busy && !sectionInvalid && !(mode === 'section' && (parsed.start === null || parsed.end === null));

  const handleCapture = useCallback(() => {
    if (!captureAllowed) return;
    if (mode === 'full') {
      onCapture({ mode: 'full', startSec: null, endSec: null });
      return;
    }
    onCapture({
      mode: 'section',
      startSec: parsed.start,
      endSec: parsed.end,
    });
  }, [captureAllowed, mode, onCapture, parsed.end, parsed.start]);

  if (!visible) return null;

  const panelBusyOrLoading = busy || !embedReady;

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
        padding: '18px 18px',
        borderRadius: 16,
        background: 'rgba(250, 249, 247, 0.94)',
        border: '1px solid #E5E5E5',
        color: '#1A1A1A',
        backdropFilter: 'blur(18px) saturate(1.2)',
        WebkitBackdropFilter: 'blur(18px) saturate(1.2)',
        boxShadow: '0 12px 40px rgba(0,0,0,0.08)',
        pointerEvents: 'auto',
        fontSize: 13,
        lineHeight: 1.45,
      }}
    >
      <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 15, color: '#1A1A1A' }}>
        Record this video for analysis
      </p>

      {!embedReady ? (
        <p style={{ margin: '0 0 14px', fontSize: 13, color: '#6B6B6B', fontWeight: 500 }}>
          Loading video…
        </p>
      ) : (
        <>
          <p style={{ margin: '0 0 10px', opacity: 0.88, fontSize: 12, color: '#3C3C3C' }}>
            When you tap Capture, your browser will ask what to share. Choose{' '}
            <strong style={{ color: '#1A1A1A' }}>This tab</strong> (sometimes labelled “Chrome Tab”) — not your whole screen — so only this page is recorded.
          </p>
          <p style={{ margin: '0 0 14px', opacity: 0.82, fontSize: 11.5, color: '#5C5C5C' }}>
            Then tap <strong style={{ color: '#1A1A1A' }}>Allow</strong>. You&apos;ll see the live picture here while we finish recording.
          </p>
        </>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: embedReady && !busy ? 'pointer' : 'default', opacity: embedReady ? 1 : 0.45 }}>
          <input
            type="radio"
            name="capmode"
            checked={mode === 'full'}
            onChange={() => setMode('full')}
            disabled={busy || !embedReady}
          />
          <span>Full video</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: embedReady && !busy ? 'pointer' : 'default', opacity: embedReady ? 1 : 0.45 }}>
          <input
            type="radio"
            name="capmode"
            checked={mode === 'section'}
            onChange={() => setMode('section')}
            disabled={busy || !embedReady}
            style={{ marginTop: 3 }}
          />
          <span style={{ flex: 1 }}>
            Part of the video
            {mode === 'section' && (
              <span style={{ display: 'block', marginTop: 8, fontWeight: 400, color: '#3C3C3C' }}>
                <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <span>Starts at</span>
                  <input
                    type="text"
                    value={startStr}
                    onChange={(e) => setStartStr(e.target.value)}
                    placeholder="1:20"
                    disabled={busy || !embedReady}
                    style={{
                      width: 72,
                      padding: '6px 8px',
                      borderRadius: 8,
                      border: '1px solid #E5E5E5',
                      background: '#FFFFFF',
                      color: '#1A1A1A',
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
                    disabled={busy || !embedReady}
                    style={{
                      width: 72,
                      padding: '6px 8px',
                      borderRadius: 8,
                      border: '1px solid #E5E5E5',
                      background: '#FFFFFF',
                      color: '#1A1A1A',
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: 13,
                    }}
                  />
                </span>
                {!sectionSeekSupported && (
                  <span style={{ display: 'block', marginTop: 6, fontSize: 11, color: '#6B6B6B' }}>
                    Move the video to where you want to begin first. Recording stops automatically at the “Ends at” time you entered.
                  </span>
                )}
                {sectionInvalid && (
                  <span style={{ display: 'block', marginTop: 6, fontSize: 11, color: '#B45309' }}>
                    The end time needs to come after the start time.
                  </span>
                )}
              </span>
            )}
          </span>
        </label>
      </div>

      {genericIframeNote ? (
        <p style={{ margin: '0 0 12px', fontSize: 11, color: '#6B6B6B' }}>{genericIframeNote}</p>
      ) : null}

      <button
        type="button"
        disabled={!captureAllowed}
        onClick={handleCapture}
        style={{
          width: '100%',
          padding: '12px 16px',
          borderRadius: 12,
          border: '1px solid #E5E5E5',
          background: captureAllowed ? '#1A1A1A' : 'rgba(26,26,26,0.15)',
          color: captureAllowed ? '#FFFFFF' : 'rgba(26,26,26,0.45)',
          fontWeight: 700,
          fontSize: 14,
          cursor: captureAllowed ? 'pointer' : 'not-allowed',
        }}
      >
        {busy ? 'Recording…' : !embedReady ? 'Loading video…' : 'Capture'}
      </button>
      {panelBusyOrLoading && embedReady && busy ? (
        <p style={{ margin: '10px 0 0', fontSize: 11, color: '#6B6B6B', textAlign: 'center' }}>
          Finish sharing only when the clip completes or you stop recording from the browser bar.
        </p>
      ) : null}
    </div>
  );
}
