'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { useStore } from '@/lib/store';

const SPEEDS = [0.1, 0.25, 0.5, 1, 2];

interface Props {
  onFrameChange?: (frameIndex: number) => void;
}

export default function VideoPlayer({ onFrameChange }: Props) {
  const { video, setVideoFile, setCurrentTime, setDuration, setFPS } = useStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loopStart, setLoopStart] = useState<number | null>(null);
  const [loopEnd, setLoopEnd] = useState<number | null>(null);
  const [isLooping, setIsLooping] = useState(false);
  const [objectUrl, setObjectUrl] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (video.file) {
      const url = URL.createObjectURL(video.file);
      setObjectUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [video.file]);

  const getFrameIndex = useCallback((time: number) => {
    return Math.round(time * video.fps);
  }, [video.fps]);

  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    setCurrentTime(v.currentTime);
    onFrameChange?.(getFrameIndex(v.currentTime));

    if (isLooping && loopEnd !== null && v.currentTime >= loopEnd) {
      v.currentTime = loopStart ?? 0;
    }
  };

  const handleLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration);
    setFPS(30);
  };

  const stepFrame = (dir: 1 | -1) => {
    const v = videoRef.current;
    if (!v) return;
    const frameTime = 1 / video.fps;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + dir * frameTime));
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) {
      v.pause();
    } else {
      v.play();
    }
    setIsPlaying(!isPlaying);
  };

  const setLoopPoint = (point: 'start' | 'end') => {
    const v = videoRef.current;
    if (!v) return;
    if (point === 'start') setLoopStart(v.currentTime);
    else setLoopEnd(v.currentTime);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setVideoFile(file);
  };

  const formatTime = (t: number) => {
    const m = Math.floor(t / 60).toString().padStart(2, '0');
    const s = (t % 60).toFixed(2).padStart(5, '0');
    return `${m}:${s}`;
  };

  if (!video.file) {
    return (
      <div
        className="flex flex-col items-center justify-center h-64 rounded-2xl border-2 border-dashed border-gray-300 bg-white cursor-pointer hover:border-[#007AFF] hover:bg-blue-50 transition-all"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file?.type.startsWith('video/')) setVideoFile(file);
        }}
      >
        <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={handleFileSelect} />
        <div className="text-5xl mb-3">🎬</div>
        <p className="text-gray-600 font-medium">Tap to upload video</p>
        <p className="text-gray-400 text-sm mt-1">Or drag & drop</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative video-container rounded-2xl overflow-hidden bg-black">
        <video
          ref={videoRef}
          src={objectUrl}
          className="w-full max-h-[50vh] object-contain"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          playsInline
          style={{ display: 'block' }}
        />
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 font-mono w-16">{formatTime(video.currentTime)}</span>
        <input
          type="range"
          min={0}
          max={video.duration || 1}
          step={1 / video.fps}
          value={video.currentTime}
          onChange={(e) => {
            const v = videoRef.current;
            if (v) v.currentTime = parseFloat(e.target.value);
          }}
          className="flex-1"
        />
        <span className="text-xs text-gray-500 font-mono w-16 text-right">{formatTime(video.duration)}</span>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <button
            onClick={() => stepFrame(-1)}
            className="tool-btn bg-white shadow-sm border border-gray-200 hover:bg-gray-50"
            title="Previous frame"
          >
            ◀
          </button>
          <button
            onClick={togglePlay}
            className="tool-btn bg-[#007AFF] text-white shadow-sm hover:bg-blue-600"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button
            onClick={() => stepFrame(1)}
            className="tool-btn bg-white shadow-sm border border-gray-200 hover:bg-gray-50"
            title="Next frame"
          >
            ▶
          </button>
        </div>

        <div className="flex items-center gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => {
                setSpeed(s);
                if (videoRef.current) videoRef.current.playbackRate = s;
              }}
              className={`px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
                speed === s ? 'bg-[#007AFF] text-white' : 'bg-white border border-gray-200 text-gray-600'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setLoopPoint('start')}
            className="px-2 py-1 rounded-lg text-xs font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            title="Set loop start"
          >
            A {loopStart !== null ? `(${loopStart.toFixed(1)}s)` : ''}
          </button>
          <button
            onClick={() => setLoopPoint('end')}
            className="px-2 py-1 rounded-lg text-xs font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            title="Set loop end"
          >
            B {loopEnd !== null ? `(${loopEnd.toFixed(1)}s)` : ''}
          </button>
          <button
            onClick={() => setIsLooping(!isLooping)}
            className={`px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
              isLooping ? 'bg-orange-500 text-white' : 'bg-white border border-gray-200 text-gray-600'
            }`}
            title="Toggle A→B loop"
          >
            {isLooping ? '⏹ Loop' : '🔁 Loop'}
          </button>
        </div>

        <button
          onClick={() => fileInputRef.current?.click()}
          className="px-2 py-1 rounded-lg text-xs font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
        >
          📁 Change
        </button>
        <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={handleFileSelect} />
      </div>
    </div>
  );
}
