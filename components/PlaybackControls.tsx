'use client';

import { useEffect, useRef, useState } from 'react';
import { SkipBack, SkipForward, Play, Pause } from 'lucide-react';

interface Props {
  videoRef: React.RefObject<HTMLVideoElement>;
}

export default function PlaybackControls({ videoRef }: Props) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!videoRef.current) return;
      const video = videoRef.current;

      switch (e.key.toLowerCase()) {
        case ' ':
          e.preventDefault();
          if (video.paused) video.play();
          else video.pause();
          break;
        case 'j':
          e.preventDefault();
          video.playbackRate = 0.5;
          break;
        case 'k':
          e.preventDefault();
          video.playbackRate = 1.0;
          break;
        case 'l':
          e.preventDefault();
          video.playbackRate = 2.0;
          break;
        case 'arrowleft':
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 1 / 30);
          break;
        case 'arrowright':
          e.preventDefault();
          video.currentTime = Math.min(video.duration, video.currentTime + 1 / 30);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [videoRef]);

  // Sync video state
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
    };

    const handleLoadedMetadata = () => {
      setDuration(video.duration);
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
    };
  }, [videoRef]);

  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{
      height: '56px',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '0 16px',
      borderTop: 'var(--border)',
      background: 'var(--bg-secondary)',
    }}>
      {/* Playback buttons */}
      <div style={{ display: 'flex', gap: '4px' }}>
        {[
          { icon: SkipBack, label: 'Start', onClick: () => { if (videoRef.current) videoRef.current.currentTime = 0; } },
          { icon: SkipBack, label: '-1s', onClick: () => { if (videoRef.current) videoRef.current.currentTime -= 1; } },
          {
            icon: isPlaying ? Pause : Play,
            label: isPlaying ? 'Pause' : 'Play',
            onClick: () => { if (videoRef.current) videoRef.current.paused ? videoRef.current.play() : videoRef.current.pause(); },
          },
          { icon: SkipForward, label: '+1s', onClick: () => { if (videoRef.current) videoRef.current.currentTime += 1; } },
          { icon: SkipForward, label: 'End', onClick: () => { if (videoRef.current) videoRef.current.currentTime = videoRef.current.duration; } },
        ].map((btn, i) => (
          <button key={i} onClick={btn.onClick} style={{
            width: '36px',
            height: '36px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)',
            background: 'var(--bg-primary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-primary)',
          }}>
            <btn.icon size={16} strokeWidth={1.5} />
          </button>
        ))}
      </div>

      {/* Scrub bar */}
      <input
        type="range"
        min="0"
        max={duration || 0}
        value={currentTime}
        onChange={(e) => {
          if (videoRef.current) {
            videoRef.current.currentTime = parseFloat(e.target.value);
          }
        }}
        style={{
          flex: 1,
          height: '4px',
          borderRadius: '2px',
          cursor: 'pointer',
        }}
      />

      {/* Time display */}
      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', minWidth: '80px', textAlign: 'right' }}>
        {formatTime(currentTime)} / {formatTime(duration)}
      </div>
    </div>
  );
}
