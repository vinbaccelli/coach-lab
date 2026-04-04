'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  startCanvasRecording,
  requestWebcamAndMic,
  requestMic,
  downloadBlob,
  createBlobURL,
  getSupportedMimeType,
} from '@/lib/recordingUtils';

type RecordingState = 'idle' | 'recording' | 'paused' | 'preview';

interface RecordingContextValue {
  recState: RecordingState;
  elapsed: number;
  withWebcam: boolean;
  withMic: boolean;
  webcamStream: MediaStream | null;
  previewUrl: string | null;
  previewBlob: Blob | null;
  error: string | null;
  setWithWebcam: (v: boolean) => void;
  setWithMic: (v: boolean) => void;
  startRecording: () => Promise<void>;
  pauseRecording: () => void;
  stopRecording: () => void;
  discardPreview: () => void;
  downloadRecording: () => void;
  /** Register a getter that returns the composite canvas for recording */
  registerCompositeCanvas: (getter: () => HTMLCanvasElement | null) => void;
  /** Register a getter that returns the webcam video element */
  registerWebcamVideo: (el: HTMLVideoElement | null) => void;
}

const RecordingContext = createContext<RecordingContextValue | null>(null);

export function RecordingProvider({ children }: { children: React.ReactNode }) {
  const [recState, setRecState] = useState<RecordingState>('idle');
  const [withWebcam, setWithWebcam] = useState(true);
  const [withMic, setWithMic] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const compositeCanvasGetterRef = useRef<(() => HTMLCanvasElement | null) | null>(null);
  const webcamVideoRef = useRef<HTMLVideoElement | null>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const stopRecordingRef = useRef<(() => void) | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const compositeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const registerCompositeCanvas = useCallback((getter: () => HTMLCanvasElement | null) => {
    compositeCanvasGetterRef.current = getter;
  }, []);

  const registerWebcamVideo = useCallback((el: HTMLVideoElement | null) => {
    webcamVideoRef.current = el;
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    const sourceCanvas = compositeCanvasGetterRef.current?.();
    if (!sourceCanvas) {
      setError('No canvas available. Please load a video first.');
      return;
    }

    const w = sourceCanvas.width || 1280;
    const h = sourceCanvas.height || 720;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = w;
    outCanvas.height = h;

    let ws: MediaStream | null = null;
    let ms: MediaStream | null = null;

    try {
      if (withWebcam) {
        ws = await requestWebcamAndMic();
        webcamStreamRef.current = ws;
        setWebcamStream(ws);
        const vid = webcamVideoRef.current;
        if (vid) {
          vid.srcObject = ws;
          await vid.play().catch((err) => console.warn('[RecordingContext] Webcam video play failed:', err));
        }
      } else if (withMic) {
        ms = await requestMic();
        micStreamRef.current = ms;
      }
    } catch (err) {
      console.error(err);
      setError('Could not access webcam/microphone. Check browser permissions.');
      return;
    }

    const drawRoundRect = (
      c: CanvasRenderingContext2D,
      x: number,
      y: number,
      cw: number,
      ch: number,
      r: number,
    ) => {
      c.beginPath();
      if (c.roundRect) c.roundRect(x, y, cw, ch, r);
      else c.rect(x, y, cw, ch);
    };

    const ctx = outCanvas.getContext('2d')!;
    compositeIntervalRef.current = setInterval(() => {
      const src = compositeCanvasGetterRef.current?.();
      if (!src) return;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(src, 0, 0, w, h);

      const cam = webcamVideoRef.current;
      if (cam && !cam.paused && withWebcam) {
        const camW = Math.round(w * 0.2);
        const camH = Math.round(camW * (9 / 16));
        const margin = 16;
        ctx.save();
        drawRoundRect(ctx, w - camW - margin, margin, camW, camH, 8);
        ctx.clip();
        ctx.drawImage(cam, w - camW - margin, margin, camW, camH);
        ctx.restore();
        ctx.strokeStyle = '#D4E8F7';
        ctx.lineWidth = 3;
        drawRoundRect(ctx, w - camW - margin, margin, camW, camH, 8);
        ctx.stroke();
      }
    }, 1000 / 30);

    const { mediaRecorder, stop } = await startCanvasRecording(
      { canvasEl: outCanvas, webcamStream: ws, micStream: ms, fps: 30 },
      (blob) => {
        const url = createBlobURL(blob);
        setPreviewUrl(url);
        setPreviewBlob(blob);
        setRecState('preview');
      },
    );

    mediaRecorderRef.current = mediaRecorder;
    stopRecordingRef.current = stop;
    setRecState('recording');
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
  }, [withWebcam, withMic]);

  const pauseRecording = useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    if (mr.state === 'recording') {
      mr.pause();
      setRecState('paused');
      if (timerRef.current) clearInterval(timerRef.current);
    } else if (mr.state === 'paused') {
      mr.resume();
      setRecState('recording');
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (compositeIntervalRef.current) clearInterval(compositeIntervalRef.current);
    stopRecordingRef.current?.();
    webcamStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    webcamStreamRef.current = null;
    micStreamRef.current = null;
    setWebcamStream(null);
  }, []);

  const discardPreview = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewBlob(null);
    setRecState('idle');
    setElapsed(0);
  }, [previewUrl]);

  const downloadRecording = useCallback(() => {
    if (previewBlob) {
      const ext = getSupportedMimeType().includes('mp4') ? 'mp4' : 'webm';
      downloadBlob(previewBlob, `coach-lab-recording.${ext}`);
    }
  }, [previewBlob]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (compositeIntervalRef.current) clearInterval(compositeIntervalRef.current);
      webcamStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <RecordingContext.Provider
      value={{
        recState,
        elapsed,
        withWebcam,
        withMic,
        webcamStream,
        previewUrl,
        previewBlob,
        error,
        setWithWebcam,
        setWithMic,
        startRecording,
        pauseRecording,
        stopRecording,
        discardPreview,
        downloadRecording,
        registerCompositeCanvas,
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
