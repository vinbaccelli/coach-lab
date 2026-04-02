'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Video, Square, Pause, Play, Download, X, Mic } from 'lucide-react';
import {
  startCanvasRecording,
  requestWebcamAndMic,
  requestMic,
  downloadBlob,
  createBlobURL,
  getSupportedMimeType,
} from '@/lib/recordingUtils';

interface ScreenRecorderProps {
  compositeCanvasRef: React.RefObject<HTMLCanvasElement | null>;
}

type RecordingState = 'idle' | 'recording' | 'paused' | 'preview';

export default function ScreenRecorder({ compositeCanvasRef }: ScreenRecorderProps) {
  const [recState, setRecState] = useState<RecordingState>('idle');
  const [withWebcam, setWithWebcam] = useState(true);
  const [withMic, setWithMic] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const webcamVideoRef = useRef<HTMLVideoElement>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const stopRecordingRef = useRef<(() => void) | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const compositeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const startRecording = useCallback(async () => {
    setError(null);
    const sourceCanvas = compositeCanvasRef.current;
    if (!sourceCanvas) {
      setError('No canvas available. Please load a video first.');
      return;
    }

    const w = sourceCanvas.width || 1280;
    const h = sourceCanvas.height || 720;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = w;
    outCanvas.height = h;

    let webcamStream: MediaStream | null = null;
    let micStream: MediaStream | null = null;

    try {
      if (withWebcam) {
        webcamStream = await requestWebcamAndMic();
        webcamStreamRef.current = webcamStream;
        if (webcamVideoRef.current) {
          webcamVideoRef.current.srcObject = webcamStream;
          await webcamVideoRef.current.play().catch(() => {});
        }
      } else if (withMic) {
        micStream = await requestMic();
        micStreamRef.current = micStream;
      }
    } catch (err) {
      console.error(err);
      setError('Could not access webcam/microphone. Check browser permissions.');
      return;
    }

    // Draw loop: merge source canvas + webcam overlay at 30 fps
    const ctx = outCanvas.getContext('2d')!;

    const drawRoundRect = (
      c: CanvasRenderingContext2D,
      x: number,
      y: number,
      cw: number,
      ch: number,
      r: number,
    ) => {
      c.beginPath();
      if (c.roundRect) {
        c.roundRect(x, y, cw, ch, r);
      } else {
        c.rect(x, y, cw, ch);
      }
    };

    compositeIntervalRef.current = setInterval(() => {
      const src = compositeCanvasRef.current;
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
      { canvasEl: outCanvas, webcamStream, micStream, fps: 30 },
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
  }, [compositeCanvasRef, withWebcam, withMic]);

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

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (compositeIntervalRef.current) clearInterval(compositeIntervalRef.current);
      webcamStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Video size={16} className="text-blue-600" />
        <span className="text-sm font-semibold text-gray-700">Screen Record</span>
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {recState === 'idle' && (
        <>
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={withWebcam}
                onChange={(e) => setWithWebcam(e.target.checked)}
                className="rounded"
              />
              <Camera size={13} />
              Webcam overlay
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={withMic}
                onChange={(e) => setWithMic(e.target.checked)}
                disabled={withWebcam}
                className="rounded"
              />
              <Mic size={13} />
              Microphone {withWebcam ? '(via webcam)' : ''}
            </label>
          </div>
          <button
            onClick={startRecording}
            className="btn-primary rounded-lg gap-2 py-2 w-full text-sm"
          >
            <Video size={15} />
            Start Recording
          </button>
        </>
      )}

      {(recState === 'recording' || recState === 'paused') && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-3 py-2 bg-red-50 rounded-lg border border-red-200">
            <div className="flex items-center gap-2">
              {recState === 'recording' && (
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              )}
              {recState === 'paused' && (
                <span className="w-2 h-2 bg-yellow-500 rounded-full" />
              )}
              <span className="text-xs font-semibold text-red-700 font-mono">
                {formatElapsed(elapsed)}
              </span>
            </div>
            <span className="text-xs text-red-600">
              {recState === 'recording' ? 'Recording…' : 'Paused'}
            </span>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={pauseRecording}
              className="btn-outline flex-1 gap-1 text-xs py-1.5 rounded-lg"
            >
              {recState === 'recording' ? (
                <><Pause size={13} /> Pause</>
              ) : (
                <><Play size={13} /> Resume</>
              )}
            </button>
            <button
              onClick={stopRecording}
              className="btn-outline flex-1 gap-1 text-xs py-1.5 rounded-lg text-red-600 hover:bg-red-50"
            >
              <Square size={13} /> Stop
            </button>
          </div>
        </div>
      )}

      {recState === 'preview' && previewUrl && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-gray-600 font-medium">Preview:</p>
          <video
            src={previewUrl}
            controls
            className="w-full rounded-lg border border-gray-200"
            style={{ maxHeight: 160 }}
          />
          <div className="flex gap-1.5">
            <button
              onClick={downloadRecording}
              className="btn-primary flex-1 gap-1 text-xs py-1.5 rounded-lg"
            >
              <Download size={13} /> Save
            </button>
            <button
              onClick={discardPreview}
              className="btn-outline flex-1 gap-1 text-xs py-1.5 rounded-lg text-red-600 hover:bg-red-50"
            >
              <X size={13} /> Discard
            </button>
          </div>
        </div>
      )}

      {/* Hidden webcam element */}
      <video ref={webcamVideoRef} muted playsInline className="hidden" aria-hidden="true" />
    </div>
  );
}