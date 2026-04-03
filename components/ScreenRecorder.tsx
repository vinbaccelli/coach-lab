'use client';

import React, { useRef, useState } from 'react';

export function ScreenRecorder() {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedChunks, setRecordedChunks] = useState<Blob[]>([]);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraPosition, setCameraPosition] = useState<'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'>('bottom-right');

  const startRecording = async () => {
    try {
      screenStreamRef.current = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      if (showCamera) {
        cameraStreamRef.current = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720 },
          audio: false,
        });
      }

      const canvas = canvasRef.current;
      if (!canvas) return;

      const screenVideo = document.createElement('video');
      screenVideo.srcObject = screenStreamRef.current;
      screenVideo.play();

      const cameraVideo = showCamera ? document.createElement('video') : null;
      if (cameraVideo && cameraStreamRef.current) {
        cameraVideo.srcObject = cameraStreamRef.current;
        cameraVideo.play();
      }

      canvas.width = 1920;
      canvas.height = 1080;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const composite = () => {
        if (screenVideo.readyState === screenVideo.HAVE_ENOUGH_DATA) {
          ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
        }
        if (cameraVideo && cameraVideo.readyState === cameraVideo.HAVE_ENOUGH_DATA) {
          const pipSize = 300;
          let x = canvas.width - pipSize - 20;
          let y = canvas.height - pipSize - 20;
          if (cameraPosition === 'top-left') { x = 20; y = 20; }
          else if (cameraPosition === 'top-right') { x = canvas.width - pipSize - 20; y = 20; }
          else if (cameraPosition === 'bottom-left') { x = 20; y = canvas.height - pipSize - 20; }
          ctx.drawImage(cameraVideo, x, y, pipSize, pipSize);
        }
        requestAnimationFrame(composite);
      };
      composite();

      const canvasStream = canvas.captureStream(30);
      if (screenStreamRef.current.getAudioTracks().length > 0) {
        canvasStream.addTrack(screenStreamRef.current.getAudioTracks()[0]);
      }

      mediaRecorderRef.current = new MediaRecorder(canvasStream);
      const chunks: Blob[] = [];
      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        setRecordedChunks([blob]);
      };
      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Recording error:', error);
      alert('Error: ' + (error as Error).message);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    setIsRecording(false);
  };

  const downloadRecording = () => {
    if (recordedChunks.length === 0) return;
    const url = URL.createObjectURL(recordedChunks[0]);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recording-${Date.now()}.webm`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full max-w-2xl mx-auto p-4 bg-white rounded-lg shadow">
      <h2 className="text-xl font-bold mb-4">Screen Recorder</h2>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={showCamera}
            onChange={(e) => setShowCamera(e.target.checked)}
            disabled={isRecording}
            id="camera-toggle"
          />
          <label htmlFor="camera-toggle" className="text-sm">Show Camera Overlay</label>
        </div>

        {showCamera && (
          <div>
            <label className="text-sm block mb-2">Camera Position</label>
            <div className="grid grid-cols-4 gap-2">
              {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((pos) => (
                <button
                  key={pos}
                  onClick={() => setCameraPosition(pos)}
                  disabled={isRecording}
                  className={`px-3 py-2 rounded text-sm ${cameraPosition === pos ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                >
                  {pos}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          {!isRecording ? (
            <button onClick={startRecording} className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600">
              Start Recording
            </button>
          ) : (
            <button onClick={stopRecording} className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600">
              Stop Recording
            </button>
          )}
          {recordedChunks.length > 0 && (
            <button onClick={downloadRecording} className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600">
              Download
            </button>
          )}
        </div>

        {isRecording && <div className="text-red-500 font-bold">● Recording...</div>}
      </div>
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
