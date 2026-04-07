'use client';

import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Square } from 'lucide-react';

const PLAYBACK_SPEEDS = [0.05, 0.1, 0.25, 0.5, 1, 1.5, 2] as const;
const FRAME_MODES = [10, 30, 60] as const;
type FrameMode = typeof FRAME_MODES[number];

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
  const [frameMode, setFrameMode] = useState<FrameMode>(60);

  const frameModeRef = useRef<FrameMode>(60);
  useEffect(() => { frameModeRef.current = frameMode; }, [frameMode]);

  const isSynced = !!videoRefB;

  // ── Keyboard: Frame step with arrow keys ──────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video || video.duration === 0) return;

      // Don't capture if typing in input
      if (document.activeElement?.tagName === 'INPUT') return;

      const fps = frameModeRef.current;
      const frameTime = 1 / fps;

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        video.pause();
        const newTime = Math.min(video.duration, video.currentTime + frameTime);
        video.currentTime = newTime;
        setCurrentTimeA(newTime);
        // Also step video B if synced
        if (isSynced && videoRefB?.current) {
          videoRefB.current.currentTime = newTime;
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        video.pause();
        const newTime = Math.max(0, video.currentTime - frameTime);
        video.currentTime = newTime;
        setCurrentTimeA(newTime);
        // Also step video B if synced
        if (isSynced && videoRefB?.current) {
          videoRefB.current.currentTime = newTime;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSynced, videoRefB, videoRef]);

  // ── Space: Play/Pause both ────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return;

      if (e.key === ' ') {
        e.preventDefault();
        const vA = videoRef.current;
        const vB = videoRefB?.current;
        if (!vA) return;

        if (vA.paused) {
          vA.play().catch(() => {});
          if (isSynced && vB) vB.play().catch(() => {});
          setIsPlayingA(true);
          if (isSynced) setIsPlayingB(true);
        } else {
          vA.pause();
          if (isSynced && vB) vB.pause();
          setIsPlayingA(false);
          if (isSynced) setIsPlayingB(false);
        }
      }

      // J/K/L for speed
      if (e.key.toLowerCase() === 'j') {
        e.preventDefault();
        if (videoRef.current) videoRef.current.playbackRate = 0.5;
        if (videoRefB?.current) videoRefB.current.playbackRate = 0.5;
        setPlaybackRate(0.5);
      } else if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (videoRef.current) videoRef.current.playbackRate = 1.0;
        if (videoRefB?.current) videoRefB.current.playbackRate = 1.0;
        setPlaybackRate(1.0);
      } else if (e.key.toLowerCase() === 'l') {
        e.preventDefault();
        if (videoRef.current) videoRef.current.playbackRate = 2.0;
        if (videoRefB?.current) videoRefB.current.playbackRate = 2.0;
        setPlaybackRate(2.0);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSynced, videoRefB, videoRef]);

  // ── Video A state sync ────────────────────────────────────────────────────
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

  // ── Video B state sync (independent) ──────────────────────────────────────
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
            width: 32,
            height: 32,
            border: 'none',
            borderRadius: 6,
            background: isPlayingA ? '#35679A' : '#E8E8ED',
            color: isPlayingA ? '#fff' : '#1D1D1F',
            fontSize: 14,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title="Play/Pause (Space)"
        >
          {isPlayingA ? <Pause size={16} /> : <Play size={16} />}
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
            width: 32,
            height: 32,
            border: 'none',
            borderRadius: 6,
            background: '#E8E8ED',
            color: '#1D1D1F',
            fontSize: 14,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title="Stop"
        >
          <Square size={14} fill="#1D1D1F" />
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
              width: 32,
              height: 32,
              border: 'none',
              borderRadius: 6,
              background: isPlayingB ? '#FF9500' : '#E8E8ED',
              color: isPlayingB ? '#fff' : '#1D1D1F',
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="Play/Pause Video B"
          >
            {isPlayingB ? <Pause size={16} /> : <Play size={16} />}
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
              width: 32,
              height: 32,
              border: 'none',
              borderRadius: 6,
              background: '#E8E8ED',
              color: '#1D1D1F',
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="Stop Video B"
          >
            <Square size={14} fill="#1D1D1F" />
          </button>

          {/* Remove B button */}
          <button
            onClick={onRemoveVideoB}
            style={{
              width: 32,
              height: 32,
              border: 'none',
              borderRadius: 6,
              background: '#FFE5E5',
              color: '#EF4444',
              fontSize: 16,
              cursor: 'pointer',
              fontWeight: 600,
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
            onClick={() => setFrameMode(fm)}
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
