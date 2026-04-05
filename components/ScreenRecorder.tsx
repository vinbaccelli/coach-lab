'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { webmFixDuration } from 'webm-fix-duration';

interface ScreenRecorderProps {
  getCanvas: () => HTMLCanvasElement | null;
  getWebcamStream: () => MediaStream | null;
}

type RecState = 'idle' | 'recording' | 'stopped';

function getBestMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  for (const t of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
  }
  return 'video/webm';
}

function formatHMS(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

export default function ScreenRecorder({ getCanvas, getWebcamStream }: ScreenRecorderProps) {
  const [recState, setRecState] = useState<RecState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Stable refs — captureStream is called once and held here forever
  const streamRef       = useRef<MediaStream | null>(null);
  const recorderRef     = useRef<MediaRecorder | null>(null);
  const chunksRef       = useRef<BlobPart[]>([]);
  const startTimeRef    = useRef<number>(0);
  const timerRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeTypeRef     = useRef('video/webm');

  // Clean up timer on unmount
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    setElapsed(0);

    const canvas = getCanvas();
    if (!canvas) {
      setError('No canvas found. Load a video first.');
      return;
    }

    // Capture canvas stream ONCE and hold in ref
    if (!streamRef.current) {
      streamRef.current = (canvas as unknown as { captureStream(fps: number): MediaStream }).captureStream(30);
    }

    const tracks: MediaStreamTrack[] = [...streamRef.current.getTracks()];

    // Add webcam audio if available
    const webcamStream = getWebcamStream();
    if (webcamStream) {
      webcamStream.getAudioTracks().forEach(t => tracks.push(t));
    }

    const combined = new MediaStream(tracks);
    const mimeType = getBestMimeType();
    mimeTypeRef.current = mimeType;

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(combined, {
        mimeType: mimeType || undefined,
        videoBitsPerSecond: 5_000_000,
      });
    } catch (err) {
      setError('MediaRecorder not supported in this browser.');
      console.error('[ScreenRecorder] MediaRecorder init failed:', err);
      return;
    }

    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      const duration = Date.now() - startTimeRef.current;
      const rawBlob = new Blob(chunksRef.current, { type: mimeTypeRef.current || 'video/webm' });

      let finalBlob: Blob;
      try {
        finalBlob = await webmFixDuration(rawBlob, duration, mimeTypeRef.current || 'video/webm');
      } catch {
        finalBlob = rawBlob;
      }

      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const url = URL.createObjectURL(finalBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `coach-lab-${ts}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

      setRecState('idle');
    };

    recorder.start(1000); // timeslice = 1 s chunks
    recorderRef.current = recorder;
    startTimeRef.current = Date.now();
    setRecState('recording');

    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
  }, [getCanvas, getWebcamStream]);

  const stopRecording = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      setRecState('stopped');
    }
  }, []);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      {recState === 'idle' && (
        <button
          onClick={startRecording}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            borderRadius: '6px',
            border: '1px solid #E8E8ED',
            background: '#fff',
            cursor: 'pointer',
            fontSize: '13px',
            color: '#1D1D1F',
            fontWeight: 500,
          }}
          title="Start screen recording"
        >
          <span style={{ color: '#FF3B30', fontSize: '16px' }}>&#9210;</span>
          Record
        </button>
      )}

      {recState === 'recording' && (
        <>
          {/* Pulsing red dot + timer */}
          <span
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              background: '#FF3B30',
              animation: 'pulse 1.2s ease-in-out infinite',
              flexShrink: 0,
            }}
          />
          <span style={{ fontFamily: 'monospace', fontSize: '13px', color: '#FF3B30', fontWeight: 700 }}>
            {formatHMS(elapsed)}
          </span>
          <button
            onClick={stopRecording}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #FF3B30',
              background: '#FF3B30',
              cursor: 'pointer',
              fontSize: '13px',
              color: '#fff',
              fontWeight: 500,
            }}
            title="Stop recording and save"
          >
            <span>&#9632;</span> Stop
          </button>
        </>
      )}

      {recState === 'stopped' && (
        <span style={{ fontSize: '12px', color: '#35679A' }}>Saving recording\u2026</span>
      )}

      {error && (
        <span style={{ fontSize: '11px', color: '#FF3B30', maxWidth: '180px' }}>{error}</span>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.85); }
        }
      `}</style>
    </div>
  );
}
