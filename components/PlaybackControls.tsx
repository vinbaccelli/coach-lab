'use client';

import { useEffect, useRef, useState } from 'react';
import { SkipBack, SkipForward, Play, Pause } from 'lucide-react';

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoRefB?: React.RefObject<HTMLVideoElement | null>;
}

export default function PlaybackControls({ videoRef, videoRefB }: Props) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const isSynced = !!videoRefB;

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!videoRef.current) return;
      const video = videoRef.current;

      switch (e.key.toLowerCase()) {
        case ' ':
          e.preventDefault();
          if (video.paused) {
            video.play();
            if (isSynced) videoRefB?.current?.play();
          } else {
            video.pause();
            if (isSynced) videoRefB?.current?.pause();
          }
          break;
        case 'j':
          e.preventDefault();
          video.playbackRate = 0.5;
          if (isSynced && videoRefB?.current) videoRefB.current.playbackRate = 0.5;
          break;
        case 'k':
          e.preventDefault();
          video.playbackRate = 1.0;
          if (isSynced && videoRefB?.current) videoRefB.current.playbackRate = 1.0;
          break;
        case 'l':
          e.preventDefault();
          video.playbackRate = 2.0;
          if (isSynced && videoRefB?.current) videoRefB.current.playbackRate = 2.0;
          break;
        case 'arrowleft':
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 1 / 30);
          if (isSynced && videoRefB?.current) videoRefB.current.currentTime = video.currentTime;
          break;
        case 'arrowright':
          e.preventDefault();
          video.currentTime = Math.min(video.duration, video.currentTime + 1 / 30);
          if (isSynced && videoRefB?.current) videoRefB.current.currentTime = video.currentTime;
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [videoRef, videoRefB, isSynced]);

  // Sync video state
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handleLoadedMetadata = () => setDuration(video.duration);
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

  // Sync seeking: when video A seeks, sync video B
  const isSeeking = useRef(false);
  useEffect(() => {
    const videoA = videoRef.current;
    const videoB = videoRefB?.current;
    if (!videoA || !videoB) return;

    const onSeekA = () => {
      if (!isSeeking.current) {
        isSeeking.current = true;
        videoB.currentTime = videoA.currentTime;
        setTimeout(() => { isSeeking.current = false; }, 100);
      }
    };

    videoA.addEventListener('seeking', onSeekA);
    return () => videoA.removeEventListener('seeking', onSeekA);
  }, [videoRef, videoRefB]);

  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const toggleBoth = () => {
    const vA = videoRef.current;
    const vB = videoRefB?.current;
    if (!vA) return;
    if (vA.paused) {
      vA.play();
      vB?.play();
    } else {
      vA.pause();
      vB?.pause();
    }
  };

  const toggleA = () => {
    const vA = videoRef.current;
    const vB = videoRefB?.current;
    if (!vA) return;
    if (vA.paused) {
      vA.play();
      vB?.pause();
    } else {
      vA.pause();
    }
  };

  const toggleB = () => {
    const vA = videoRef.current;
    const vB = videoRefB?.current;
    if (!vB) return;
    if (vB.paused) {
      vB.play();
      vA?.pause();
    } else {
      vB.pause();
    }
  };

  const btnBase: React.CSSProperties = {
    width: '36px',
    height: '36px',
    borderRadius: '6px',
    border: '1px solid #E8E8ED',
    background: '#fff',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#1D1D1F',
  };

  const textBtnBase: React.CSSProperties = {
    height: '28px',
    padding: '0 10px',
    borderRadius: '6px',
    border: '1px solid #E8E8ED',
    background: '#fff',
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: 600,
    color: '#1D1D1F',
    whiteSpace: 'nowrap',
  };

  return (
    <div style={{
      height: isSynced ? '68px' : '56px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      gap: '4px',
      padding: '0 16px',
      borderTop: '1px solid #E8E8ED',
      background: '#F8F8F8',
    }}>
      {/* Dual video controls */}
      {isSynced && (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <span style={{ fontSize: '10px', color: '#6b7280', marginRight: '2px' }}>Sync:</span>
          <button style={{ ...textBtnBase, background: '#35679A', color: '#fff', border: 'none' }} onClick={toggleBoth}>
            ▶ Both
          </button>
          <button style={textBtnBase} onClick={toggleA}>
            ▶ A
          </button>
          <button style={textBtnBase} onClick={toggleB}>
            ▶ B
          </button>
        </div>
      )}

      {/* Main controls row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* Playback buttons */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {[
            { icon: SkipBack, label: 'Start', onClick: () => { if (videoRef.current) { videoRef.current.currentTime = 0; if (isSynced && videoRefB?.current) videoRefB.current.currentTime = 0; } } },
            { icon: SkipBack, label: '-1s', onClick: () => { if (videoRef.current) { videoRef.current.currentTime -= 1; if (isSynced && videoRefB?.current) videoRefB.current.currentTime -= 1; } } },
            {
              icon: isPlaying ? Pause : Play,
              label: isPlaying ? 'Pause' : 'Play',
              onClick: () => {
                if (!videoRef.current) return;
                if (videoRef.current.paused) {
                  videoRef.current.play();
                  if (isSynced) videoRefB?.current?.play();
                } else {
                  videoRef.current.pause();
                  if (isSynced) videoRefB?.current?.pause();
                }
              },
            },
            { icon: SkipForward, label: '+1s', onClick: () => { if (videoRef.current) { videoRef.current.currentTime += 1; if (isSynced && videoRefB?.current) videoRefB.current.currentTime += 1; } } },
            { icon: SkipForward, label: 'End', onClick: () => { if (videoRef.current) { videoRef.current.currentTime = videoRef.current.duration; if (isSynced && videoRefB?.current) videoRefB.current.currentTime = videoRefB.current.duration; } } },
          ].map((btn, i) => (
            <button key={i} onClick={btn.onClick} aria-label={btn.label} style={btnBase}>
              <btn.icon size={16} strokeWidth={1.5} />
            </button>
          ))}
        </div>

        {/* Scrub bar */}
        <input
          type="range"
          aria-label="Video scrubber"
          min="0"
          max={duration || 0}
          value={currentTime}
          onChange={(e) => {
            if (videoRef.current) {
              const t = parseFloat(e.target.value);
              videoRef.current.currentTime = t;
              if (isSynced && videoRefB?.current) videoRefB.current.currentTime = t;
            }
          }}
          style={{ flex: 1, height: '4px', borderRadius: '2px', cursor: 'pointer' }}
        />

        {/* Time display */}
        <div style={{ fontSize: '12px', color: '#6b7280', minWidth: '80px', textAlign: 'right' }}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>
      </div>
    </div>
  );
}
