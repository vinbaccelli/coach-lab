'use client';

/**
 * Global screen-recording engine. Mounted once in app/layout.tsx (survives ALL
 * route navigations) so a recording started in the Recording Hub keeps running
 * while the coach moves to the control panel, players, or any other page —
 * with the floating Play/Pause/Stop + timer widget (FloatingRecordingIndicator)
 * following everywhere.
 *
 * This replaces both (a) the dormant canvas-composite engine that previously
 * lived here (its registerCompositeCanvas had zero callers) and (b) the
 * page-owned <ScreenRecorder mode="display"> instance on /analysis whose
 * unmount killed the capture on navigation.
 *
 * Sources (webcam/mic getters) are registered by the analysis page; the engine
 * snapshots the actual tracks at start() time, so the getters going stale after
 * a route change is harmless. Finished recordings land in `completedRecording`
 * — the analysis page consumes it (crop/save modal) whenever it is (re)mounted.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { webmFixDuration } from 'webm-fix-duration';
import { convertWebmToMp4ForScreenRecord } from '@/lib/ffmpegWebmToMp4';
import { stopAllTracks } from '@/lib/tabCaptureRecording';

type RecordingState = 'idle' | 'recording' | 'paused' | 'stopped';

export interface RecordingSources {
  getWebcamStream: () => MediaStream | null;
  getMicStream: () => MediaStream | null;
}

export interface CompletedRecording {
  blob: Blob;
  ext: string;
}

interface RecordingContextValue {
  recState: RecordingState;
  elapsed: number;
  error: string | null;
  progress: string | null;
  startRecording: () => Promise<void>;
  pauseRecording: () => void;
  stopRecording: () => Promise<void>;
  /** Analysis page registers its webcam/mic getters here (null to unregister). */
  registerRecordingSources: (sources: RecordingSources | null) => void;
  /** Finished recording awaiting a consumer (analysis page crop/save modal). */
  completedRecording: CompletedRecording | null;
  clearCompletedRecording: () => void;
  // ── Legacy surface kept for PersistentWebcamOverlay ──────────────────────
  webcamStream: MediaStream | null;
  registerWebcamVideo: (el: HTMLVideoElement | null) => void;
}

const RecordingContext = createContext<RecordingContextValue | null>(null);

function getBestMimeType(): string {
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

export function RecordingProvider({ children }: { children: React.ReactNode }) {
  const [recState, setRecState] = useState<RecordingState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [completedRecording, setCompletedRecording] = useState<CompletedRecording | null>(null);

  const sourcesRef = useRef<RecordingSources | null>(null);

  const displayStreamRef = useRef<MediaStream | null>(null);
  const displayVideoRef = useRef<HTMLVideoElement | null>(null);
  const webcamVideoElRef = useRef<HTMLVideoElement | null>(null);
  const docPipWindowRef = useRef<Window | null>(null);
  const recCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const mimeTypeRef = useRef('video/webm');
  const rafPaintRef = useRef<number | null>(null);
  const paintBackupRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopFailsafeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveFinishedRef = useRef(false);
  // Pause-aware duration accounting: activeMs = now - start - pausedTotal.
  const startTimeRef = useRef(0);
  const pausedAtRef = useRef<number | null>(null);
  const pausedTotalRef = useRef(0);

  const registerRecordingSources = useCallback((sources: RecordingSources | null) => {
    sourcesRef.current = sources;
  }, []);

  const clearCompletedRecording = useCallback(() => setCompletedRecording(null), []);

  /** Legacy no-op kept so PersistentWebcamOverlay compiles/behaves (it hides itself when webcamStream is null). */
  const registerWebcamVideo = useCallback((_el: HTMLVideoElement | null) => {}, []);

  const activeDurationMs = useCallback(() => {
    const pausedExtra = pausedAtRef.current != null ? Date.now() - pausedAtRef.current : 0;
    return Math.max(0, Date.now() - startTimeRef.current - pausedTotalRef.current - pausedExtra);
  }, []);

  const cleanupAux = useCallback(() => {
    if (rafPaintRef.current != null) { cancelAnimationFrame(rafPaintRef.current); rafPaintRef.current = null; }
    if (paintBackupRef.current) { clearInterval(paintBackupRef.current); paintBackupRef.current = null; }
    if (displayVideoRef.current) { displayVideoRef.current.srcObject = null; displayVideoRef.current = null; }
    if (webcamVideoElRef.current) { webcamVideoElRef.current.srcObject = null; webcamVideoElRef.current = null; }
    stopAllTracks(displayStreamRef.current);
    displayStreamRef.current = null;
    try { docPipWindowRef.current?.close(); } catch { /* noop */ }
    docPipWindowRef.current = null;
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    streamRef.current = null;
    recCanvasRef.current = null;
  }, []);

  const deliverRecording = useCallback(async (rawBlob: Blob, durationMs: number) => {
    if (rawBlob.size === 0) {
      setError('Recording produced an empty file. Try again.');
      cleanupAux();
      setRecState('idle');
      saveFinishedRef.current = true;
      return;
    }

    let fixedBlob: Blob = rawBlob;
    try {
      fixedBlob = await webmFixDuration(rawBlob, durationMs, mimeTypeRef.current || 'video/webm');
    } catch (fixErr) {
      console.warn('[RecordingProvider] webmFixDuration skipped:', fixErr);
    }

    let outBlob: Blob = fixedBlob;
    let outExt = 'mp4';
    const looksMp4 = outBlob.type.includes('mp4') || /mp4/i.test(mimeTypeRef.current);
    if (!looksMp4) {
      try {
        setProgress('Converting to MP4…');
        const conv = await convertWebmToMp4ForScreenRecord(fixedBlob);
        setProgress(null);
        if (conv.ok) {
          outBlob = conv.blob;
        } else {
          // Deliver the WebM rather than losing the capture.
          outExt = 'webm';
        }
      } catch {
        setProgress(null);
        outExt = 'webm';
      }
    }

    // Hand off to the analysis page (crop/save modal). If the coach stopped
    // while on another page, this waits in state until /analysis remounts.
    setCompletedRecording({ blob: outBlob, ext: outExt });

    cleanupAux();
    setRecState('idle');
    setElapsed(0);
    saveFinishedRef.current = true;
  }, [cleanupAux]);

  const startRecording = useCallback(async () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') return; // already running
    setError(null);
    setProgress(null);
    setElapsed(0);

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
      if (e instanceof DOMException && e.name === 'NotAllowedError') return; // user cancelled
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

    // Snapshot webcam/mic tracks NOW — getters may go stale after navigation.
    const webcamStream = sourcesRef.current?.getWebcamStream() ?? null;
    let webcamVideo: HTMLVideoElement | null = null;
    if (webcamStream) {
      webcamVideo = document.createElement('video');
      webcamVideo.muted = true;
      webcamVideo.playsInline = true;
      webcamVideo.srcObject = webcamStream;
      webcamVideoElRef.current = webcamVideo;
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
        } catch { /* PiP optional */ }
      }
    }

    const outW = Math.max(640, displayVideo.videoWidth || 1920);
    const outH = Math.max(360, displayVideo.videoHeight || 1080);
    const recCanvas = document.createElement('canvas');
    recCanvas.width = outW;
    recCanvas.height = outH;
    recCanvasRef.current = recCanvas;
    const ctx = recCanvas.getContext('2d')!;

    const paintOnce = () => {
      if (displayVideo.readyState >= 2) {
        ctx.drawImage(displayVideo, 0, 0, outW, outH);
      }
      if (webcamVideo && webcamVideo.readyState >= 2) {
        const pipW = Math.round(outW * 0.22);
        const pipH = Math.round(pipW * (9 / 16));
        const margin = Math.round(outW * 0.02);
        const px = outW - pipW - margin;
        const py = outH - pipH - margin;
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
    // Backup painter: rAF throttles to ~0 fps in blurred/hidden tabs — a global
    // recorder is very likely to run while the coach works in another app, so a
    // timer keeps frames flowing to the capture stream.
    paintBackupRef.current = setInterval(paintOnce, 66);

    streamRef.current = (recCanvas as HTMLCanvasElement & { captureStream(fps: number): MediaStream }).captureStream(30);
    const tracks: MediaStreamTrack[] = [...streamRef.current.getTracks()];
    const micStream = sourcesRef.current?.getMicStream() ?? null;
    if (micStream) {
      micStream.getAudioTracks().forEach((t) => { if (t.enabled) tracks.push(t); });
    } else if (webcamStream) {
      webcamStream.getAudioTracks().forEach((t) => { if (t.enabled) tracks.push(t); });
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
      cleanupAux();
      setError('MediaRecorder not supported in this browser.');
      return;
    }

    // User ended capture from the browser chrome → stop + save through our path.
    displayStream.getVideoTracks()[0]?.addEventListener('ended', () => {
      const rec = recorderRef.current;
      if (rec && rec.state !== 'inactive') {
        try { rec.requestData(); } catch { /* noop */ }
        rec.stop();
        setRecState('stopped');
      }
    });

    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data?.size) chunksRef.current.push(e.data);
    };
    recorder.onstop = async () => {
      try {
        if (stopFailsafeRef.current) { clearTimeout(stopFailsafeRef.current); stopFailsafeRef.current = null; }
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        saveFinishedRef.current = false;
        const duration = activeDurationMs();
        const rawBlob = new Blob(chunksRef.current, { type: mimeTypeRef.current || 'video/webm' });
        await deliverRecording(rawBlob, duration);
      } catch (fatal: unknown) {
        console.error('[RecordingProvider] onstop failed:', fatal);
        cleanupAux();
        setRecState('idle');
        saveFinishedRef.current = true;
      }
    };

    recorder.start(250);
    recorderRef.current = recorder;
    startTimeRef.current = Date.now();
    pausedAtRef.current = null;
    pausedTotalRef.current = 0;
    setRecState('recording');
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor(activeDurationMs() / 1000));
    }, 500);
  }, [activeDurationMs, cleanupAux, deliverRecording]);

  const pauseRecording = useCallback(() => {
    const mr = recorderRef.current;
    if (!mr) return;
    if (mr.state === 'recording') {
      try { mr.pause(); } catch { return; }
      pausedAtRef.current = Date.now();
      setRecState('paused');
    } else if (mr.state === 'paused') {
      try { mr.resume(); } catch { return; }
      if (pausedAtRef.current != null) {
        pausedTotalRef.current += Date.now() - pausedAtRef.current;
        pausedAtRef.current = null;
      }
      setRecState('recording');
    }
  }, []);

  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    // Resume first so the final chunk flushes correctly from a paused state.
    if (recorder.state === 'paused') {
      try { recorder.resume(); } catch { /* noop */ }
      if (pausedAtRef.current != null) {
        pausedTotalRef.current += Date.now() - pausedAtRef.current;
        pausedAtRef.current = null;
      }
    }
    try { recorder.requestData(); } catch { /* noop */ }
    recorder.stop();
    setRecState('stopped');

    // Failsafe if onstop never completes.
    if (stopFailsafeRef.current) clearTimeout(stopFailsafeRef.current);
    stopFailsafeRef.current = setTimeout(() => {
      stopFailsafeRef.current = null;
      if (saveFinishedRef.current) return;
      const rawBlob = new Blob(chunksRef.current, { type: mimeTypeRef.current || 'video/webm' });
      if (rawBlob.size === 0) { setRecState('idle'); return; }
      void deliverRecording(rawBlob, activeDurationMs());
    }, 55_000);
  }, [activeDurationMs, deliverRecording]);

  // Full page unload only (the provider never unmounts on route changes).
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (stopFailsafeRef.current) clearTimeout(stopFailsafeRef.current);
      cleanupAux();
    };
  }, [cleanupAux]);

  return (
    <RecordingContext.Provider
      value={{
        recState,
        elapsed,
        error,
        progress,
        startRecording,
        pauseRecording,
        stopRecording,
        registerRecordingSources,
        completedRecording,
        clearCompletedRecording,
        webcamStream: null,
        registerWebcamVideo,
      }}
    >
      {children}
    </RecordingContext.Provider>
  );
}

export function useRecording() {
  const ctx = useContext(RecordingContext);
  if (!ctx) throw new Error('useRecording must be used within RecordingProvider');
  return ctx;
}
