'use client';

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { webmFixDuration } from 'webm-fix-duration';
import { convertWebmToMp4ForScreenRecord } from '@/lib/ffmpegWebmToMp4';
import { stopAllTracks } from '@/lib/tabCaptureRecording';

interface ScreenRecorderProps {
  getCanvas: () => HTMLCanvasElement | null;
  getWebcamStream: () => MediaStream | null;
  getMicStream?: () => MediaStream | null;
  getCropRegion?: () => { x: number; y: number; w: number; h: number } | null;
  layoutMode?: 'youtube' | 'reels';
  /** Icon-only trigger for compact recording hub rows. */
  compactIcon?: boolean;
  /** `display` uses getDisplayMedia (screen/window/tab). Default `canvas` records the analysis canvas. */
  mode?: 'canvas' | 'display';
  /** When true, parent handles download via onRecordingComplete instead of auto-downloading. */
  promptDownload?: boolean;
  onRecordingComplete?: (blob: Blob, ext: string) => void;
  onRecordingChange?: (recording: boolean) => void;
  /** Block starting a recording while another capture/recording flow is busy. */
  disabled?: boolean;
  /** Headless mode: surface errors to the parent UI. */
  onRecordingError?: (message: string) => void;
  /** Render no UI — drive start()/stop() imperatively via the ref instead. */
  headless?: boolean;
}

/** Imperative API exposed via ref so callers (e.g. the area overlay) can drive recording. */
export interface ScreenRecorderHandle {
  start: () => Promise<void>;
  stop: () => void;
}

type RecState = 'idle' | 'recording' | 'stopped';

function getBestMimeType(): string {
  // Prefer MP4/H.264 when the browser supports it (Safari / some Chromium builds).
  const candidates = [
    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    'video/mp4;codecs=avc1',
    'video/mp4;codecs=h264',
    'video/mp4',
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

const ScreenRecorder = forwardRef<ScreenRecorderHandle, ScreenRecorderProps>(function ScreenRecorder({
  getCanvas,
  getWebcamStream,
  getMicStream,
  getCropRegion,
  layoutMode = 'youtube',
  mode = 'canvas',
  compactIcon = false,
  promptDownload = false,
  onRecordingComplete,
  onRecordingChange,
  disabled = false,
  onRecordingError,
  headless = false,
}: ScreenRecorderProps, ref) {
  const [recState, setRecState] = useState<RecState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const paintTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const rafPaintRef     = useRef<number | null>(null);
  const recCanvasRef    = useRef<HTMLCanvasElement | null>(null);
  const streamRef       = useRef<MediaStream | null>(null);
  const recorderRef     = useRef<MediaRecorder | null>(null);
  const chunksRef       = useRef<BlobPart[]>([]);
  const startTimeRef    = useRef<number>(0);
  const timerRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeTypeRef     = useRef('video/webm');
  const saveHandleRef   = useRef<any | null>(null);
  const recStateRef     = useRef<RecState>('idle');
  const saveFinishedRef = useRef(false);
  const stopFailsafeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const displayVideoRef = useRef<HTMLVideoElement | null>(null);
  const webcamVideoRef = useRef<HTMLVideoElement | null>(null);
  const docPipWindowRef = useRef<Window | null>(null);
  useEffect(() => { recStateRef.current = recState; }, [recState]);

  useEffect(() => {
    if (error) onRecordingError?.(error);
  }, [error, onRecordingError]);

  const cleanupDisplayAux = useCallback(() => {
    if (rafPaintRef.current) {
      cancelAnimationFrame(rafPaintRef.current);
      rafPaintRef.current = null;
    }
    if (displayVideoRef.current) {
      displayVideoRef.current.srcObject = null;
      displayVideoRef.current = null;
    }
    if (webcamVideoRef.current) {
      webcamVideoRef.current.srcObject = null;
      webcamVideoRef.current = null;
    }
    stopAllTracks(displayStreamRef.current);
    displayStreamRef.current = null;
    try {
      docPipWindowRef.current?.close();
    } catch { /* noop */ }
    docPipWindowRef.current = null;
  }, []);

  // Clean up timer on unmount
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (paintTimerRef.current) clearInterval(paintTimerRef.current);
    cleanupDisplayAux();
  }, [cleanupDisplayAux]);

  const deliverRecording = useCallback(
    async (rawBlob: Blob, duration: number) => {
      if (rawBlob.size === 0) {
        setError('Recording produced an empty file. Try again.');
        setRecState('idle');
        onRecordingChange?.(false);
        saveFinishedRef.current = true;
        return;
      }

      let finalBlob: Blob = rawBlob;
      try {
        finalBlob = await webmFixDuration(rawBlob, duration, mimeTypeRef.current || 'video/webm');
      } catch (fixErr) {
        console.warn('[ScreenRecorder] webmFixDuration skipped:', fixErr);
      }

      let outBlob: Blob = finalBlob;
      let outExt = 'mp4';
      const blobLooksMp4 =
        outBlob.type.includes('mp4') || /mp4/i.test(mimeTypeRef.current);

      if (!blobLooksMp4) {
        try {
          setProgress('Converting to MP4…');
          const conv = await convertWebmToMp4ForScreenRecord(finalBlob);
          if (conv.ok) {
            setProgress(null);
            outBlob = conv.blob;
            outExt = 'mp4';
          } else {
            setProgress(null);
            setError('Could not convert recording to MP4. Try again.');
            setRecState('idle');
            onRecordingChange?.(false);
            saveFinishedRef.current = true;
            return;
          }
        } catch {
          setProgress(null);
          setError('Could not convert recording to MP4. Try again.');
          setRecState('idle');
          onRecordingChange?.(false);
          saveFinishedRef.current = true;
          return;
        }
      }

      if (promptDownload && onRecordingComplete) {
        onRecordingComplete(outBlob, outExt);
      } else {
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const suggestedName = `angle-motion-${ts}.${outExt}`;
        const handle = saveHandleRef.current;
        if (handle && typeof handle.createWritable === 'function') {
          try {
            const writable = await handle.createWritable();
            await writable.write(outBlob);
            await writable.close();
          } catch {
            const url = URL.createObjectURL(outBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = suggestedName;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 10_000);
          }
        } else {
          const url = URL.createObjectURL(outBlob);
          const a = document.createElement('a');
          a.href = url;
          a.download = suggestedName;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
        }
        saveHandleRef.current = null;
      }

      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
      } catch { /* noop */ }
      streamRef.current = null;
      recCanvasRef.current = null;
      cleanupDisplayAux();
      setRecState('idle');
      onRecordingChange?.(false);
      saveFinishedRef.current = true;
    },
    [cleanupDisplayAux, onRecordingChange, onRecordingComplete, promptDownload],
  );

  const startDisplayRecording = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
      setError('Screen recording is not supported in this browser.');
      return;
    }

    let displayStream: MediaStream;
    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 60 } } as MediaTrackConstraints,
        audio: false,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotAllowedError') return;
      setError('Could not start screen capture.');
      return;
    }
    displayStreamRef.current = displayStream;

    const displayVideo = document.createElement('video');
    displayVideo.muted = true;
    displayVideo.playsInline = true;
    displayVideo.srcObject = displayStream;
    displayVideoRef.current = displayVideo;
    await displayVideo.play().catch(() => {});

    const webcamStream = getWebcamStream();
    let webcamVideo: HTMLVideoElement | null = null;
    if (webcamStream) {
      webcamVideo = document.createElement('video');
      webcamVideo.muted = true;
      webcamVideo.playsInline = true;
      webcamVideo.srcObject = webcamStream;
      webcamVideoRef.current = webcamVideo;
      await webcamVideo.play().catch(() => {});

      const docPip = (window as Window & { documentPictureInPicture?: { requestWindow: (opts?: { width?: number; height?: number }) => Promise<Window> } }).documentPictureInPicture;
      if (docPip?.requestWindow) {
        try {
          const pipWin = await docPip.requestWindow({ width: 320, height: 180 });
          docPipWindowRef.current = pipWin;
          const pipVid = pipWin.document.createElement('video');
          pipVid.srcObject = webcamStream;
          pipVid.style.width = '100%';
          pipVid.style.height = '100%';
          pipVid.style.objectFit = 'cover';
          pipWin.document.body.style.margin = '0';
          pipWin.document.body.appendChild(pipVid);
          void pipVid.play();
        } catch {
          /* PiP optional */
        }
      }
    }

    const outW = Math.max(640, displayVideo.videoWidth || 1920);
    const outH = Math.max(360, displayVideo.videoHeight || 1080);
    const recCanvas = document.createElement('canvas');
    recCanvas.width = outW;
    recCanvas.height = outH;
    recCanvasRef.current = recCanvas;
    const ctx = recCanvas.getContext('2d')!;

    // Phase 3: always record the FULL display stream. Cropping (selected area)
    // is applied after recording in post-processing, which keeps capture stable
    // across This Tab / Window / Entire Screen and every layout.
    const paintOnce = () => {
      if (displayVideo.readyState >= 2) {
        if (recCanvas.width !== outW || recCanvas.height !== outH) {
          recCanvas.width = outW;
          recCanvas.height = outH;
        }
        ctx.drawImage(displayVideo, 0, 0, outW, outH);
      }
      const cw = recCanvas.width;
      const ch = recCanvas.height;
      if (webcamVideo && webcamVideo.readyState >= 2 && cw > 0 && ch > 0) {
        const pipW = Math.round(cw * 0.22);
        const pipH = Math.round(pipW * (9 / 16));
        const margin = Math.round(cw * 0.02);
        const px = cw - pipW - margin;
        const py = ch - pipH - margin;
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(px - 4, py - 4, pipW + 8, pipH + 8);
        ctx.drawImage(webcamVideo, px, py, pipW, pipH);
      }
    };

    const paintLoop = () => {
      paintOnce();
      rafPaintRef.current = requestAnimationFrame(paintLoop);
    };
    paintOnce();
    rafPaintRef.current = requestAnimationFrame(paintLoop);

    streamRef.current = (recCanvas as HTMLCanvasElement & { captureStream(fps: number): MediaStream }).captureStream(30);
    const tracks: MediaStreamTrack[] = [...streamRef.current.getTracks()];
    const micStream = getMicStream?.();
    if (micStream) {
      micStream.getAudioTracks().forEach((t) => {
        if (t.enabled) tracks.push(t);
      });
    } else if (webcamStream) {
      webcamStream.getAudioTracks().forEach((t) => {
        if (t.enabled) tracks.push(t);
      });
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
    } catch {
      cleanupDisplayAux();
      setError('MediaRecorder not supported in this browser.');
      return;
    }

    displayStream.getVideoTracks()[0]?.addEventListener('ended', () => {
      const rec = recorderRef.current;
      if (rec && rec.state !== 'inactive') {
        try { rec.requestData(); } catch { /* noop */ }
        rec.stop();
      }
    });

    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data?.size) chunksRef.current.push(e.data);
    };
    recorder.onstop = async () => {
      try {
        if (stopFailsafeRef.current) {
          clearTimeout(stopFailsafeRef.current);
          stopFailsafeRef.current = null;
        }
        saveFinishedRef.current = false;
        const duration = Date.now() - startTimeRef.current;
        const rawBlob = new Blob(chunksRef.current, { type: mimeTypeRef.current || 'video/webm' });
        await deliverRecording(rawBlob, duration);
      } catch (fatal: unknown) {
        console.error('[ScreenRecorder] display onstop:', fatal);
        cleanupDisplayAux();
        setRecState('idle');
        onRecordingChange?.(false);
        saveFinishedRef.current = true;
      }
    };

    recorder.start(250);
    recorderRef.current = recorder;
    startTimeRef.current = Date.now();
    setRecState('recording');
    onRecordingChange?.(true);
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
  }, [cleanupDisplayAux, deliverRecording, getMicStream, getWebcamStream, onRecordingChange]);

  const startRecording = useCallback(async () => {
    if (disabled) return;
    setError(null);
    setElapsed(0);
    setProgress(null);

    if (mode === 'display') {
      await startDisplayRecording();
      return;
    }

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
    if (paintTimerRef.current) { clearInterval(paintTimerRef.current); paintTimerRef.current = null; }
    if (rafPaintRef.current) { cancelAnimationFrame(rafPaintRef.current); rafPaintRef.current = null; }

    const paintOnce = () => {
      const src = getCanvas();
      if (!src || src.width < 2 || src.height < 2) return;
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
    };

    const paintLoop = () => {
      paintOnce();
      rafPaintRef.current = requestAnimationFrame(paintLoop);
    };
    // Paint several frames BEFORE capture so the stream starts with real
    // content (a canvas captured while still blank can yield a 0-byte file).
    paintOnce(); paintOnce();
    rafPaintRef.current = requestAnimationFrame(paintLoop);
    // Backup painter: requestAnimationFrame is throttled to ~0 fps when the tab
    // loses focus (e.g. the native save dialog, or the coach switching apps),
    // which starves the capture stream and produced empty recordings. A timer
    // keeps painting so the stream always has frames.
    if (paintTimerRef.current) { clearInterval(paintTimerRef.current); }
    paintTimerRef.current = setInterval(paintOnce, 66);

    // Capture a fresh stream per recording (important for memory cleanup and layout changes).
    streamRef.current = (recCanvas as unknown as { captureStream(fps: number): MediaStream }).captureStream(30);

    const tracks: MediaStreamTrack[] = [...streamRef.current.getTracks()];
    if (tracks.length === 0 || !tracks.some((t) => t.kind === 'video' && t.readyState === 'live')) {
      if (rafPaintRef.current) { cancelAnimationFrame(rafPaintRef.current); rafPaintRef.current = null; }
      if (paintTimerRef.current) { clearInterval(paintTimerRef.current); paintTimerRef.current = null; }
      try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
      streamRef.current = null;
      recCanvasRef.current = null;
      setError('Could not start capture — reload the page and try again.');
      return;
    }

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
      if (rafPaintRef.current) { cancelAnimationFrame(rafPaintRef.current); rafPaintRef.current = null; }
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
      } catch { /* noop */ }
      streamRef.current = null;
      recCanvasRef.current = null;
      setError('MediaRecorder not supported in this browser.');
      console.error('[ScreenRecorder] MediaRecorder init failed:', err);
      return;
    }

    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      try {
        if (stopFailsafeRef.current) {
          clearTimeout(stopFailsafeRef.current);
          stopFailsafeRef.current = null;
        }
        saveFinishedRef.current = false;
        if (paintTimerRef.current) { clearInterval(paintTimerRef.current); paintTimerRef.current = null; }
        if (rafPaintRef.current) { cancelAnimationFrame(rafPaintRef.current); rafPaintRef.current = null; }
        const duration = Date.now() - startTimeRef.current;
        const rawBlob = new Blob(chunksRef.current, { type: mimeTypeRef.current || 'video/webm' });
        await deliverRecording(rawBlob, duration);
      } catch (fatal: unknown) {
        console.error('[ScreenRecorder] onstop failed:', fatal);
        setProgress(null);
        cleanupDisplayAux();
        chunksRef.current = [];
        setRecState('idle');
        onRecordingChange?.(false);
        saveFinishedRef.current = true;
      }
    };

    recorder.start(250); // smaller timeslice helps ensure we get non-empty data for short recordings
    recorderRef.current = recorder;
    startTimeRef.current = Date.now();
    setRecState('recording');
    onRecordingChange?.(true);

    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
  }, [disabled, getCanvas, getCropRegion, getMicStream, getWebcamStream, layoutMode, mode, onRecordingChange, startDisplayRecording, deliverRecording]);

  const stopRecording = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      // If available, ask the user where to save *before* async work begins.
      // This avoids browsers blocking a download after FFmpeg finishes.
      try {
        const supportsPicker = typeof (window as any).showSaveFilePicker === 'function';
        if (supportsPicker) {
          const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          // We prefer MP4. If conversion fails we may still write WebM, but naming MP4 is ok—fallback download uses correct ext.
          (window as any).showSaveFilePicker({
            suggestedName: `angle-motion-${ts}.mp4`,
            types: [
              { description: 'MP4 Video', accept: { 'video/mp4': ['.mp4'] } },
              { description: 'WebM Video', accept: { 'video/webm': ['.webm'] } },
            ],
          }).then((handle: any) => { saveHandleRef.current = handle; }).catch(() => { /* user cancelled */ });
        }
      } catch {}

      // Flush the last chunk before stopping to avoid 0B/0kB output.
      try { recorder.requestData(); } catch {}
      recorder.stop();
      setRecState('stopped');

      // Failsafe only if onstop never completes (crash). Do not race FFmpeg async work.
      if (stopFailsafeRef.current) clearTimeout(stopFailsafeRef.current);
      // Use the global setTimeout return type so it works in Vercel (node typings)
      // and in the browser (number).
      stopFailsafeRef.current = setTimeout(() => {
        stopFailsafeRef.current = null;
        if (saveFinishedRef.current) return;
        const rawBlob = new Blob(chunksRef.current, { type: mimeTypeRef.current || 'video/webm' });
        if (rawBlob.size === 0) {
          setError('Recording produced an empty file.');
          setRecState('idle');
          onRecordingChange?.(false);
          return;
        }
        const duration = Math.max(0, (Date.now() - startTimeRef.current) / 1000);
        void deliverRecording(rawBlob, duration);
      }, 55_000);
    }
  }, [deliverRecording, onRecordingChange]);

  useImperativeHandle(ref, () => ({ start: startRecording, stop: stopRecording }), [startRecording, stopRecording]);

  // Headless mode: caller drives start()/stop() via the ref and supplies its own UI.
  if (headless) return null;

  const btnStyle: React.CSSProperties = compactIcon
    ? {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        minHeight: 36,
        maxHeight: 36,
        padding: 0,
        borderRadius: 10,
        border: '1px solid #E8E6E1',
        background: '#FAF8F5',
        cursor: 'pointer',
      }
    : {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '8px 14px',
        borderRadius: '12px',
        border: '1px solid #E5E5E5',
        background: '#FFFFFF',
        cursor: 'pointer',
        fontSize: '13px',
        color: '#1A1A1A',
        fontWeight: 500,
      };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: compactIcon ? 4 : 8, flexDirection: compactIcon ? 'column' : 'row', width: compactIcon ? '100%' : undefined }}>
      {recState === 'idle' && (
        <button
          onClick={startRecording}
          disabled={disabled}
          style={{ ...btnStyle, ...(disabled ? { opacity: 0.5, cursor: 'not-allowed' } : null) }}
          title={disabled ? 'Another capture is in progress' : 'Start screen recording'}
        >
          <span style={{ color: '#FF3B30', fontSize: compactIcon ? 18 : 16 }}>&#9210;</span>
          {compactIcon ? null : 'Record'}
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
        <span style={{ fontSize: '12px', color: '#6e6e73' }}>Saving recording…</span>
      )}

      {progress && (
        <span style={{ fontSize: '11px', color: '#6e6e73', fontFamily: 'monospace', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
});

export default ScreenRecorder;
