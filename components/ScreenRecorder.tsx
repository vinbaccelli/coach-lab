'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { webmFixDuration } from 'webm-fix-duration';

interface ScreenRecorderProps {
  getCanvas: () => HTMLCanvasElement | null;
  getWebcamStream: () => MediaStream | null;
  getMicStream?: () => MediaStream | null;
  getCropRegion?: () => { x: number; y: number; w: number; h: number } | null;
  layoutMode?: 'youtube' | 'reels';
  onRecordingChange?: (recording: boolean) => void;
}

type RecState = 'idle' | 'recording' | 'stopped';

function getBestMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
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

export default function ScreenRecorder({
  getCanvas,
  getWebcamStream,
  getMicStream,
  getCropRegion,
  layoutMode = 'youtube',
  onRecordingChange,
}: ScreenRecorderProps) {
  const [recState, setRecState] = useState<RecState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const paintTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const recCanvasRef    = useRef<HTMLCanvasElement | null>(null);
  const streamRef       = useRef<MediaStream | null>(null);
  const recorderRef     = useRef<MediaRecorder | null>(null);
  const chunksRef       = useRef<BlobPart[]>([]);
  const startTimeRef    = useRef<number>(0);
  const timerRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeTypeRef     = useRef('video/webm');

  // Clean up timer on unmount
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (paintTimerRef.current) clearInterval(paintTimerRef.current);
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    setElapsed(0);
    setProgress(null);

    const srcCanvas = getCanvas();
    if (!srcCanvas) {
      setError('No canvas found. Load a video first.');
      return;
    }

    // Build a dedicated recording canvas so we can render in layout-specific aspect ratios.
    const outW = layoutMode === 'reels' ? 1080 : 1920;
    const outH = layoutMode === 'reels' ? 1920 : 1080;
    const recCanvas = document.createElement('canvas');
    recCanvas.width = outW;
    recCanvas.height = outH;
    recCanvasRef.current = recCanvas;
    const ctx = recCanvas.getContext('2d')!;

    // Paint loop: letterbox/pillarbox the source canvas into the output canvas.
    if (paintTimerRef.current) clearInterval(paintTimerRef.current);
    paintTimerRef.current = setInterval(() => {
      const src = getCanvas();
      if (!src) return;
      const crop = getCropRegion?.();
      const sx0 = crop ? crop.x * src.width : 0;
      const sy0 = crop ? crop.y * src.height : 0;
      const sw0 = crop ? crop.w * src.width : src.width;
      const sh0 = crop ? crop.h * src.height : src.height;
      const srcAR = sw0 / sh0;
      const dstAR = outW / outH;
      ctx.clearRect(0, 0, outW, outH);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, outW, outH);
      let dx = 0, dy = 0, dw = outW, dh = outH;
      if (srcAR > dstAR) {
        dh = outW / srcAR;
        dy = (outH - dh) / 2;
      } else {
        dw = outH * srcAR;
        dx = (outW - dw) / 2;
      }
      ctx.drawImage(src, sx0, sy0, sw0, sh0, dx, dy, dw, dh);
    }, 1000 / 30);

    // Capture a fresh stream per recording (important for memory cleanup and layout changes).
    streamRef.current = (recCanvas as unknown as { captureStream(fps: number): MediaStream }).captureStream(30);

    const tracks: MediaStreamTrack[] = [...streamRef.current.getTracks()];

    // Add mic audio if available; otherwise fall back to webcam audio.
    const micStream = getMicStream?.();
    if (micStream) {
      micStream.getAudioTracks().forEach((t) => tracks.push(t));
    } else {
      const webcamStream = getWebcamStream();
      if (webcamStream) webcamStream.getAudioTracks().forEach((t) => tracks.push(t));
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
      if (paintTimerRef.current) { clearInterval(paintTimerRef.current); paintTimerRef.current = null; }
      const duration = Date.now() - startTimeRef.current;
      const rawBlob = new Blob(chunksRef.current, { type: mimeTypeRef.current || 'video/webm' });

      let finalBlob: Blob;
      try {
        finalBlob = await webmFixDuration(rawBlob, duration, mimeTypeRef.current || 'video/webm');
      } catch {
        finalBlob = rawBlob;
      }

      let outBlob: Blob = finalBlob;
      let outExt = finalBlob.type.includes('mp4') ? 'mp4' : 'webm';

      // Prefer MP4 output. If MediaRecorder didn't produce MP4, attempt FFmpeg.wasm conversion.
      if (!outBlob.type.includes('mp4')) {
        try {
          setProgress('Loading FFmpeg…');
          const { FFmpeg } = await import('@ffmpeg/ffmpeg');
          const { toBlobURL, fetchFile } = await import('@ffmpeg/util');
          const ffmpeg = new FFmpeg();
          ffmpeg.on('log', ({ message }) => setProgress(message.slice(0, 80)));
          const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
          await ffmpeg.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
          });
          setProgress('Converting to MP4…');
          await ffmpeg.writeFile('input.webm', await fetchFile(outBlob));
          await ffmpeg.exec([
            '-i', 'input.webm',
            '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
            '-c:a', 'aac', '-movflags', '+faststart',
            'output.mp4',
          ]);
          const mp4Data = await ffmpeg.readFile('output.mp4');
          outBlob = new Blob([(mp4Data as Uint8Array).buffer as ArrayBuffer], { type: 'video/mp4' });
          outExt = 'mp4';
          setProgress(null);
        } catch (err: any) {
          console.warn('[ScreenRecorder] MP4 conversion failed; falling back to WebM:', err);
          setProgress(null);
          outBlob = finalBlob;
          outExt = 'webm';
        }
      }

      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const url = URL.createObjectURL(outBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `coach-lab-${ts}.${outExt}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

      // Release stream tracks to help Safari (and others) GC sooner.
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
      } catch {}
      streamRef.current = null;
      recCanvasRef.current = null;

      setRecState('idle');
      onRecordingChange?.(false);
    };

    recorder.start(1000); // timeslice = 1 s chunks
    recorderRef.current = recorder;
    startTimeRef.current = Date.now();
    setRecState('recording');
    onRecordingChange?.(true);

    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
  }, [getCanvas, getCropRegion, getMicStream, getWebcamStream, layoutMode, onRecordingChange]);

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

      {progress && (
        <span style={{ fontSize: '11px', color: '#35679A', fontFamily: 'monospace', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {progress}
        </span>
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
