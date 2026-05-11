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
  progress01 = 0,
  recordingElapsedSec = 0,
  errorMessage,
  countdown,
  stepStatus,
  onRetry,
  onCapture,
}: {
  visible: boolean;
  embedReady: boolean;
  sectionSeekSupported: boolean;
  genericIframeNote?: string;
  busy: boolean;
  progress01?: number;
  recordingElapsedSec?: number;
  errorMessage?: string | null;
  countdown?: number | null;
  stepStatus?: string | null;
  onRetry?: () => void;
  onCapture: (opts: {
    mode: CaptureModeChoice;
    startSec: number | null;
    endSec: number | null;
  }) => void;
}) {
  const [mode, setMode] = useState<CaptureModeChoice>('full');
  const [startStr, setStartStr] = useState('0:00');
  const [endStr, setEndStr] = useState('0:30');

  const parsed = useMemo(
    () => ({
      start: parseTimeToSeconds(startStr),
      end: parseTimeToSeconds(endStr),
    }),
    [startStr, endStr],
  );

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

  const loadingVideo = !embedReady && !busy;
  const showCountdown = countdown != null && countdown > 0;
  const preparingCapture = busy && !showCountdown && progress01 < 0.04 && recordingElapsedSec < 3;
  const recording = busy && !showCountdown && !preparingCapture;

  const statusLine = (() => {
    if (errorMessage) return null;
    if (showCountdown) return null;
    if (stepStatus) return stepStatus;
    if (loadingVideo) return 'Loading video…';
    if (!embedReady) return 'Loading video…';
    if (busy && preparingCapture) return 'Preparing video for capture — please wait…';
    if (busy && recording) return 'Recording in progress…';
    if (embedReady && !busy) return 'Video ready — press Capture to begin';
    return '';
  })();

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

      {/* Countdown overlay */}
      {showCountdown && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '28px 0',
          marginBottom: 12,
        }}>
          <div style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: '#1A1A1A',
            color: '#FFFFFF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 36,
            fontWeight: 800,
            fontVariantNumeric: 'tabular-nums',
            animation: 'coachlab-countdown-pulse 1s ease-in-out infinite',
          }}>
            {countdown}
          </div>
        </div>
      )}

      <style>{`
        @keyframes coachlab-spin { to { transform: rotate(360deg); } }
        @keyframes coachlab-countdown-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }
      `}</style>

      {!showCountdown && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 12,
            minHeight: 36,
          }}
        >
          {(loadingVideo || (busy && preparingCapture) || (!embedReady && !errorMessage)) && (
            <span
              style={{
                width: 20,
                height: 20,
                border: '2px solid rgba(26,26,26,0.15)',
                borderTopColor: '#1A1A1A',
                borderRadius: '50%',
                animation: 'coachlab-spin 0.7s linear infinite',
              }}
            />
          )}
          {embedReady && !busy && !errorMessage && (
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: '#22c55e',
                flexShrink: 0,
                boxShadow: '0 0 0 3px rgba(34,197,94,0.25)',
              }}
            />
          )}
          <span style={{ fontWeight: 600, color: errorMessage ? '#b45309' : '#1A1A1A' }}>
            {errorMessage ?? statusLine}
          </span>
        </div>
      )}

      {busy && recording && (
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              height: 8,
              borderRadius: 6,
              background: '#E5E5E5',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${Math.round(Math.min(1, Math.max(0, progress01)) * 100)}%`,
                background: '#1A1A1A',
                transition: 'width 0.15s ease-out',
              }}
            />
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: '#57534e', fontVariantNumeric: 'tabular-nums' }}>
            Elapsed: {Math.floor(recordingElapsedSec / 60)}:
            {String(recordingElapsedSec % 60).padStart(2, '0')}
          </div>
        </div>
      )}

      {!errorMessage && embedReady && !busy && (
        <p style={{ margin: '0 0 12px', padding: '12px 14px', borderRadius: 12, background: 'rgba(26,26,26,0.06)', border: '1px solid #E5E5E5', opacity: 1, fontSize: 12, color: '#3C3C3C', lineHeight: 1.5 }}>
          <strong style={{ color: '#1A1A1A' }}>Before you tap Capture:</strong> your browser will ask what to share.
          Choose <strong style={{ color: '#1A1A1A' }}>This tab</strong> / <strong style={{ color: '#1A1A1A' }}>Chrome Tab</strong> — not your whole screen — so the recording matches this player.
        </p>
      )}

      {errorMessage ? (
        <div style={{ marginBottom: 14 }}>
          <p style={{ margin: '0 0 10px', fontSize: 13, color: '#991b1b', lineHeight: 1.5 }}>{errorMessage}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              style={{
                padding: '10px 16px',
                borderRadius: 10,
                border: '1px solid #E5E5E5',
                background: '#1A1A1A',
                color: '#fff',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            cursor: embedReady && !busy ? 'pointer' : 'default',
            opacity: embedReady ? 1 : 0.45,
          }}
        >
          <input
            type="radio"
            name="capmode"
            checked={mode === 'full'}
            onChange={() => setMode('full')}
            disabled={busy || !embedReady}
          />
          <span>Full video</span>
        </label>
        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            cursor: embedReady && !busy ? 'pointer' : 'default',
            opacity: embedReady ? 1 : 0.45,
          }}
        >
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
                    Move the video to where you want to begin first. Recording stops at the "Ends at" time you entered.
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
          background: captureAllowed ? '#1A1A1A' : 'rgba(26,26,26,0.12)',
          color: captureAllowed ? '#FFFFFF' : 'rgba(26,26,26,0.5)',
          fontWeight: 700,
          fontSize: 14,
          cursor: captureAllowed ? 'pointer' : 'not-allowed',
        }}
      >
        {busy ? 'Working…' : !embedReady ? 'Waiting for video…' : 'Capture'}
      </button>
      {busy && !showCountdown && recording ? (
        <p style={{ margin: '10px 0 0', fontSize: 11, color: '#6B6B6B', textAlign: 'center' }}>
          Keep this tab shared until the progress bar finishes.
        </p>
      ) : null}
    </div>
  );
}
