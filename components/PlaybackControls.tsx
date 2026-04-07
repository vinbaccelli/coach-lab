'use client';

import { useEffect, useRef, useState } from 'react';

const PLAYBACK_SPEEDS = [0.05, 0.1, 0.25, 0.5, 1, 1.5, 2] as const;
const FRAME_MODES = [10, 30, 60] as const;

function formatSpeed(s: number): string {
  if (s === 0.05) return '1/20×';
  if (s === 0.1) return '1/10×';
  return `${s}×`;
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || !isFinite(seconds)) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoRefB?: React.RefObject<HTMLVideoElement | null>;
  onRemoveVideoB?: () => void;
}

export default function PlaybackControls({ videoRef, videoRefB, onRemoveVideoB }: Props) {
  const [isPlayingA, setIsPlayingA] = useState(false);
  const [isPlayingB, setIsPlayingB] = useState(false);
  const [currentTimeA, setCurrentTimeA] = useState(0);
  const [durationA, setDurationA] = useState(0);
  const [currentTimeB, setCurrentTimeB] = useState(0);
  const [durationB, setDurationB] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [frameMode, setFrameMode] = useState(60);

  const frameModeRef = useRef(60);
  useEffect(() => {
    frameModeRef.current = frameMode;
  }, [frameMode]);

  const isSynced = !!videoRefB;

  // ── Arrow Keys: Frame stepping ──────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;

      // Ignore if typing in an input
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }

      const isArrowRight = e.key === 'ArrowRight';
      const isArrowLeft = e.key === 'ArrowLeft';

      if (!isArrowRight && !isArrowLeft) return;

      e.preventDefault();
      video.pause();
      if (isSynced && videoRefB?.current) videoRefB.current.pause();

      const frameSize = 1 / frameModeRef.current;
      let newTime = video.currentTime;

      if (isArrowRight) {
        newTime = Math.min(video.duration || 0, newTime + frameSize);
      } else if (isArrowLeft) {
        newTime = Math.max(0, newTime - frameSize);
      }

      video.currentTime = newTime;
      setCurrentTimeA(newTime);

      if (isSynced && videoRefB?.current) {
        videoRefB.current.currentTime = newTime;
        setCurrentTimeB(newTime);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSynced, videoRef, videoRefB]);

  // ── Space: Play/Pause both ────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== ' ') return;
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      e.preventDefault();

      const vA = videoRef.current;
      const vB = videoRefB?.current;
      if (!vA) return;

      if (vA.paused) {
        vA.play().catch(() => {});
        if (isSynced && vB) vB.play().catch(() => {});
      } else {
        vA.pause();
        if (isSynced && vB) vB.pause();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSynced, videoRef, videoRefB]);

  // ── J/K/L: Speed control ────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      const vA = videoRef.current;
      const vB = videoRefB?.current;
      const key = e.key.toLowerCase();

      if (key === 'j') {
        e.preventDefault();
        if (vA) vA.playbackRate = 0.5;
        if (isSynced && vB) vB.playbackRate = 0.5;
        setPlaybackRate(0.5);
      } else if (key === 'k') {
        e.preventDefault();
        if (vA) vA.playbackRate = 1.0;
        if (isSynced && vB) vB.playbackRate = 1.0;
        setPlaybackRate(1.0);
      } else if (key === 'l') {
        e.preventDefault();
        if (vA) vA.playbackRate = 2.0;
        if (isSynced && vB) vB.playbackRate = 2.0;
        setPlaybackRate(2.0);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSynced, videoRef, videoRefB]);

  // ── Video A state sync ──────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => setCurrentTimeA(video.currentTime);
    const handleLoadedMetadata = () => setDurationA(video.duration);
    const handlePlay = () => setIsPlayingA(true);
    const handlePause = () => setIsPlayingA(false);

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

  // ── Video B state sync (independent) ────────────────────────────────────
  useEffect(() => {
    const videoB = videoRefB?.current;
    if (!videoB) return;

    const handleTimeUpdate = () => setCurrentTimeB(videoB.currentTime);
    const handleLoadedMetadata = () => setDurationB(videoB.duration);
    const handlePlay = () => setIsPlayingB(true);
    const handlePause = () => setIsPlayingB(false);

    videoB.addEventListener('timeupdate', handleTimeUpdate);
    videoB.addEventListener('loadedmetadata', handleLoadedMetadata);
    videoB.addEventListener('play', handlePlay);
    videoB.addEventListener('pause', handlePause);

    return () => {
      videoB.removeEventListener('timeupdate', handleTimeUpdate);
      videoB.removeEventListener('loadedmetadata', handleLoadedMetadata);
      videoB.removeEventListener('play', handlePlay);
      videoB.removeEventListener('pause', handlePause);
    };
  }, [videoRefB]);

  const frameSizeMs = (1000 / frameMode).toFixed(2);

  const btnStyle: React.CSSProperties = {
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: 32,
    width: 32,
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      padding: '8px 16px',
      borderTop: '1px solid #E8E8ED',
      background: '#F8F8F8',
      flexShrink: 0,
    }}>

      {/* VIDEO A ROW */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#35679A', width: 24 }}>A</span>

        {/* Play/Pause */}
        <button
          onClick={() => {
            const v = videoRef.current;
            if (!v) return;
            if (v.paused) {
              v.play().catch(() => {});
              setIsPlayingA(true);
            } else {
              v.pause();
              setIsPlayingA(false);
            }
          }}
          style={{
            ...btnStyle,
            background: isPlayingA ? '#35679A' : '#E8E8ED',
            color: isPlayingA ? '#fff' : '#1D1D1F',
          }}
          title="Play/Pause (Space)"
        >
          {isPlayingA ? '⏸' : '▶'}
        </button>

        {/* Stop */}
        <button
          onClick={() => {
            const v = videoRef.current;
            if (v) {
              v.pause();
              v.currentTime = 0;
              setCurrentTimeA(0);
              setIsPlayingA(false);
            }
          }}
          style={{
            ...btnStyle,
            background: '#E8E8ED',
            color: '#1D1D1F',
          }}
          title="Stop"
        >
          ⏹
        </button>

        {/* Timeline with time markers */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <input
            type="range"
            min="0"
            max={durationA || 100}
            step="0.01"
            value={currentTimeA}
            onChange={(e) => {
              const t = parseFloat(e.target.value);
              if (videoRef.current) {
                videoRef.current.currentTime = t;
                setCurrentTimeA(t);
              }
            }}
            style={{
              width: '100%',
              height: 6,
              borderRadius: 3,
              outline: 'none',
              cursor: 'pointer',
              background: '#D1D5DB',
              accentColor: '#35679A',
            }}
          />
          {/* Time display below slider */}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#6E6E73' }}>
            <span>{formatTime(currentTimeA)}</span>
            <span>{formatTime(durationA)}</span>
          </div>
        </div>
      </div>

      {/* VIDEO B ROW — Only if loaded */}
      {isSynced && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          borderTop: '1px solid #E8E8ED',
          paddingTop: '6px',
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#FF9500', width: 24 }}>B</span>

          {/* Play/Pause */}
          <button
            onClick={() => {
              const v = videoRefB?.current;
              if (!v) return;
              if (v.paused) {
                v.play().catch(() => {});
                setIsPlayingB(true);
              } else {
                v.pause();
                setIsPlayingB(false);
              }
            }}
            style={{
              ...btnStyle,
              background: isPlayingB ? '#FF9500' : '#E8E8ED',
              color: isPlayingB ? '#fff' : '#1D1D1F',
            }}
            title="Play/Pause Video B"
          >
            {isPlayingB ? '⏸' : '▶'}
          </button>

          {/* Stop */}
          <button
            onClick={() => {
              const v = videoRefB?.current;
              if (v) {
                v.pause();
                v.currentTime = 0;
                setCurrentTimeB(0);
                setIsPlayingB(false);
              }
            }}
            style={{
              ...btnStyle,
              background: '#E8E8ED',
              color: '#1D1D1F',
            }}
            title="Stop Video B"
          >
            ⏹
          </button>

          {/* Remove B button */}
          <button
            onClick={onRemoveVideoB}
            style={{
              ...btnStyle,
              background: '#FFE5E5',
              color: '#EF4444',
              fontSize: 16,
            }}
            title="Remove Video B"
          >
            ✕
          </button>

          {/* Timeline with time markers */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <input
              type="range"
              min="0"
              max={durationB || 100}
              step="0.01"
              value={currentTimeB}
              onChange={(e) => {
                const t = parseFloat(e.target.value);
                if (videoRefB?.current) {
                  videoRefB.current.currentTime = t;
                  setCurrentTimeB(t);
                }
              }}
              style={{
                width: '100%',
                height: 6,
                borderRadius: 3,
                outline: 'none',
                cursor: 'pointer',
                background: '#D1D5DB',
                accentColor: '#FF9500',
              }}
            />
            {/* Time display below slider */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#6E6E73' }}>
              <span>{formatTime(currentTimeB)}</span>
              <span>{formatTime(durationB)}</span>
            </div>
          </div>
        </div>
      )}

      {/* PLAYBACK SPEED + FRAME STEP ROW */}
      <div style={{
        display: 'flex',
        gap: '8px',
        alignItems: 'center',
        flexWrap: 'wrap',
        borderTop: '1px solid #E8E8ED',
        paddingTop: '6px',
      }}>
        <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600 }}>Speed:</span>
        {PLAYBACK_SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => {
              if (videoRef.current) videoRef.current.playbackRate = s;
              if (isSynced && videoRefB?.current) videoRefB.current.playbackRate = s;
              setPlaybackRate(s);
            }}
            style={{
              height: 24,
              padding: '0 7px',
              borderRadius: 5,
              fontSize: 10,
              fontWeight: 600,
              border: '1px solid',
              borderColor: playbackRate === s ? '#35679A' : '#E8E8ED',
              background: playbackRate === s ? '#35679A' : '#fff',
              color: playbackRate === s ? '#fff' : '#1D1D1F',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {formatSpeed(s)}
          </button>
        ))}

        <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, marginLeft: '8px' }}>
          Frame:
        </span>
        {FRAME_MODES.map((fm) => (
          <button
            key={fm}
            onClick={() => {
              setFrameMode(fm);
            }}
            title={`← → steps by ${(1000 / fm).toFixed(2)}ms per frame`}
            style={{
              height: 24,
              padding: '0 7px',
              borderRadius: 5,
              fontSize: 10,
              fontWeight: 600,
              border: '1px solid',
              borderColor: frameMode === fm ? '#7C3AED' : '#E8E8ED',
              background: frameMode === fm ? '#7C3AED' : '#fff',
              color: frameMode === fm ? '#fff' : '#1D1D1F',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {fm}fps
          </button>
        ))}
        <span style={{ fontSize: 10, color: '#7C3AED', fontWeight: 600 }}>
          {frameSizeMs}ms/frame
        </span>
      </div>
    </div>
  );
}
