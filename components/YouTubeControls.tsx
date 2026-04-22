'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 1.5, 2] as const;

function formatTime(seconds: number): string {
  if (isNaN(seconds) || !isFinite(seconds)) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export default function YouTubeControls({
  playerRef,
}: {
  playerRef: React.MutableRefObject<any | null>;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [frameMode, setFrameMode] = useState(60);

  const frameModeRef = useRef(frameMode);
  useEffect(() => { frameModeRef.current = frameMode; }, [frameMode]);

  const poll = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    try {
      const t = p.getCurrentTime?.() ?? 0;
      const d = p.getDuration?.() ?? 0;
      setCurrentTime(Number.isFinite(t) ? t : 0);
      setDuration(Number.isFinite(d) ? d : 0);
      const s = p.getPlayerState?.();
      setIsPlaying(s === 1);
      const r = p.getPlaybackRate?.();
      if (typeof r === 'number') setPlaybackRate(r);
    } catch {
      // ignore
    }
  }, [playerRef]);

  useEffect(() => {
    const id = setInterval(poll, 200);
    return () => clearInterval(id);
  }, [poll]);

  const playPause = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (isPlaying) p.pauseVideo?.();
    else p.playVideo?.();
  }, [isPlaying, playerRef]);

  const seekTo = useCallback((t: number) => {
    const p = playerRef.current;
    if (!p) return;
    const clamped = Math.max(0, Math.min(duration || t, t));
    p.seekTo?.(clamped, true);
  }, [duration, playerRef]);

  const stepFrame = useCallback((dir: 1 | -1) => {
    const step = 1 / frameModeRef.current;
    seekTo(currentTime + dir * step);
  }, [currentTime, seekTo]);

  const setRate = useCallback((r: number) => {
    const p = playerRef.current;
    if (!p) return;
    p.setPlaybackRate?.(r);
    setPlaybackRate(r);
  }, [playerRef]);

  const btnStyle: React.CSSProperties = useMemo(() => ({
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: 30,
    width: 30,
    background: '#fff',
  }), []);

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={playPause} style={{ ...btnStyle, width: 56 }}>
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button onClick={() => stepFrame(-1)} style={btnStyle} title="Back 1 frame">◀</button>
        <button onClick={() => stepFrame(1)} style={btnStyle} title="Forward 1 frame">▶</button>

        <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#35679A', fontWeight: 700, marginLeft: 4 }}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <span style={{ fontSize: 11, color: '#6b7280' }}>Speed</span>
          {PLAYBACK_SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setRate(s)}
              style={{
                ...btnStyle,
                width: 44,
                background: playbackRate === s ? '#35679A' : '#fff',
                color: playbackRate === s ? '#fff' : '#1D1D1F',
              }}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 11, color: '#6b7280', minWidth: 60 }}>Frame</span>
        {[10, 30, 60].map((f) => (
          <button
            key={f}
            onClick={() => setFrameMode(f)}
            style={{
              ...btnStyle,
              width: 44,
              background: frameMode === f ? '#35679A' : '#fff',
              color: frameMode === f ? '#fff' : '#1D1D1F',
            }}
          >
            {f}
          </button>
        ))}
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.01}
          value={Math.min(currentTime, duration || currentTime)}
          onChange={(e) => seekTo(Number(e.target.value))}
          style={{ width: '100%' }}
        />
      </div>
    </div>
  );
}

