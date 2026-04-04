'use client';

import React from 'react';
import { Camera, Video, Square, Pause, Play, Download, X, Mic } from 'lucide-react';
import { useRecording } from '@/contexts/RecordingContext';

// ScreenRecorder is a pure UI panel; all recording logic lives in RecordingContext.
export default function ScreenRecorder() {
  const {
    recState,
    elapsed,
    withWebcam,
    withMic,
    previewUrl,
    error,
    setWithWebcam,
    setWithMic,
    startRecording,
    pauseRecording,
    stopRecording,
    discardPreview,
    downloadRecording,
  } = useRecording();

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

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
          <p className="text-[10px] text-gray-400 text-center">
            Switch tabs to use tools — recording continues!
          </p>
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
    </div>
  );
}
