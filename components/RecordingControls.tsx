'use client';

/**
 * RecordingControls — compact Pause/Resume + Stop + status for the analysis page.
 *
 * WHY IT EXISTS. During a recording the coach needs a Pause/Resume/Stop that is
 * reachable from WHEREVER they are — Metrics, Motion Layer, Draw, any tool or
 * panel — without navigating back into the Recording Hub. (The floating
 * Document PiP window has its own controls, but the coach may close it, and in
 * a whole-screen share it is deliberately controls-only.)
 *
 * PLACEMENT. Rendered INSIDE the video-slot action row at the top-right of
 * video panel A (renderVideoSlotPills in app/analysis/page.tsx), left of
 * "Remove A" / "+ Add B". That row is the same on every tool screen, and the
 * page shows it during any recording even with no video loaded, so this one
 * spot covers every screen and state. It replaced a full-width bar above the
 * workspace that cost ~140px of canvas height for three controls.
 *
 * SIZING follows that row's pills exactly (34px tall, fully rounded, 12px bold)
 * so the row reads as one set of controls. With `iconOnly` (the phone toolbar
 * layout, where "Remove A" is also icon-only) the buttons drop their labels and
 * the status chip shortens to "REC" / "PAUSED" — the timer always stays.
 *
 * It exists ONLY during an active recording: null while idle/stopped.
 */

import React, { useCallback, useLayoutEffect, useState } from 'react';
import { useRecording } from '@/contexts/RecordingContext';
import { Pause, Play, Square } from 'lucide-react';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Matches slotPillStyle in app/analysis/page.tsx (the row this sits in). */
const pillBase: React.CSSProperties = {
  pointerEvents: 'auto',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 5,
  minHeight: 34,
  minWidth: 34,
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 700,
  color: '#fff',
  boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
  touchAction: 'manipulation',
  whiteSpace: 'nowrap',
  userSelect: 'none',
};

export default function RecordingControls({ iconOnly = false }: { iconOnly?: boolean }) {
  const {
    recState,
    elapsed,
    pauseRecording,
    stopRecording,
    registerInlineRecordingControls,
  } = useRecording();
  const [stopping, setStopping] = useState(false);

  const visible = recState === 'recording' || recState === 'paused';

  // Tell the provider the page owns the controls while these are on screen, so
  // FloatingRecordingIndicator stands down and the coach is never offered two
  // competing Stop buttons. Ref-counted and tied to visibility, so the floating
  // widget returns as soon as these go away. A LAYOUT effect, not a plain one:
  // both read the same recState, so on the first recording commit the widget
  // renders too, and a passive effect runs after the browser paints — the
  // widget flashed for exactly one frame at every recording start.
  useLayoutEffect(() => {
    if (!visible) return;
    return registerInlineRecordingControls();
  }, [visible, registerInlineRecordingControls]);

  const handleStop = useCallback(async () => {
    setStopping(true);
    try {
      await stopRecording();
    } finally {
      setStopping(false);
    }
  }, [stopRecording]);

  if (!visible) return null;

  const isRecording = recState === 'recording';
  const buttonPadding = iconOnly ? '6px 8px' : '6px 12px';

  return (
    <div
      role="group"
      aria-label="Recording controls"
      data-tour-id="tour-recording-controls"
      // Kept together when the slot row wraps on a narrow panel.
      style={{ display: 'inline-flex', gap: 6, flexWrap: 'nowrap', pointerEvents: 'none' }}
    >
      {/* Status — not a button: dot + state + timer. */}
      <span
        role="status"
        style={{
          ...pillBase,
          padding: iconOnly ? '6px 10px' : '6px 12px',
          border: '1px solid rgba(255,255,255,0.35)',
          background: 'rgba(0,0,0,0.72)',
          cursor: 'default',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            flexShrink: 0,
            background: isRecording ? 'var(--cl-destructive, #FF3B30)' : '#FFCC00',
            animation: isRecording ? 'recctl-pulse 1.2s ease-in-out infinite' : 'none',
          }}
        />
        <span style={{ letterSpacing: 0.3 }}>
          {iconOnly ? (isRecording ? 'REC' : 'PAUSED') : isRecording ? 'Recording' : 'Paused'}
        </span>
        <span aria-label="Elapsed recording time" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatTime(elapsed)}
        </span>
      </span>

      {/* Pause / Resume — one toggle (pauseRecording already toggles). */}
      <button
        type="button"
        onClick={pauseRecording}
        aria-label={isRecording ? 'Pause recording' : 'Resume recording'}
        aria-pressed={!isRecording}
        title={isRecording ? 'Pause recording' : 'Resume recording'}
        style={{
          ...pillBase,
          padding: buttonPadding,
          border: '1px solid rgba(255,255,255,0.35)',
          background: 'rgba(0,0,0,0.72)',
          cursor: 'pointer',
        }}
      >
        {isRecording ? <Pause size={16} strokeWidth={2.25} aria-hidden /> : <Play size={16} strokeWidth={2.25} aria-hidden />}
        {iconOnly ? null : isRecording ? 'Pause' : 'Resume'}
      </button>

      {/* Stop */}
      <button
        type="button"
        onClick={handleStop}
        disabled={stopping}
        aria-label="Stop recording"
        title="Stop recording"
        style={{
          ...pillBase,
          padding: buttonPadding,
          border: '1px solid rgba(255,59,48,0.65)',
          background: 'var(--cl-destructive, #FF3B30)',
          cursor: stopping ? 'not-allowed' : 'pointer',
          opacity: stopping ? 0.5 : 1,
        }}
      >
        <Square size={13} fill="currentColor" aria-hidden />
        {iconOnly ? null : stopping ? 'Stopping…' : 'Stop'}
      </button>

      <style>{`
        @keyframes recctl-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
