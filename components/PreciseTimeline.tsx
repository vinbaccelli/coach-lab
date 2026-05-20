'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nearestYoutubePlaybackRate } from '@/lib/videoController';

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

function formatTimeShort(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function getMarkerInterval(duration: number): number {
  if (duration <= 15) return 1;
  if (duration <= 60) return 2;
  if (duration <= 180) return 5;
  if (duration <= 600) return 10;
  return 30;
}

type Source =
  | { kind: 'html'; videoRef: React.RefObject<HTMLVideoElement | null> }
  | { kind: 'youtube'; playerRef: React.MutableRefObject<any | null> };

const SPEED_OPTIONS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export default function PreciseTimeline({
  source,
  defaultFps = 30,
  accent = '#35679A',
  leadingInsetPx = 0,
  compact = false,
  /** Desktop 9:16 phone: taller scrub; Speed/FPS tucked into Options */
  phoneChrome = false,
  /** Render as a transparent overlay (no background/border/radius) */
  overlay = false,
}: {
  source: Source;
  defaultFps?: number;
  accent?: string;
  /** Extra left padding so controls stay clear of a floating toolbar */
  leadingInsetPx?: number;
  compact?: boolean;
  phoneChrome?: boolean;
  overlay?: boolean;
}) {
  const STORAGE_MODE_KEY = 'coachlab.timeline.fpsMode';
  const STORAGE_CUSTOM_KEY = 'coachlab.timeline.customFps';
  const STORAGE_SCRUB_KEY = 'coachlab.timeline.scrubSensitivity';

  const [fpsMode, setFpsMode] = useState<'auto' | '30' | '60' | '120' | 'custom'>('30');
  const [customFps, setCustomFps] = useState(defaultFps);
  const [autoFps, setAutoFps] = useState<number | null>(null);
  /** 0.35 = very precise scrub, 1 = linear, 2.5 = large jumps per small drag */
  const [scrubSensitivity, setScrubSensitivity] = useState(1);
  const scrubSensRef = useRef(1);
  useEffect(() => {
    scrubSensRef.current = scrubSensitivity;
  }, [scrubSensitivity]);

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

      const rawSens = window.localStorage.getItem(STORAGE_SCRUB_KEY);
      const s = rawSens ? Number(rawSens) : NaN;
      if (Number.isFinite(s) && s >= 0.25 && s <= 3) setScrubSensitivity(s);
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
    try {
      window.localStorage.setItem(STORAGE_SCRUB_KEY, String(scrubSensitivity));
    } catch {
      // ignore
    }
  }, [scrubSensitivity]);

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
    if (scrubbingRef.current) return;
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
    try {
      p.seekTo?.(nextClamped, true);
    } catch {
      /* YT iframe can throw internal errors (e.g. this.g.src) while tearing down */
    }
    setT(nextClamped);
    tRef.current = nextClamped;
  }, [source]);

  const seekFromClientX = useCallback((clientX: number) => {
    const el = scrubTrackRef.current;
    const dur = dRef.current;
    if (!el || !dur) return;
    const r = el.getBoundingClientRect();
    const raw = clamp((clientX - r.left) / Math.max(1, r.width), 0, 1);
    const sens = scrubSensRef.current;
    const adj = clamp(0.5 + (raw - 0.5) * sens, 0, 1);
    seekTo(adj * dur);
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
    const p = source.playerRef.current;
    const ytR = nearestYoutubePlaybackRate(r);
    try {
      p?.setPlaybackRate?.(ytR);
    } catch {
      // ignore
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
    try {
      if (isPlaying) p.pauseVideo?.();
      else p.playVideo?.();
    } catch {
      /* YT player may be mid-destroy during embed → file swap */
    }
  }, [isPlaying, source]);

  const stepFrame = useCallback((dir: 1 | -1, mult = 1) => {
    // Pause then step for deterministic frame-by-frame scrubbing
    if (source.kind === 'html') {
      const v = source.videoRef.current;
      if (v) v.pause();
    } else {
      try {
        source.playerRef.current?.pauseVideo?.();
      } catch {
        /* ignore */
      }
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
    gap: phoneChrome ? 8 : compact ? 6 : 10,
    width: '100%',
    padding: overlay
      ? '0'
      : `${phoneChrome ? 8 : compact ? 6 : 10}px 12px calc(env(safe-area-inset-bottom, 0px) + ${phoneChrome ? 20 : compact ? 16 : 18}px) calc(env(safe-area-inset-bottom, 0px) + ${phoneChrome ? 8 : compact ? 6 : 10}px)`,
    paddingLeft: overlay ? 0 : Math.max(12, leadingInsetPx),
    borderRadius: overlay ? 0 : phoneChrome ? 0 : '14px 14px 0 0',
    background: overlay ? 'transparent' : phoneChrome ? 'rgba(255,255,255,0.06)' : 'rgba(15, 15, 18, 0.58)',
    border: overlay ? 'none' : phoneChrome ? 'none' : '1px solid rgba(255,255,255,0.12)',
    borderBottom: 'none',
    color: '#fff',
    backdropFilter: overlay ? 'none' : phoneChrome ? 'blur(20px) saturate(1.15)' : 'blur(12px)',
    WebkitBackdropFilter: overlay ? 'none' : phoneChrome ? 'blur(20px) saturate(1.15)' : 'blur(12px)',
    touchAction: 'manipulation',
  }), [compact, leadingInsetPx, overlay, phoneChrome]);

  const btnStyle: React.CSSProperties = useMemo(() => ({
    minWidth: phoneChrome || overlay ? 44 : 40,
    height: phoneChrome || overlay ? 44 : 40,
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.18)',
    background: 'rgba(255,255,255,0.08)',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    userSelect: 'none',
    flexShrink: 0,
  }), [phoneChrome, overlay]);

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
    <div data-tour-id="tour-timeline" style={shellStyle} aria-label="Timeline">
      <div
        data-tour-id="tour-frame-controls"
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

        {phoneChrome ? (
          <details style={{ flexShrink: 0 }}>
            <summary
              style={{
                ...btnStyle,
                minWidth: 72,
                height: phoneChrome ? 40 : 40,
                listStyle: 'none',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Options ▾
            </summary>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, opacity: 0.75, fontWeight: 600 }}>Speed</span>
                <select
                  value={playbackRate}
                  onChange={(e) => setRate(Number(e.target.value))}
                  style={{ ...selectStyle, height: 36 }}
                  title="Playback speed"
                  aria-label="Playback speed"
                >
                  {SPEED_OPTIONS.map((r) => (
                    <option key={r} value={r}>{r}×</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, opacity: 0.75, fontWeight: 600 }}>FPS</span>
                <select
                  value={fpsMode}
                  onChange={(e) => setFpsMode(e.target.value as 'auto' | '30' | '60' | '120' | 'custom')}
                  style={{ ...selectStyle, minWidth: 100, height: 36 }}
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
                      height: 36,
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
          </details>
        ) : (
          <>
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
          </>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          flexShrink: 0,
          padding: phoneChrome ? '4px 0 2px' : '2px 0 0',
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: phoneChrome ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.65)', whiteSpace: 'nowrap' }}>
          Scrub
        </span>
        <input
          type="range"
          min={35}
          max={250}
          step={5}
          value={Math.round(scrubSensitivity * 100)}
          onChange={(e) => setScrubSensitivity(Number(e.target.value) / 100)}
          aria-label="Timeline scrub sensitivity"
          title="Low = precise small adjustments. High = faster scrub across the video."
          style={{
            flex: 1,
            minWidth: 0,
            height: phoneChrome ? 36 : 32,
            accentColor: accent,
            touchAction: 'none',
          }}
        />
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: phoneChrome ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.5)',
            width: 52,
            textAlign: 'right',
          }}
        >
          {scrubSensitivity < 0.85 ? 'Precise' : scrubSensitivity > 1.35 ? 'Fast' : 'Normal'}
        </span>
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
          height: phoneChrome ? 52 : 44,
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
            height: phoneChrome ? 10 : 8,
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
            height: phoneChrome ? 10 : 8,
            width: `${pct}%`,
            borderRadius: 4,
            background: accent,
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: `calc(${pct}% - ${phoneChrome ? 15 : 10}px)`,
            top: '50%',
            transform: 'translateY(-50%)',
            width: phoneChrome ? 30 : 20,
            height: phoneChrome ? 30 : 20,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: `0 0 0 2px ${accent}`,
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Vertical tick markers */}
      {d > 0 && (
        <TimelineMarkers
          duration={d}
          overlay={overlay}
          onSeek={seekTo}
        />
      )}
    </div>
  );
}

function TimelineMarkers({
  duration,
  overlay,
  onSeek,
}: {
  duration: number;
  overlay: boolean;
  onSeek: (t: number) => void;
}) {
  const interval = getMarkerInterval(duration);
  const majorEvery = 5;
  const count = Math.floor(duration / interval);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const markers = useMemo(() => {
    const m: { time: number; isMajor: boolean }[] = [];
    for (let i = 1; i <= count; i++) {
      m.push({ time: i * interval, isMajor: i % majorEvery === 0 });
    }
    return m;
  }, [count, interval]);

  const lineColor = overlay ? 'rgba(255,255,255,0.3)' : '#CCCCCC';
  const majorColor = overlay ? 'rgba(255,255,255,0.5)' : '#AAAAAA';

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: 16,
        flexShrink: 0,
      }}
    >
      {markers.map((mk, i) => {
        const leftPct = (mk.time / duration) * 100;
        const h = mk.isMajor ? 12 : 8;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${leftPct}%`,
              top: 0,
              width: 1,
              height: h,
              background: mk.isMajor ? majorColor : lineColor,
              cursor: 'pointer',
              padding: '0 3px',
              marginLeft: -0.5,
              backgroundClip: 'content-box',
            }}
            onClick={() => onSeek(mk.time)}
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
          >
            {hoveredIdx === i && (
              <div
                style={{
                  position: 'absolute',
                  bottom: h + 4,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: overlay ? 'rgba(0,0,0,0.75)' : '#1A1A1A',
                  color: '#fff',
                  fontSize: 10,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  padding: '2px 6px',
                  borderRadius: 4,
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                  zIndex: 10,
                }}
              >
                {formatTimeShort(mk.time)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

