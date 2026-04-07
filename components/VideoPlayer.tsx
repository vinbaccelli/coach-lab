'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronLeft,
  ChevronRight,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { stepForward, stepBackward, formatTime, SPEED_OPTIONS, SKIP_OPTIONS } from '@/lib/videoUtils';

interface VideoPlayerProps {
  onVideoReady: (video: HTMLVideoElement) => void;
  videoRef: React.RefObject<HTMLVideoElement>;
  containerRef: React.RefObject<HTMLDivElement>;
}

export default function VideoPlayer({
  onVideoReady,
  videoRef,
  containerRef,
}: VideoPlayerProps) {
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [skipAmount, setSkipAmount] = useState(SKIP_OPTIONS[0].value);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const srcUrlRef = useRef<string | null>(null);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (srcUrlRef.current) URL.revokeObjectURL(srcUrlRef.current);
      const url = URL.createObjectURL(file);
      srcUrlRef.current = url;
      setVideoSrc(url);
    },
    [],
  );

  const handleVideoLoaded = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration);
    setCurrentTime(0);
    onVideoReady(v);
  }, [videoRef, onVideoReady]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      setIsPlaying(true);
    } else {
      v.pause();
      setIsPlaying(false);
    }
  }, [videoRef]);

  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (v) setCurrentTime(v.currentTime);
  }, [videoRef]);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const seek = useCallback(
    (val: number) => {
      const v = videoRef.current;
      if (!v) return;
      v.currentTime = val;
      setCurrentTime(val);
    },
    [videoRef],
  );

  const handleSpeedChange = useCallback(
    (val: number) => {
      const v = videoRef.current;
      if (v) v.playbackRate = val;
      setSpeed(val);
    },
    [videoRef],
  );

  const handleMuteToggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setIsMuted(v.muted);
  }, [videoRef]);

  const handleStepBack = useCallback(() => {
    const v = videoRef.current;
    if (v) {
      stepBackward(v);
      setIsPlaying(false);
    }
  }, [videoRef]);

  const handleStepForward = useCallback(() => {
    const v = videoRef.current;
    if (v) {
      stepForward(v);
      setIsPlaying(false);
    }
  }, [videoRef]);

  const handleSkipBack = useCallback(() => {
    const v = videoRef.current;
    if (v) {
      v.currentTime = Math.max(0, v.currentTime - skipAmount);
    }
  }, [videoRef, skipAmount]);

  const handleSkipForward = useCallback(() => {
    const v = videoRef.current;
    if (v) {
      v.currentTime = Math.min(v.duration, v.currentTime + skipAmount);
    }
  }, [videoRef, skipAmount]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (['INPUT', 'TEXTAREA'].includes(tag)) return;
      if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowLeft') {
        e.shiftKey ? handleStepBack() : handleSkipBack();
      } else if (e.key === 'ArrowRight') {
        e.shiftKey ? handleStepForward() : handleSkipForward();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, handleStepBack, handleStepForward, handleSkipBack, handleSkipForward]);

  return (
    <div className="flex flex-col h-full">
      {/* Video container */}
      <div
        ref={containerRef}
        className="relative flex-1 bg-black rounded-t-lg overflow-hidden flex items-center justify-center"
      >
        {!videoSrc ? (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center gap-3 text-gray-400 hover:text-blue-500 transition-colors group"
          >
            <div className="w-20 h-20 rounded-full bg-gray-800 group-hover:bg-blue-900/40 flex items-center justify-center transition-colors">
              <Upload size={36} />
            </div>
            <span className="text-sm font-medium">Click to upload video</span>
            <span className="text-xs text-gray-500">MP4, WebM, MOV supported</span>
          </button>
        ) : (
          <video
            ref={videoRef}
            src={videoSrc}
            onLoadedMetadata={handleVideoLoaded}
            onTimeUpdate={handleTimeUpdate}
            onEnded={handleEnded}
            className="absolute inset-0 w-full h-full object-contain"
            playsInline
          />
        )}
      </div>

      {/* Controls bar */}
      <div className="bg-white border border-gray-200 rounded-b-lg px-3 py-2 flex flex-col gap-2">
        {/* Timeline */}
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="w-14 text-right font-mono">{formatTime(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.001}
            value={currentTime}
            onChange={(e) => seek(Number(e.target.value))}
            disabled={!videoSrc}
            className="flex-1"
          />
          <span className="w-14 font-mono">{formatTime(duration)}</span>
        </div>

        {/* Playback controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={handleSkipBack}
              disabled={!videoSrc}
              className="btn-ghost rounded-lg"
              title={`Skip back (←)`}
            >
              <SkipBack size={16} />
            </button>
            <button
              onClick={handleStepBack}
              disabled={!videoSrc}
              className="btn-ghost rounded-lg"
              title="Previous frame (Shift+←)"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={togglePlay}
              disabled={!videoSrc}
              className="btn-primary rounded-lg w-10 h-10"
              title="Play/Pause (Space)"
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button
              onClick={handleStepForward}
              disabled={!videoSrc}
              className="btn-ghost rounded-lg"
              title="Next frame (Shift+→)"
            >
              <ChevronRight size={16} />
            </button>
            <button
              onClick={handleSkipForward}
              disabled={!videoSrc}
              className="btn-ghost rounded-lg"
              title={`Skip forward (→)`}
            >
              <SkipForward size={16} />
            </button>
            <button
              onClick={handleMuteToggle}
              disabled={!videoSrc}
              className="btn-ghost rounded-lg"
              title="Mute/Unmute"
            >
              {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
          </div>

          {/* Speed */}
          <div className="flex items-center gap-1">
            {SPEED_OPTIONS.map((s) => (
              <button
                key={s.value}
                onClick={() => handleSpeedChange(s.value)}
                disabled={!videoSrc}
                className={`px-2 py-1 text-xs rounded-md transition-colors ${
                  speed === s.value
                    ? 'bg-blue-100 text-blue-700 font-semibold'
                    : 'hover:bg-gray-100 text-gray-600'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Skip amount selector */}
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <span className="mr-1">Skip:</span>
          {SKIP_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              onClick={() => setSkipAmount(opt.value)}
              disabled={!videoSrc}
              className={`px-2 py-0.5 rounded-md transition-colors ${
                skipAmount === opt.value
                  ? 'bg-blue-100 text-blue-700 font-semibold'
                  : 'hover:bg-gray-100 text-gray-600'
              }`}
              title={`Skip ${opt.label} (~${(opt.value * 1000).toFixed(1)}ms at 60fps)`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Upload button */}
        <div className="flex justify-end">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="btn-outline text-xs gap-1.5 py-1"
          >
            <Upload size={12} />
            {videoSrc ? 'Replace Video' : 'Upload Video'}
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,video/*"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}