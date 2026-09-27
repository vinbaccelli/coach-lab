'use client';

/**
 * RecordingControlBar — in-page recording controls for the analysis page.
 *
 * WHY IT EXISTS. The recording's only always-available controls used to be the
 * Recording Hub panel (reachable only by navigating BACK into that panel) and
 * the floating Document PiP window. In a whole-screen share that window is
 * deliberately controls-only and the coach may close it, and closing it no
 * longer turns the webcam off (see the pagehide handler in
 * contexts/RecordingContext.tsx) — so there has to be a Pause/Resume/Stop that
 * is reachable from WHEREVER the coach currently is: Metrics, Motion Layer,
 * Draw, any tool or panel.
 *
 * PLACEMENT. Rendered as the first flex child of the analysis page root, ABOVE
 * the toolbar-rail + canvas row. It is normal flow (`flex: 0 0 auto`), NOT
 * position:fixed/absolute, so it occupies page chrome and the workspace below
 * shrinks by exactly its height. It never paints over the video/canvas — that
 * is the whole difference from FloatingRecordingIndicator, which floats over
 * the workspace at the bottom of the viewport.
 *
 * It exists ONLY during an active recording: null while idle/stopped, so the
 * workspace gets its full height back the moment the recording ends.
 *
 * LAYOUT CONTRACT — VERTICAL ONLY. Every BUTTON is its own full-width row;
 * two buttons are never placed side by side. That is a deliberate constraint,
 * not an oversight: one column works unchanged from a phone at 320px CSS px up
 * to a desktop, so no separate mobile layout is needed. If you add a control
 * here, add it as another row — never as a sibling in a horizontal group.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useRecording } from '@/contexts/RecordingContext';
import { Pause, Play, Square } from 'lucide-react';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** One full-width row. Buttons are never laid out beside each other. */
const rowButtonStyle = (opts: {
  background: string;
  border: string;
  color: string;
  disabled: boolean;
}): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  width: '100%',
  // 44px keeps every row a comfortable touch target on a phone.
  minHeight: 44,
  padding: '8px 12px',
  borderRadius: 10,
  border: opts.border,
  background: opts.background,
  color: opts.color,
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: 0.2,
  cursor: opts.disabled ? 'not-allowed' : 'pointer',
  opacity: opts.disabled ? 0.45 : 1,
  touchAction: 'manipulation',
});

export default function RecordingControlBar() {
  const {
    recState,
    elapsed,
    pauseRecording,
    stopRecording,
    registerInlineRecordingControls,
  } = useRecording();
  const [stopping, setStopping] = useState(false);

  const visible = recState === 'recording' || recState === 'paused';

  // Tell the provider the page owns the controls while this bar is actually on
  // screen, so FloatingRecordingIndicator stands down and the coach is never
  // offered two competing Stop buttons. Registration is ref-counted and tied to
  // visibility, so the floating widget returns as soon as this bar goes away.
  useEffect(() => {
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

  return (
    <div
      role="group"
      aria-label="Recording controls"
      data-tour-id="tour-recording-control-bar"
      style={{
        flex: '0 0 auto',
        display: 'flex',
        // VERTICAL ONLY — see the layout contract above.
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 6,
        padding: '8px 12px',
        // Clears a phone's status-bar / notch when the page is the top surface.
        paddingTop: 'calc(8px + env(safe-area-inset-top, 0px))',
        background: '#0b0b0c',
        borderBottom: '1px solid rgba(255,255,255,0.12)',
        color: '#fff',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        userSelect: 'none',
      }}
    >
      {/* Status row — not buttons, so the dot and timer may share a line. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 20 }}>
        <span
          aria-hidden
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            flexShrink: 0,
            background: isRecording ? 'var(--cl-destructive, #FF3B30)' : '#FFCC00',
            animation: isRecording ? 'recbar-pulse 1.2s ease-in-out infinite' : 'none',
          }}
        />
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase' }}>
          {isRecording ? 'Recording' : 'Paused'}
        </span>
        <span
          aria-label="Elapsed recording time"
          style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginLeft: 'auto' }}
        >
          {formatTime(elapsed)}
        </span>
      </div>

      {/* Row 1 — Pause */}
      <button
        type="button"
        onClick={pauseRecording}
        disabled={!isRecording}
        aria-label="Pause recording"
        style={rowButtonStyle({
          background: 'rgba(255,255,255,0.10)',
          border: '1px solid rgba(255,255,255,0.22)',
          color: '#fff',
          disabled: !isRecording,
        })}
      >
        <Pause size={15} aria-hidden />
        Pause
      </button>

      {/* Row 2 — Play / Resume */}
      <button
        type="button"
        onClick={pauseRecording}
        disabled={isRecording}
        aria-label="Resume recording"
        style={rowButtonStyle({
          background: 'rgba(255,255,255,0.10)',
          border: '1px solid rgba(255,255,255,0.22)',
          color: '#fff',
          disabled: isRecording,
        })}
      >
        <Play size={15} aria-hidden />
        Resume
      </button>

      {/* Row 3 — Stop */}
      <button
        type="button"
        onClick={handleStop}
        disabled={stopping}
        aria-label="Stop recording"
        style={rowButtonStyle({
          background: 'var(--cl-destructive, #FF3B30)',
          border: 'none',
          color: '#fff',
          disabled: stopping,
        })}
      >
        <Square size={13} fill="currentColor" aria-hidden />
        {stopping ? 'Stopping…' : 'Stop'}
      </button>

      <style>{`
        @keyframes recbar-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
