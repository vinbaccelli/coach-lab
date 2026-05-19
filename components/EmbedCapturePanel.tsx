'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

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

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
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
  videoDurationSec,
  onRetry,
  onStartRecording,
  onUploadInstead,
  showCaptureDownloadFallback,
  captureFallbackDownloadHref,
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
  videoDurationSec?: number | null;
  onRetry?: () => void;
  onStartRecording: (opts: {
    mode: CaptureModeChoice;
    startSec: number | null;
    endSec: number | null;
  }) => void;
  onUploadInstead?: () => void;
  showCaptureDownloadFallback?: boolean;
  captureFallbackDownloadHref?: string | null;
}) {
  const [mode, setMode] = useState<CaptureModeChoice>('full');
  const [startStr, setStartStr] = useState('0:00');
  const [endStr, setEndStr] = useState('0:30');

  const [isIOS, setIsIOS] = useState(false);
  useEffect(() => {
    setIsIOS(
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    );
  }, []);

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

  const handleStart = useCallback(() => {
    if (!captureAllowed) return;
    if (mode === 'full') {
      onStartRecording({ mode: 'full', startSec: null, endSec: null });
      return;
    }
    onStartRecording({
      mode: 'section',
      startSec: parsed.start,
      endSec: parsed.end,
    });
  }, [captureAllowed, mode, onStartRecording, parsed.end, parsed.start]);

  if (!visible) return null;

  const loadingVideo = !embedReady && !busy;
  const showCountdown = countdown != null && countdown > 0;
  const preparingCapture = busy && !showCountdown && progress01 < 0.04 && recordingElapsedSec < 3;
  const recording = busy && !showCountdown && !preparingCapture && (progress01 > 0.02 || recordingElapsedSec > 0);

  const estimatedTotalSec = mode === 'section' && parsed.start != null && parsed.end != null
    ? parsed.end - parsed.start
    : videoDurationSec ?? 0;
  const estimatedRemainingSec = estimatedTotalSec > 0 && progress01 > 0.01
    ? Math.max(0, Math.round(estimatedTotalSec * (1 - progress01)))
    : null;

  // ── iOS: show upload prompt instead of capture ──────────────────────
  if (isIOS) {
    return (
      <div
        style={{
          position: 'absolute',
          left: 12, right: 12, top: 12,
          zIndex: 85,
          maxWidth: 520,
          margin: '0 auto',
          padding: '20px 18px',
          borderRadius: 16,
          background: 'rgba(250, 249, 247, 0.94)',
          border: '1px solid #E5E5E5',
          color: '#1A1A1A',
          backdropFilter: 'blur(18px) saturate(1.2)',
          WebkitBackdropFilter: 'blur(18px) saturate(1.2)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.08)',
          pointerEvents: 'auto',
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        <p style={{ margin: '0 0 10px', fontWeight: 600, fontSize: 15 }}>
          Use all tools on this video
        </p>
        <p style={{ margin: '0 0 14px', color: '#3C3C3C' }}>
          Screen recording isn't available on this device. To use drawing tools, skeleton, and analysis on this video, download it from YouTube and upload it here.
        </p>
        {onUploadInstead && (
          <button
            type="button"
            onClick={onUploadInstead}
            style={{
              width: '100%',
              padding: '12px 16px',
              borderRadius: 12,
              border: 'none',
              background: '#1A1A1A',
              color: '#FFFFFF',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Upload a video file
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: 12, right: 12, top: 12,
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
      <style>{`
        @keyframes coachlab-spin { to { transform: rotate(360deg); } }
        @keyframes coachlab-rec-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>

      {/* ── Error state ───────────────────────────────────────────────── */}
      {errorMessage ? (
        <>
          <p style={{ margin: '0 0 10px', fontWeight: 600, fontSize: 15 }}>
            Something went wrong
          </p>
          <p style={{ margin: '0 0 14px', fontSize: 13, color: '#991b1b', lineHeight: 1.5 }}>
            {errorMessage}
          </p>
          {showCaptureDownloadFallback ? (
            <p style={{ margin: '0 0 14px', fontSize: 12, color: '#44403c', lineHeight: 1.55 }}>
              Having trouble with screen capture? You can download this video directly and upload it to
              CoachLab — it only takes a moment.
              {captureFallbackDownloadHref ? (
                <>
                  {' '}
                  <a
                    href={captureFallbackDownloadHref}
                    download
                    style={{ color: '#007AFF', fontWeight: 600 }}
                  >
                    Get a playable copy
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
          <div style={{ display: 'flex', gap: 10 }}>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  borderRadius: 10,
                  border: 'none',
                  background: '#1A1A1A',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                Try again
              </button>
            )}
            {onUploadInstead && (
              <button
                type="button"
                onClick={onUploadInstead}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  borderRadius: 10,
                  border: '1px solid #E5E5E5',
                  background: '#fff',
                  color: '#1A1A1A',
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                Upload instead
              </button>
            )}
          </div>
        </>
      ) : recording ? (
        /* ── Recording in progress ────────────────────────────────────── */
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span
              style={{
                width: 12, height: 12,
                borderRadius: '50%',
                background: '#EF4444',
                flexShrink: 0,
                animation: 'coachlab-rec-pulse 1.2s ease-in-out infinite',
              }}
            />
            <span style={{ fontWeight: 700, fontSize: 15, color: '#1A1A1A' }}>
              Recording in progress
            </span>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ height: 10, borderRadius: 6, background: '#E5E5E5', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.round(Math.min(1, Math.max(0, progress01)) * 100)}%`,
                  background: '#EF4444',
                  transition: 'width 0.15s ease-out',
                  borderRadius: 6,
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12, color: '#57534e', fontVariantNumeric: 'tabular-nums' }}>
              <span>
                {formatTime(recordingElapsedSec)} elapsed
              </span>
              {estimatedRemainingSec != null && estimatedRemainingSec > 0 && (
                <span>~{formatTime(estimatedRemainingSec)} remaining</span>
              )}
            </div>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: '#6B6B6B', textAlign: 'center' }}>
            Recording in progress — do not switch tabs
          </p>
        </>
      ) : showCountdown ? (
        /* ── Countdown ────────────────────────────────────────────────── */
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 0' }}>
          <div style={{
            width: 72, height: 72,
            borderRadius: '50%',
            background: '#1A1A1A',
            color: '#FFFFFF',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 32, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
          }}>
            {countdown}
          </div>
          <p style={{ margin: '12px 0 0', fontSize: 13, color: '#6B6B6B' }}>Starting recording...</p>
        </div>
      ) : preparingCapture || (busy && stepStatus) ? (
        /* ── Preparing / step status ──────────────────────────────────── */
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
          <span style={{
            width: 20, height: 20,
            border: '2px solid rgba(26,26,26,0.15)',
            borderTopColor: '#1A1A1A',
            borderRadius: '50%',
            animation: 'coachlab-spin 0.7s linear infinite',
          }} />
          <span style={{ fontWeight: 600, color: '#1A1A1A' }}>
            {stepStatus || 'Processing your video\u2026'}
          </span>
        </div>
      ) : loadingVideo ? (
        /* ── Loading video ────────────────────────────────────────────── */
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
          <span style={{
            width: 20, height: 20,
            border: '2px solid rgba(26,26,26,0.15)',
            borderTopColor: '#1A1A1A',
            borderRadius: '50%',
            animation: 'coachlab-spin 0.7s linear infinite',
          }} />
          <span style={{ fontWeight: 600, color: '#1A1A1A' }}>Loading video\u2026</span>
        </div>
      ) : (
        /* ── Ready: record options + Start Recording ───────────────────── */
        <>
          <p style={{ margin: '0 0 14px', fontWeight: 600, fontSize: 15 }}>
            What would you like to record?
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="radio" name="capmode" checked={mode === 'full'} onChange={() => setMode('full')} />
              <span>Record full video</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
              <input
                type="radio"
                name="capmode"
                checked={mode === 'section'}
                onChange={() => setMode('section')}
                style={{ marginTop: 3 }}
              />
              <span style={{ flex: 1 }}>
                Record a section
                {mode === 'section' && (
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8, fontWeight: 400, color: '#3C3C3C' }}>
                    <span>From</span>
                    <input
                      type="text"
                      value={startStr}
                      onChange={(e) => setStartStr(e.target.value)}
                      placeholder="1:20"
                      style={{ width: 64, padding: '5px 8px', borderRadius: 8, border: '1px solid #E5E5E5', background: '#fff', color: '#1A1A1A', fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
                    />
                    <span>to</span>
                    <input
                      type="text"
                      value={endStr}
                      onChange={(e) => setEndStr(e.target.value)}
                      placeholder="1:25"
                      style={{ width: 64, padding: '5px 8px', borderRadius: 8, border: '1px solid #E5E5E5', background: '#fff', color: '#1A1A1A', fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
                    />
                    {sectionInvalid && (
                      <span style={{ display: 'block', width: '100%', fontSize: 11, color: '#B45309' }}>
                        End time must be after start time.
                      </span>
                    )}
                    {!sectionSeekSupported && (
                      <span style={{ display: 'block', width: '100%', fontSize: 11, color: '#6B6B6B' }}>
                        Section timing works best with YouTube links.
                      </span>
                    )}
                  </span>
                )}
              </span>
            </label>
          </div>

          {genericIframeNote && (
            <p style={{ margin: '0 0 12px', fontSize: 11, color: '#6B6B6B' }}>{genericIframeNote}</p>
          )}

          <button
            type="button"
            disabled={!captureAllowed}
            onClick={handleStart}
            style={{
              width: '100%',
              padding: '16px 18px',
              borderRadius: 14,
              border: 'none',
              background: captureAllowed ? '#EF4444' : 'rgba(26,26,26,0.12)',
              color: captureAllowed ? '#FFFFFF' : 'rgba(26,26,26,0.5)',
              fontWeight: 800,
              fontSize: 17,
              cursor: captureAllowed ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              minHeight: 52,
            }}
          >
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: captureAllowed ? '#fff' : 'rgba(26,26,26,0.3)' }} />
            Start Recording
          </button>
        </>
      )}
    </div>
  );
}
