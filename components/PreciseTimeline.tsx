'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

type Source =
  | { kind: 'html'; videoRef: React.RefObject<HTMLVideoElement | null> }
  | { kind: 'youtube'; playerRef: React.MutableRefObject<any | null> };

export default function PreciseTimeline({
  source,
  defaultFps = 30,
  accent = '#35679A',
}: {
  source: Source;
  defaultFps?: number;
  accent?: string;
}) {
  const STORAGE_MODE_KEY = 'coachlab.timeline.fpsMode';
  const STORAGE_CUSTOM_KEY = 'coachlab.timeline.customFps';

  const [fpsMode, setFpsMode] = useState<'auto' | '30' | '60' | '120' | 'custom'>('30');
  const [customFps, setCustomFps] = useState(defaultFps);
  const [autoFps, setAutoFps] = useState<number | null>(null);

  // Load persisted FPS choice (once)
  useEffect(() => {
    try {
      const savedMode = window.localStorage.getItem(STORAGE_MODE_KEY) as any;
      const savedCustom = window.localStorage.getItem(STORAGE_CUSTOM_KEY);
      const parsedCustom = savedCustom ? Number(savedCustom) : NaN;

      if (savedMode === 'auto' || savedMode === '30' || savedMode === '60' || savedMode === '120' || savedMode === 'custom') {
        setFpsMode(savedMode);
      } else if (defaultFps === 30 || defaultFps === 60 || defaultFps === 120) {
        setFpsMode(String(defaultFps) as '30' | '60' | '120');
      } else {
        setFpsMode('custom');
      }

      if (Number.isFinite(parsedCustom)) setCustomFps(parsedCustom);
      else setCustomFps(defaultFps);
    } catch {
      // ignore
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist FPS choice
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_MODE_KEY, fpsMode);
      window.localStorage.setItem(STORAGE_CUSTOM_KEY, String(customFps));
    } catch {
      // ignore
    }
  }, [customFps, fpsMode]);

  useEffect(() => {
    if (source.kind !== 'html') { setAutoFps(null); return; }
    const v = source.videoRef.current;
    if (!v) { setAutoFps(null); return; }

    const anyV = v as any;
    if (typeof anyV.requestVideoFrameCallback !== 'function') {
      setAutoFps(null);
      return;
    }

    let cancelled = false;
    const stamps: number[] = [];
    let id = 0;

    const onFrame = (_now: number, meta: { mediaTime: number }) => {
      if (cancelled) return;
      stamps.push(meta.mediaTime);
      if (stamps.length > 24) stamps.shift();

      if (stamps.length >= 12) {
        const diffs: number[] = [];
        for (let i = 1; i < stamps.length; i++) {
          const dt = stamps[i] - stamps[i - 1];
          if (dt > 0 && dt < 0.2) diffs.push(dt);
        }
        if (diffs.length >= 8) {
          diffs.sort((a, b) => a - b);
          const mid = diffs[Math.floor(diffs.length / 2)];
          const est = 1 / mid;
          const cleaned = Math.round(Math.max(10, Math.min(240, est)) * 10) / 10;
          setAutoFps(cleaned);
        }
      }

      id = anyV.requestVideoFrameCallback(onFrame);
    };

    id = anyV.requestVideoFrameCallback(onFrame);
    return () => {
      cancelled = true;
      try { anyV.cancelVideoFrameCallback?.(id); } catch {}
    };
  }, [source]);

  const selectedFps = (() => {
    if (fpsMode === 'auto') return autoFps ?? 30;
    if (fpsMode === '30') return 30;
    if (fpsMode === '60') return 60;
    if (fpsMode === '120') return 120;
    return Math.max(1, Math.min(240, customFps || 30));
  })();

  const frameStep = 1 / selectedFps;
  const frameStepRef = useRef(frameStep);
  useEffect(() => { frameStepRef.current = 1 / selectedFps; }, [selectedFps]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [d, setD] = useState(0);

  const readState = useCallback(() => {
    if (source.kind === 'html') {
      const v = source.videoRef.current;
      if (!v) return;
      setT(v.currentTime || 0);
      setD(Number.isFinite(v.duration) ? v.duration : 0);
      setIsPlaying(!v.paused);
      return;
    }

    const p = source.playerRef.current;
    if (!p) return;
    try {
      const cur = Number(p.getCurrentTime?.() ?? 0);
      const dur = Number(p.getDuration?.() ?? 0);
      const state = p.getPlayerState?.();
      setT(Number.isFinite(cur) ? cur : 0);
      setD(Number.isFinite(dur) ? dur : 0);
      setIsPlaying(state === 1);
    } catch {
      // ignore
    }
  }, [source]);

  // Sync from source
  useEffect(() => {
    if (source.kind === 'html') {
      const v = source.videoRef.current;
      if (!v) return;

      const onTime = () => setT(v.currentTime || 0);
      const onMeta = () => setD(Number.isFinite(v.duration) ? v.duration : 0);
      const onPlay = () => setIsPlaying(true);
      const onPause = () => setIsPlaying(false);

      v.addEventListener('timeupdate', onTime);
      v.addEventListener('loadedmetadata', onMeta);
      v.addEventListener('play', onPlay);
      v.addEventListener('pause', onPause);
      onMeta();
      onTime();

      return () => {
        v.removeEventListener('timeupdate', onTime);
        v.removeEventListener('loadedmetadata', onMeta);
        v.removeEventListener('play', onPlay);
        v.removeEventListener('pause', onPause);
      };
    }

    const id = window.setInterval(readState, 100);
    readState();
    return () => window.clearInterval(id);
  }, [readState, source]);

  const seekTo = useCallback((next: number) => {
    const nextClamped = clamp(next, 0, d || next);
    if (source.kind === 'html') {
      const v = source.videoRef.current;
      if (!v) return;
      v.currentTime = nextClamped;
      setT(nextClamped);
      return;
    }
    const p = source.playerRef.current;
    if (!p) return;
    p.seekTo?.(nextClamped, true);
    setT(nextClamped);
  }, [d, source]);

  const togglePlay = useCallback(() => {
    if (source.kind === 'html') {
      const v = source.videoRef.current;
      if (!v) return;
      if (v.paused) v.play().catch(() => {});
      else v.pause();
      return;
    }
    const p = source.playerRef.current;
    if (!p) return;
    if (isPlaying) p.pauseVideo?.();
    else p.playVideo?.();
  }, [isPlaying, source]);

  const stepFrame = useCallback((dir: 1 | -1, mult = 1) => {
    // Pause then step for deterministic frame-by-frame scrubbing
    if (source.kind === 'html') {
      const v = source.videoRef.current;
      if (v) v.pause();
    } else {
      source.playerRef.current?.pauseVideo?.();
    }
    seekTo(t + dir * frameStepRef.current * mult);
  }, [seekTo, source, t]);

  // Keyboard: frame-accurate stepping + play/pause
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); stepFrame(1, e.shiftKey ? 10 : 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); stepFrame(-1, e.shiftKey ? 10 : 1); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [stepFrame, togglePlay]);

  const pct = d > 0 ? (t / d) * 100 : 0;

  const shellStyle: React.CSSProperties = useMemo(() => ({
    pointerEvents: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px',
    borderRadius: 14,
    background: 'rgba(15, 15, 18, 0.55)',
    border: '1px solid rgba(255,255,255,0.12)',
    color: '#fff',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
  }), []);

  const btnStyle: React.CSSProperties = useMemo(() => ({
    width: 34,
    height: 34,
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.18)',
    background: 'rgba(255,255,255,0.08)',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 800,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    userSelect: 'none',
  }), []);

  return (
    <div style={shellStyle} aria-label="Timeline">
      <button onClick={togglePlay} style={{ ...btnStyle, width: 48, background: isPlaying ? accent : 'rgba(255,255,255,0.08)' }} title="Play/Pause (Space)">
        {isPlaying ? '⏸' : '▶'}
      </button>
      <button onClick={() => stepFrame(-1)} style={btnStyle} title={`Back 1 frame (←) @ ${selectedFps}fps`}>◀</button>
      <button onClick={() => stepFrame(1)} style={btnStyle} title={`Forward 1 frame (→) @ ${selectedFps}fps`}>▶</button>

      <div style={{ minWidth: 140, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, opacity: 0.95 }}>
        <div style={{ lineHeight: 1.1 }}>{formatTime(t)}</div>
        <div style={{ lineHeight: 1.1, opacity: 0.75 }}>{formatTime(d)}</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, opacity: 0.75, fontWeight: 700 }}>FPS</span>
        <select
          value={fpsMode}
          onChange={(e) => setFpsMode(e.target.value as any)}
          style={{
            height: 34,
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.18)',
            background: 'rgba(255,255,255,0.08)',
            color: '#fff',
            padding: '0 8px',
            fontSize: 12,
            cursor: 'pointer',
          }}
          title={fpsMode === 'auto' ? `Auto ≈ ${autoFps ?? '…'}fps` : `Step size: ${(1000 / selectedFps).toFixed(2)}ms`}
        >
          {source.kind === 'html' && <option value="auto">Auto{autoFps ? ` (${autoFps})` : ''}</option>}
          <option value="30">30</option>
          <option value="60">60</option>
          <option value="120">120</option>
          <option value="custom">Custom…</option>
        </select>
        {fpsMode === 'custom' && (
          <input
            type="number"
            min={1}
            max={240}
            step={1}
            value={customFps}
            onChange={(e) => setCustomFps(Number(e.target.value) || 30)}
            style={{
              width: 64,
              height: 34,
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(255,255,255,0.08)',
              color: '#fff',
              padding: '0 8px',
              outline: 'none',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
            title="Custom FPS for frame stepping"
          />
        )}
      </div>

      <div style={{ flex: 1, minWidth: 120 }}>
        <input
          type="range"
          min={0}
          max={d || 0}
          step={frameStep}
          value={clamp(t, 0, d || t)}
          onChange={(e) => seekTo(Number(e.target.value))}
          style={{
            width: '100%',
            accentColor: accent,
            height: 6,
          }}
          aria-label="Scrub timeline"
        />
        <div style={{ height: 4, borderRadius: 3, background: 'rgba(255,255,255,0.18)', marginTop: 6, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: accent }} />
        </div>
      </div>
    </div>
  );
}

