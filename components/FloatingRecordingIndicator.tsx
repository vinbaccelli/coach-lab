'use client';

import React, { useCallback, useState } from 'react';
import { useRecording } from '@/contexts/RecordingContext';
import { Square, Pause, Play, Circle } from 'lucide-react';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function FloatingRecordingIndicator() {
  const { recState, elapsed, stopRecording, pauseRecording } = useRecording();
  const [stopping, setStopping] = useState(false);

  const handleStop = useCallback(async () => {
    setStopping(true);
    await stopRecording();
    setStopping(false);
  }, [stopRecording]);

  if (recState !== 'recording' && recState !== 'paused') return null;

  const isRecording = recState === 'recording';

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 14px 8px 12px',
        borderRadius: 40,
        background: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.1)',
        color: '#fff',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        userSelect: 'none',
      }}
    >
      {/* Pulsing red dot */}
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: isRecording ? '#FF3B30' : '#FFCC00',
          flexShrink: 0,
          animation: isRecording ? 'pulse-dot 1.2s ease-in-out infinite' : 'none',
        }}
      />

      {/* Timer */}
      <span style={{
        fontSize: 14,
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        minWidth: 40,
        letterSpacing: 0.5,
      }}>
        {formatTime(elapsed)}
      </span>

      {/* Pause / Resume */}
      <button
        type="button"
        onClick={pauseRecording}
        aria-label={isRecording ? 'Pause recording' : 'Resume recording'}
        title={isRecording ? 'Pause' : 'Resume'}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 32,
          height: 32,
          borderRadius: '50%',
          border: '1px solid rgba(255,255,255,0.2)',
          background: 'rgba(255,255,255,0.1)',
          color: '#fff',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        {isRecording ? <Pause size={14} /> : <Play size={14} />}
      </button>

      {/* Stop */}
      <button
        type="button"
        onClick={handleStop}
        disabled={stopping}
        aria-label="Stop recording"
        title="Stop recording"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 32,
          height: 32,
          borderRadius: '50%',
          border: 'none',
          background: '#FF3B30',
          color: '#fff',
          cursor: stopping ? 'not-allowed' : 'pointer',
          padding: 0,
          opacity: stopping ? 0.5 : 1,
        }}
      >
        <Square size={12} fill="#fff" />
      </button>

      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
