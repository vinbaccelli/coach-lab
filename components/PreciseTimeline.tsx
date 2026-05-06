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

const SPEED_OPTIONS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;

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

  const frameStepRef = useRef(1 / selectedFps);
  useEffect(() => { frameStepRef.current = 1 / selectedFps; }, [selectedFps]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [d, setD] = useState(0);
  const dRef = useRef(0);
  useEffect(() => { dRef.current = d; }, [d]);
  const tRef = useRef(0);
  useEffect(() => { tRef.current = t; }, [t]);
  const playbackRateRef = useRef(1);
  const [playbackRate, setPlaybackRate] = useState(1);

  const scrubTrackRef = useRef<HTMLDivElement | null>(null);
  const scrubbingRef = useRef(false);

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
    const dur = dRef.current;
    const nextClamped = clamp(next, 0, dur || next);
    if (source.kind === 'html') {
      const v = source.videoRef.current;
      if (!v) return;
      v.currentTime = nextClamped;
      setT(nextClamped);
      tRef.current = nextClamped;
      return;
    }
    const p = source.playerRef.current;
    if (!p) return;
    p.seekTo?.(nextClamped, true);
    setT(nextClamped);
    tRef.current = nextClamped;
  }, [source]);

  const seekFromClientX = useCallback((clientX: number) => {
    const el = scrubTrackRef.current;
    const dur = dRef.current;
    if (!el || !dur) return;
    const r = el.getBoundingClientRect();
    const pct = clamp((clientX - r.left) / Math.max(1, r.width), 0, 1);
    seekTo(pct * dur);
  }, [seekTo]);

  useEffect(() => {
    const onWinMove = (e: PointerEvent) => {
      if (!scrubbingRef.current) return;
      seekFromClientX(e.clientX);
    };
    const onWinUp = () => { scrubbingRef.current = false; };
    window.addEventListener('pointermove', onWinMove);
    window.addEventListener('pointerup', onWinUp);
    window.addEventListener('pointercancel', onWinUp);
    return () => {
      window.removeEventListener('pointermove', onWinMove);
      window.removeEventListener('pointerup', onWinUp);
      window.removeEventListener('pointercancel', onWinUp);
    };
  }, [seekFromClientX]);

  const setRate = useCallback((r: number) => {
    playbackRateRef.current = r;
    setPlaybackRate(r);
    if (source.kind === 'html') {
      const v = source.videoRef.current;
      if (v) v.playbackRate = r;
      return;
    }
  }, [source]);

  useEffect(() => {
    if (source.kind !== 'html') return;
    const v = source.videoRef.current;
    if (!v) return;
    const onRate = () => {
      const r = v.playbackRate;
      if (SPEED_OPTIONS.some((x) => Math.abs(x - r) < 0.001)) setPlaybackRate(r);
    };
    v.addEventListener('ratechange', onRate);
    onRate();
    return () => v.removeEventListener('ratechange', onRate);
  }, [source]);

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
    // Use a ref so rapid clicks remain responsive without waiting for re-render.
    const next = tRef.current + dir * frameStepRef.current * mult;
    tRef.current = next;
    setT(next);
    seekTo(next);
  }, [seekTo, source]);

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
    flexDirection: 'column',
    gap: 10,
    width: '100%',
    padding: `10px 12px calc(env(safe-area-inset-bottom, 0px) + 10px)`,
    borderRadius: '14px 14px 0 0',
    background: 'rgba(15, 15, 18, 0.58)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderBottom: 'none',
    color: '#fff',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    touchAction: 'manipulation',
  }), []);

  const btnStyle: React.CSSProperties = useMemo(() => ({
    minWidth: 40,
    height: 40,
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
    flexShrink: 0,
  }), []);

  const selectStyle: React.CSSProperties = useMemo(() => ({
    height: 40,
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.18)',
    background: 'rgba(255,255,255,0.08)',
    color: '#fff',
    padding: '0 10px',
    fontSize: 13,
    cursor: 'pointer',
    minWidth: 72,
  }), []);

  return (
    <div style={shellStyle} aria-label="Timeline">
      <div
        style={{
          display: 'flex',
          flexWrap: 'nowrap',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 2,
        }}
      >
        <button onClick={togglePlay} style={{ ...btnStyle, minWidth: 52, background: isPlaying ? accent : 'rgba(255,255,255,0.08)' }} title="Play/Pause (Space)">
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button onClick={() => stepFrame(-1)} style={btnStyle} title={`Back 1 frame (←) @ ${selectedFps}fps`}>◀</button>
        <button onClick={() => stepFrame(1)} style={btnStyle} title={`Forward 1 frame (→) @ ${selectedFps}fps`}>▶</button>

        <div style={{ minWidth: 130, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, opacity: 0.95 }}>
          <div style={{ lineHeight: 1.1 }}>{formatTime(t)}</div>
          <div style={{ lineHeight: 1.1, opacity: 0.75 }}>{formatTime(d)}</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, opacity: 0.75, fontWeight: 700 }}>Speed</span>
          <select
            value={playbackRate}
            onChange={(e) => setRate(Number(e.target.value))}
            style={selectStyle}
            title="Playback speed"
            aria-label="Playback speed"
          >
            {SPEED_OPTIONS.map((r) => (
              <option key={r} value={r}>{r}×</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, opacity: 0.75, fontWeight: 700 }}>FPS</span>
          <select
            value={fpsMode}
            onChange={(e) => setFpsMode(e.target.value as 'auto' | '30' | '60' | '120' | 'custom')}
            style={{ ...selectStyle, minWidth: 100 }}
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
                height: 40,
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
      </div>

      {/* Full-width touch scrub bar */}
      <div
        ref={scrubTrackRef}
        role="slider"
        tabIndex={0}
        aria-valuemin={0}
        aria-valuemax={d || 0}
        aria-valuenow={t}
        aria-label="Scrub timeline"
        style={{
          width: '100%',
          height: 44,
          borderRadius: 10,
          background: 'rgba(255,255,255,0.1)',
          position: 'relative',
          cursor: 'pointer',
          touchAction: 'none',
          flexShrink: 0,
        }}
        onPointerDown={(e) => {
          scrubbingRef.current = true;
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          seekFromClientX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (!scrubbingRef.current) return;
          if (!(e.currentTarget as HTMLDivElement).hasPointerCapture(e.pointerId)) return;
          seekFromClientX(e.clientX);
        }}
        onPointerUp={(e) => {
          scrubbingRef.current = false;
          try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            height: 8,
            width: '100%',
            borderRadius: 4,
            background: 'rgba(255,255,255,0.2)',
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            height: 8,
            width: `${pct}%`,
            borderRadius: 4,
            background: accent,
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: `calc(${pct}% - 10px)`,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: `0 0 0 2px ${accent}`,
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  );
}

