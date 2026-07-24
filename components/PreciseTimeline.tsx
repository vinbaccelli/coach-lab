'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nearestYoutubePlaybackRate } from '@/lib/videoController';
import { tempDebugPointer } from '@/lib/tempDebugPointer'; // TEMP-DEBUG-POINTER — remove after phone touch investigation

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);
  const time = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  return hrs > 0 ? `${hrs}:${time}` : time;
}

function formatTimeShort(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const time = `${mins}:${secs.toString().padStart(2, '0')}`;
  return hrs > 0 ? `${hrs}:${time}` : time;
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

const VIDEO_REF_RETRY_MS = 50;
const VIDEO_REF_RETRY_MAX = 200;

/** Wait for a video ref to attach, then bind listeners; retries instead of giving up on mount. */
function bindWhenVideoReady(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  bind: (v: HTMLVideoElement) => () => void,
): () => void {
  let cancelled = false;
  let unbind: (() => void) | undefined;
  let retryCount = 0;
  let retryTimer: number | undefined;

  const attempt = () => {
    if (cancelled) return;
    const v = videoRef.current;
    if (v) {
      unbind = bind(v);
      return;
    }
    if (retryCount >= VIDEO_REF_RETRY_MAX) return;
    retryCount += 1;
    retryTimer = window.setTimeout(attempt, VIDEO_REF_RETRY_MS);
  };

  attempt();
  return () => {
    cancelled = true;
    if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    unbind?.();
  };
}

/** Fast seek acknowledgment for frame stepping — seeked only, short fallback. */
function waitForSeekPresented(v: HTMLVideoElement): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      v.removeEventListener('seeked', onSeeked);
      clearTimeout(timer);
      resolve(v.currentTime);
    };
    const onSeeked = () => finish();
    v.addEventListener('seeked', onSeeked, { once: true });
    const timer = window.setTimeout(finish, 48);
  });
}

/** Wait until the decoder presents a frame at or after a seek (scrub/marker commits). */
function waitForFrameReady(v: HTMLVideoElement, targetTime?: number): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    let rvfcId = 0;
    const finish = (t: number) => {
      if (settled) return;
      settled = true;
      v.removeEventListener('seeked', onSeeked);
      if (rvfcId) {
        try { (v as HTMLVideoElement & { cancelVideoFrameCallback?: (id: number) => void }).cancelVideoFrameCallback?.(rvfcId); } catch { /* noop */ }
      }
      clearTimeout(timer);
      resolve(t);
    };
    const onSeeked = () => finish(v.currentTime);
    v.addEventListener('seeked', onSeeked, { once: true });
    const anyV = v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number };
    if (typeof anyV.requestVideoFrameCallback === 'function') {
      const onFrame = (_now: number, meta: { mediaTime: number }) => {
        if (targetTime !== undefined && Math.abs(meta.mediaTime - targetTime) > 0.05) {
          rvfcId = anyV.requestVideoFrameCallback!(onFrame);
          return;
        }
        finish(meta.mediaTime);
      };
      rvfcId = anyV.requestVideoFrameCallback(onFrame);
    }
    const timer = window.setTimeout(() => finish(v.currentTime), 120);
  });
}

export default function PreciseTimeline({
  source,
  defaultFps = 30,
  accent = '#007AFF',
  leadingInsetPx = 0,
  compact = false,
  /** Desktop 9:16 phone: taller scrub; Speed/FPS tucked into Options */
  phoneChrome = false,
  /** Render as a transparent overlay (no background/border/radius) */
  overlay = false,
  compareSlot,
  onCompareSlotChange,
  compareAbDisabled = false,
  /** Called synchronously before play/pause on the primary source (AB sync hook). */
  beforePlay,
  beforePause,
  /** Called when HTML5 video.play() is rejected (Safari autoplay policy). */
  onPlayBlocked,
  trimRange = null,
  onTrimChange,
  trimAccent = '#FF9500',
  onCurrentTime,
  phaseMarkers = null,
  selectedPhaseMarkerId = null,
  onPhaseMarkerSelect,
  onPhaseMarkerChange,
  phaseMarkerBounds = null,
  sampleMarkers = null,
  onSampleMarkerSelect,
  onSampleMarkerChange,
  sampleMarkerBounds = null,
  defaultZoomToTrim = false,
}: {
  source: Source;
  defaultFps?: number;
  accent?: string;
  /** Extra left padding so controls stay clear of a floating toolbar */
  leadingInsetPx?: number;
  compact?: boolean;
  phoneChrome?: boolean;
  overlay?: boolean;
  compareSlot?: 'A' | 'B' | 'AB';
  onCompareSlotChange?: (v: 'A' | 'B' | 'AB') => void;
  compareAbDisabled?: boolean;
  beforePlay?: () => void;
  beforePause?: () => void;
  onPlayBlocked?: () => void;
  trimRange?: { start: number; end: number } | null;
  /** When provided, the trim start/end lines become draggable handles. */
  onTrimChange?: (start: number, end: number) => void;
  trimAccent?: string;
  onCurrentTime?: (t: number) => void;
  phaseMarkers?: Array<{ id: string; label: string; short?: string; time: number }> | null;
  selectedPhaseMarkerId?: string | null;
  onPhaseMarkerSelect?: (id: string) => void;
  onPhaseMarkerChange?: (id: string, time: number) => void;
  phaseMarkerBounds?: { start: number; end: number } | null;
  /** Stromotion frame-stop balls — one per multiplied object position */
  sampleMarkers?: Array<{ id: string; time: number; label?: string }> | null;
  onSampleMarkerSelect?: (id: string, time: number) => void;
  onSampleMarkerChange?: (id: string, time: number) => void;
  sampleMarkerBounds?: { start: number; end: number } | null;
  /** When true, zoom the scrub bar to the trim range (with padding) on load */
  defaultZoomToTrim?: boolean;
}) {
  const STORAGE_MODE_KEY = 'anglemotion.timeline.fpsMode';
  const STORAGE_CUSTOM_KEY = 'anglemotion.timeline.customFps';

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

    return bindWhenVideoReady(source.videoRef, (v) => {
      const anyV = v as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
        cancelVideoFrameCallback?: (id: number) => void;
      };
      if (typeof anyV.requestVideoFrameCallback !== 'function') {
        setAutoFps(null);
        return () => {};
      }

      let cancelled = false;
      const stamps: number[] = [];
      let id = 0;

      const stopLoop = () => {
        if (id) {
          try { anyV.cancelVideoFrameCallback?.(id); } catch { /* noop */ }
          id = 0;
        }
      };

      const onFrame = (_now: number, meta: { mediaTime: number }) => {
        if (cancelled) return;
        if (v.paused) {
          stopLoop();
          return;
        }
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

        id = anyV.requestVideoFrameCallback!(onFrame);
      };

      const startLoop = () => {
        if (cancelled || v.paused) return;
        stopLoop();
        id = anyV.requestVideoFrameCallback!(onFrame);
      };

      const onPlay = () => startLoop();
      const onPause = () => stopLoop();

      v.addEventListener('play', onPlay);
      v.addEventListener('pause', onPause);
      if (!v.paused) startLoop();

      return () => {
        cancelled = true;
        v.removeEventListener('play', onPlay);
        v.removeEventListener('pause', onPause);
        stopLoop();
      };
    });
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
  /** pointerId that started the active scrub — used by the capture-loss fallback. */
  const scrubPointerIdRef = useRef<number | null>(null);
  const phaseDragIdRef = useRef<string | null>(null);
  const trimDragRef = useRef<'start' | 'end' | null>(null);
  const sampleDragIdRef = useRef<string | null>(null);
  const [viewWindow, setViewWindow] = useState<{ start: number; end: number } | null>(null);
  /** Live scrub thumb position while dragging (before frame-ready commit). */
  const [scrubPreviewT, setScrubPreviewT] = useState<number | null>(null);
  const pendingScrubTimeRef = useRef<number | null>(null);
  const scrubRafRef = useRef(0);
  const lastScrubCommitRef = useRef<number | null>(null);
  const lastTimeUiTsRef = useRef(0);
  const stepInFlightRef = useRef(false);
  /** Net frame delta requested while a step seek is in flight (coalesced, not dropped). */
  const pendingStepFramesRef = useRef(0);

  const applyTimeUi = useCallback((next: number) => {
    tRef.current = next;
    setT(next);
    onCurrentTime?.(next);
  }, [onCurrentTime]);

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
    if (source.kind !== 'html') {
      const id = window.setInterval(readState, 100);
      readState();
      return () => window.clearInterval(id);
    }

    return bindWhenVideoReady(source.videoRef, (v) => {
      const onTime = () => {
        if (scrubbingRef.current) return;
        const now = performance.now();
        if (!v.paused && now - lastTimeUiTsRef.current < 100) return;
        lastTimeUiTsRef.current = now;
        applyTimeUi(v.currentTime || 0);
      };
      const onMeta = () => setD(Number.isFinite(v.duration) ? v.duration : 0);
      const onPlay = () => setIsPlaying(true);
      const onPause = () => {
        setIsPlaying(false);
        if (!scrubbingRef.current) applyTimeUi(v.currentTime || 0);
      };

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
    });
  }, [applyTimeUi, readState, source]);

  const commitHtmlStep = useCallback(async (next: number) => {
    const dur = dRef.current;
    const nextClamped = clamp(next, 0, dur || next);
    const v = source.kind === 'html' ? source.videoRef.current : null;
    if (!v) return nextClamped;
    v.pause();
    applyTimeUi(nextClamped);
    if (Math.abs(v.currentTime - nextClamped) > 0.00001 || v.seeking) {
      v.currentTime = nextClamped;
      const actual = await waitForSeekPresented(v);
      if (Math.abs(actual - nextClamped) > 0.001) applyTimeUi(actual);
    }
    return nextClamped;
  }, [applyTimeUi, source]);

  const commitHtmlSeek = useCallback(async (next: number, updateUi: boolean) => {
    const dur = dRef.current;
    const nextClamped = clamp(next, 0, dur || next);
    const v = source.kind === 'html' ? source.videoRef.current : null;
    if (!v) return nextClamped;
    v.currentTime = nextClamped;
    if (!updateUi) return nextClamped;
    const actual = await waitForFrameReady(v, nextClamped);
    applyTimeUi(actual);
    return actual;
  }, [applyTimeUi, source]);

  const flushScrubSeek = useCallback(() => {
    scrubRafRef.current = 0;
    const pending = pendingScrubTimeRef.current;
    if (pending === null) return;
    // Coalesced preview update — the thumb tracks the finger once per rAF, and
    // still advances even when the seek itself is deduped below.
    setScrubPreviewT(pending);
    if (source.kind === 'html') {
      const v = source.videoRef.current;
      if (!v) return;
      if (lastScrubCommitRef.current !== null && Math.abs(pending - lastScrubCommitRef.current) < 0.00001) return;
      lastScrubCommitRef.current = pending;
      v.currentTime = pending;
      applyTimeUi(pending);
      return;
    }
    const p = source.playerRef.current;
    if (!p) return;
    try {
      p.seekTo?.(pending, true);
    } catch {
      /* YT iframe can throw while tearing down */
    }
    lastScrubCommitRef.current = pending;
    applyTimeUi(pending);
  }, [applyTimeUi, source]);

  const scheduleScrubSeek = useCallback(() => {
    if (scrubRafRef.current) return;
    scrubRafRef.current = requestAnimationFrame(() => {
      flushScrubSeek();
    });
  }, [flushScrubSeek]);

  const finalizeScrub = useCallback(async () => {
    if (scrubRafRef.current) {
      cancelAnimationFrame(scrubRafRef.current);
      scrubRafRef.current = 0;
    }
    const pending = pendingScrubTimeRef.current;
    pendingScrubTimeRef.current = null;
    lastScrubCommitRef.current = null;
    if (pending === null) {
      setScrubPreviewT(null);
      return;
    }
    if (source.kind === 'html') {
      const v = source.videoRef.current;
      if (v) {
        v.pause();
        applyTimeUi(pending);
        v.currentTime = pending;
        const actual = await waitForSeekPresented(v);
        if (Math.abs(actual - pending) > 0.001) applyTimeUi(actual);
      }
    } else {
      const p = source.playerRef.current;
      if (p) {
        try { p.pauseVideo?.(); } catch { /* noop */ }
        try { p.seekTo?.(pending, true); } catch { /* noop */ }
      }
      applyTimeUi(pending);
    }
    setScrubPreviewT(null);
  }, [applyTimeUi, source]);

  const seekTo = useCallback(async (next: number) => {
    const dur = dRef.current;
    const nextClamped = clamp(next, 0, dur || next);
    if (source.kind === 'html') {
      const v = source.videoRef.current;
      if (!v) return;
      v.pause();
      await commitHtmlSeek(nextClamped, true);
      return;
    }
    const p = source.playerRef.current;
    if (!p) return;
    try {
      p.seekTo?.(nextClamped, true);
    } catch {
      /* YT iframe can throw internal errors (e.g. this.g.src) while tearing down */
    }
    applyTimeUi(nextClamped);
  }, [applyTimeUi, commitHtmlSeek, source]);

  const timeFromClientX = useCallback((clientX: number) => {
    const el = scrubTrackRef.current;
    const dur = dRef.current;
    if (!el || !dur) return null;
    const r = el.getBoundingClientRect();
    const raw = clamp((clientX - r.left) / Math.max(1, r.width), 0, 1);
    const vStart = viewWindow?.start ?? 0;
    const vEnd = viewWindow?.end ?? dur;
    const span = Math.max(vEnd - vStart, 0.001);
    return clamp(vStart + raw * span, 0, dur);
  }, [viewWindow]);

  // Zoom to the trim range ONCE on entry — NOT on every trimRange change.
  // Re-zooming on each change rescaled the whole timeline while a handle was
  // being dragged, so the opposite handle and the sample balls appeared to jump
  // ("move one side, the other moves too"). The user wants stable, precise
  // handles; they can re-fit manually via zoomToTrim.
  const didZoomToTrimRef = useRef(false);
  useEffect(() => {
    if (!defaultZoomToTrim || !trimRange || d <= 0) {
      if (!defaultZoomToTrim) { setViewWindow(null); didZoomToTrimRef.current = false; }
      return;
    }
    if (didZoomToTrimRef.current) return;
    didZoomToTrimRef.current = true;
    const span = trimRange.end - trimRange.start;
    const pad = Math.max(0.08, span * 0.12);
    setViewWindow({
      start: Math.max(0, trimRange.start - pad),
      end: Math.min(d, trimRange.end + pad),
    });
  }, [defaultZoomToTrim, trimRange, d]);

  const zoomToTrim = useCallback(() => {
    if (!trimRange || d <= 0) return;
    const span = trimRange.end - trimRange.start;
    const pad = Math.max(0.08, span * 0.12);
    setViewWindow({
      start: Math.max(0, trimRange.start - pad),
      end: Math.min(d, trimRange.end + pad),
    });
  }, [trimRange, d]);

  const zoomFull = useCallback(() => setViewWindow(null), []);

  const zoomBy = useCallback((factor: number) => {
    if (d <= 0) return;
    const vStart = viewWindow?.start ?? 0;
    const vEnd = viewWindow?.end ?? d;
    const span = Math.max(vEnd - vStart, 0.08);
    const newSpan = clamp(span * factor, 0.08, d);
    // Anchor zoom on the current playhead so the viewed position stays centred
    const anchor = clamp(t, 0, d);
    const start = clamp(anchor - newSpan / 2, 0, Math.max(0, d - newSpan));
    setViewWindow({ start, end: start + newSpan });
  }, [d, viewWindow, t]);

  const queueScrubAtClientX = useCallback((clientX: number) => {
    const next = timeFromClientX(clientX);
    if (next === null) return;
    pendingScrubTimeRef.current = next;
    // Preview thumb is updated inside flushScrubSeek (the rAF-coalesced path),
    // NOT here — so a fast drag re-renders once per animation frame, not once
    // per raw pointer event.
    scheduleScrubSeek();
  }, [scheduleScrubSeek, timeFromClientX]);

  useEffect(() => {
    // Pointer MOVE during a scrub is normally handled by the scrub track's own
    // onPointerMove (pointer-capture-scoped to the dragging pointerId). This
    // window listener is a FALLBACK that queues the SAME seek only when the
    // element has LOST pointer capture mid-drag (common under mobile gesture
    // arbitration). It is guarded by the active pointerId + a hasPointerCapture
    // check, so it never double-fires while capture holds (that was the churn we
    // removed) and never responds to a second, multi-touch pointer.
    const onWinMove = (e: PointerEvent) => {
      if (!scrubbingRef.current) return;
      if (e.pointerId !== scrubPointerIdRef.current) return;
      const el = scrubTrackRef.current;
      if (el && el.hasPointerCapture(e.pointerId)) return;
      queueScrubAtClientX(e.clientX);
    };
    const onWinUp = (e: PointerEvent) => {
      if (!scrubbingRef.current) return;
      // Only the active scrub pointer's up/cancel ends the drag (a stray second
      // finger lifting must not terminate it).
      if (e.pointerId !== scrubPointerIdRef.current) return;
      scrubbingRef.current = false;
      scrubPointerIdRef.current = null;
      void finalizeScrub();
    };
    window.addEventListener('pointermove', onWinMove);
    window.addEventListener('pointerup', onWinUp);
    window.addEventListener('pointercancel', onWinUp);
    return () => {
      window.removeEventListener('pointermove', onWinMove);
      window.removeEventListener('pointerup', onWinUp);
      window.removeEventListener('pointercancel', onWinUp);
    };
  }, [finalizeScrub, queueScrubAtClientX]);

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
      if (v.paused) {
        beforePlay?.();
        void (async () => {
          try {
            await v.play();
            setIsPlaying(true);
          } catch {
            try {
              v.muted = true;
              await v.play();
              setIsPlaying(true);
            } catch {
              setIsPlaying(false);
              onPlayBlocked?.();
            }
          }
        })();
      } else {
        beforePause?.();
        setIsPlaying(false);
        applyTimeUi(v.currentTime || 0);
        v.pause();
      }
      return;
    }
    const p = source.playerRef.current;
    if (!p) return;
    try {
      if (isPlaying) {
        beforePause?.();
        p.pauseVideo?.();
      } else {
        beforePlay?.();
        p.playVideo?.();
      }
    } catch {
      /* YT player may be mid-destroy during embed → file swap */
    }
  }, [beforePause, beforePlay, isPlaying, onPlayBlocked, source]);

  const stepFrame = useCallback((dir: 1 | -1, mult = 1) => {
    const frames = dir * mult;
    if (stepInFlightRef.current) {
      // A step arrived while one is still resolving — accumulate the NET frame
      // delta instead of dropping it, so a rapid burst of presses is honored
      // (coalesced into the next seek), never silently lost.
      pendingStepFramesRef.current += frames;
      return;
    }
    stepInFlightRef.current = true;
    void (async () => {
      try {
        let framesToApply = frames;
        // Drain accumulated presses: each iteration coalesces ALL pending frames
        // into a SINGLE seek (current-frame + net delta), so holding the control
        // advances by the net delta without a runaway one-seek-per-press queue.
        // A lone tap runs exactly one iteration — as immediate as before.
        while (framesToApply !== 0) {
          const step = frameStepRef.current;
          const dur = dRef.current;
          const delta = framesToApply * step;
          if (source.kind === 'html') {
            const v = source.videoRef.current;
            if (!v) break;
            const cur = v.currentTime;
            const next = clamp(cur + delta, 0, dur || Math.max(cur + delta, 0));
            await commitHtmlStep(next);
          } else {
            try {
              source.playerRef.current?.pauseVideo?.();
            } catch {
              /* ignore */
            }
            const next = clamp(tRef.current + delta, 0, dur || tRef.current + delta);
            await seekTo(next);
          }
          // Pick up anything requested during the awaited seek and coalesce it
          // into the next iteration's single seek.
          framesToApply = pendingStepFramesRef.current;
          pendingStepFramesRef.current = 0;
        }
      } finally {
        stepInFlightRef.current = false;
      }
    })();
  }, [commitHtmlStep, seekTo, source]);

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

  const displayT = scrubPreviewT ?? t;
  const viewStart = viewWindow?.start ?? 0;
  const viewEnd = viewWindow?.end ?? d;
  const viewSpan = Math.max(viewEnd - viewStart, 0.001);
  const pct = d > 0 ? clamp(((displayT - viewStart) / viewSpan) * 100, 0, 100) : 0;
  const trimStartPct = trimRange && d > 0 ? clamp(((trimRange.start - viewStart) / viewSpan) * 100, 0, 100) : 0;
  const trimEndPct = trimRange && d > 0 ? clamp(((trimRange.end - viewStart) / viewSpan) * 100, 0, 100) : 0;
  const trimWidthPct = Math.max(0, trimEndPct - trimStartPct);
  const timeToPct = (time: number) => clamp(((time - viewStart) / viewSpan) * 100, 0, 100);

  const shellStyle: React.CSSProperties = useMemo(() => ({
    pointerEvents: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: phoneChrome ? 4 : compact ? 6 : 10,
    width: '100%',
    padding: overlay
      ? '0'
      : `${phoneChrome ? 4 : compact ? 6 : 10}px 12px calc(env(safe-area-inset-bottom, 0px) + ${phoneChrome ? 10 : compact ? 16 : 18}px) calc(env(safe-area-inset-bottom, 0px) + ${phoneChrome ? 4 : compact ? 6 : 10}px)`,
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

  const thumbSize = phoneChrome ? 26 : 24;
  const scrubTrackH = phoneChrome ? 56 : 48;

  // Trim-handle grab model: the ONLY draggable surface is an ABOVE-TRACK grab tab
  // (rendered per handle below). The in-track body is a thin, always-inert stripe
  // that just marks the exact trim boundary. Because the tabs live above the track
  // and the playback ball lives on it, their grab-zones sit at different heights
  // and can NEVER overlap — at any zoom or proximity.
  const HANDLE_STRIPE_W = 3;                  // visible in-track boundary marker width
  // Horizontal splay + edge behaviour: the start tab's RIGHT edge normally sits at
  // the trim-start x and the body extends LEFT; the end tab's LEFT edge sits at the
  // trim-end x and the body extends RIGHT — so as the two points converge the tabs
  // splay outward and never stack. When a trim point reaches a track edge (e.g. the
  // start point at the very BEGINNING) there is no room to extend outward, so the
  // tab instead pins flush to that edge and extends INWARD at full size, staying
  // fully on-screen and grabbable. It never overlaps the other tab (the start tab's
  // right edge is capped at the end x, and vice-versa) and never falls back to an
  // in-track grab. In the rare case of a tiny trim sliver parked against an edge the
  // pinned tab simply shrinks to fit — the deliberate Option-B tradeoff.
  const TRIM_TAB_W = phoneChrome ? 46 : 38;   // nominal tab width
  const TRIM_TAB_H = phoneChrome ? 34 : 22;   // tab height (taller on touch for a comfortable target)
  const TRIM_TAB_EDGE = 2;                    // keep the tab body a hair inside the track edge
  // Prebuilt CSS geometry so the start/end tab styles below stay readable. sX/eX are
  // the on-track x of each trim boundary; _tabA is the flush-to-edge threshold.
  const _sX = `(10px + (100% - 20px) * ${trimStartPct / 100})`;
  const _eX = `(10px + (100% - 20px) * ${trimEndPct / 100})`;
  const _tabA = TRIM_TAB_EDGE + TRIM_TAB_W;
  // Start tab right edge R = min(endX, max(startX, _tabA)); body extends left from R.
  const _startR = `min(${_eX}, max(${_sX}, ${_tabA}px))`;
  const trimStartTabRight = `calc(100% - ${_startR})`;
  const trimStartTabWidth = `min(${TRIM_TAB_W}px, calc(${_startR} - ${TRIM_TAB_EDGE}px))`;
  // End tab left edge L = max(startX, min(endX, 100% - _tabA)); body extends right from L.
  const trimEndTabLeft = `max(${_sX}, min(${_eX}, calc(100% - ${_tabA}px)))`;
  const trimEndTabWidth = `min(${TRIM_TAB_W}px, calc(100% - ${TRIM_TAB_EDGE}px - ${trimEndTabLeft}))`;

  return (
    <div data-tour-id="tour-timeline" style={shellStyle} aria-label="Timeline">
      {/* Full-width scrub bar — placed first so it stays visible above control chrome */}
      <div
        ref={scrubTrackRef}
        role="slider"
        tabIndex={0}
        aria-valuemin={0}
        aria-valuemax={d || 0}
        aria-valuenow={displayT}
        aria-label="Scrub timeline"
        aria-disabled={d <= 0}
        style={{
          width: '100%',
          height: scrubTrackH,
          minHeight: scrubTrackH,
          borderRadius: 12,
          background: d > 0 ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.08)',
          border: '1px solid rgba(255,255,255,0.22)',
          position: 'relative',
          cursor: d > 0 ? 'pointer' : 'default',
          touchAction: 'none',
          flexShrink: 0,
          boxSizing: 'border-box',
        }}
        onPointerDown={(e) => {
          if (d <= 0) return;
          // Ignore a second concurrent press while a scrub is already active —
          // otherwise a stray second finger captures its own pointer and hijacks
          // the drag (multi-touch cross-talk).
          if (scrubbingRef.current) return;
          // The trim handles are now grabbed exclusively via their ABOVE-TRACK
          // tabs, so the in-track region carries no handle grab-zone: a press
          // anywhere on the track scrubs uniformly, with no near-handle dead zone.
          scrubbingRef.current = true;
          scrubPointerIdRef.current = e.pointerId;
          lastScrubCommitRef.current = null;
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          const v = source.kind === 'html' ? source.videoRef.current : null;
          if (v) v.pause();
          queueScrubAtClientX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (!scrubbingRef.current || d <= 0) return;
          if (e.pointerId !== scrubPointerIdRef.current) return;
          if (!(e.currentTarget as HTMLDivElement).hasPointerCapture(e.pointerId)) return;
          queueScrubAtClientX(e.clientX);
        }}
        onPointerUp={(e) => {
          if (!scrubbingRef.current) return;
          // Only the pointer that started the scrub may end it — lifting a stray
          // second finger must not kill a still-active drag.
          if (e.pointerId !== scrubPointerIdRef.current) return;
          scrubbingRef.current = false;
          scrubPointerIdRef.current = null;
          try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
          void finalizeScrub();
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 10,
            right: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            height: phoneChrome ? 8 : 6,
            borderRadius: 4,
            background: 'rgba(255,255,255,0.28)',
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            height: phoneChrome ? 8 : 6,
            width: d > 0 ? `calc((100% - 20px) * ${pct / 100})` : 0,
            borderRadius: 4,
            background: accent,
            pointerEvents: 'none',
          }}
        />
        {trimRange && d > 0 && trimWidthPct > 0 ? (
          <>
            <div
              style={{
                position: 'absolute',
                left: `calc(10px + (100% - 20px) * ${trimStartPct / 100})`,
                top: '50%',
                transform: 'translateY(-50%)',
                height: phoneChrome ? 10 : 8,
                width: `calc((100% - 20px) * ${trimWidthPct / 100})`,
                borderRadius: 4,
                background: `${trimAccent}44`,
                border: `1px solid ${trimAccent}`,
                pointerEvents: 'none',
                boxSizing: 'border-box',
              }}
            />
            {/* Start handle — draggable when onTrimChange is provided. */}
            {onTrimChange ? (
              <>
                {/* In-track boundary marker: visible, ALWAYS inert. The grab moved
                    to the above-track tab, so this only shows the exact trim
                    boundary and never initiates a drag. */}
                <div
                  aria-hidden
                  style={{
                    position: 'absolute',
                    left: `calc(10px + (100% - 20px) * ${trimStartPct / 100} - ${HANDLE_STRIPE_W / 2}px)`,
                    top: 2,
                    bottom: 2,
                    width: HANDLE_STRIPE_W,
                    background: trimAccent,
                    pointerEvents: 'none',
                    zIndex: 8,
                  }}
                />
                {/* Above-track grab tab — the ONLY drag initiator for the start
                    handle. Anchors its RIGHT edge at the trim-start x and extends
                    LEFT (splaying away from the end tab as the points converge);
                    shrinks to fit near the left edge but always stays above-track.
                    Feeds pointer-x into the SAME timeFromClientX -> onTrimChange
                    path — the clamp bounds and onTrimChange call are byte-identical
                    to the previous in-track handle; only the grab location moved. */}
                <div
                  aria-label="Trim start — drag to adjust"
                  title="Drag to set trim start"
                  onPointerDown={(e) => {
                    tempDebugPointer('tl-start', e.nativeEvent); // TEMP-DEBUG-POINTER
                    e.stopPropagation();
                    trimDragRef.current = 'start';
                    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    if (trimDragRef.current !== 'start') return;
                    if (!(e.currentTarget as HTMLDivElement).hasPointerCapture(e.pointerId)) return;
                    tempDebugPointer('tl-start', e.nativeEvent); // TEMP-DEBUG-POINTER
                    e.stopPropagation();
                    const next = timeFromClientX(e.clientX);
                    if (next === null || !trimRange) return;
                    onTrimChange(clamp(next, 0, trimRange.end - 0.04), trimRange.end);
                  }}
                  onPointerUp={(e) => {
                    tempDebugPointer('tl-start', e.nativeEvent); // TEMP-DEBUG-POINTER
                    trimDragRef.current = null;
                    try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
                  }}
                  style={{
                    position: 'absolute',
                    right: trimStartTabRight,
                    width: trimStartTabWidth,
                    top: -(TRIM_TAB_H + 2),
                    height: TRIM_TAB_H,
                    background: trimAccent,
                    border: '1px solid rgba(0,0,0,0.35)',
                    borderRadius: '7px 2px 2px 7px',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
                    cursor: 'ew-resize',
                    pointerEvents: 'auto',
                    touchAction: 'none',
                    zIndex: 10,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 3,
                    boxSizing: 'border-box',
                    overflow: 'hidden',
                  }}
                >
                  <span aria-hidden style={{ width: 2, height: '46%', borderRadius: 1, background: 'rgba(255,255,255,0.92)', pointerEvents: 'none' }} />
                  <span aria-hidden style={{ width: 2, height: '46%', borderRadius: 1, background: 'rgba(255,255,255,0.92)', pointerEvents: 'none' }} />
                </div>
              </>
            ) : (
              <div
                style={{
                  position: 'absolute',
                  left: `calc(10px + (100% - 20px) * ${trimStartPct / 100} - 1px)`,
                  top: 2,
                  bottom: 2,
                  width: 2,
                  background: trimAccent,
                  pointerEvents: 'none',
                  zIndex: 8,
                  touchAction: 'none',
                }}
              />
            )}
            {/* End handle */}
            {onTrimChange ? (
              <>
                {/* In-track boundary marker: visible, ALWAYS inert. The grab moved
                    to the above-track tab, so this only shows the exact trim
                    boundary and never initiates a drag. */}
                <div
                  aria-hidden
                  style={{
                    position: 'absolute',
                    left: `calc(10px + (100% - 20px) * ${trimEndPct / 100} - ${HANDLE_STRIPE_W / 2}px)`,
                    top: 2,
                    bottom: 2,
                    width: HANDLE_STRIPE_W,
                    background: trimAccent,
                    pointerEvents: 'none',
                    zIndex: 8,
                  }}
                />
                {/* Above-track grab tab — the ONLY drag initiator for the end
                    handle. Anchors its LEFT edge at the trim-end x and extends
                    RIGHT (splaying away from the start tab as the points converge);
                    shrinks to fit near the right edge but always stays above-track.
                    Feeds pointer-x into the SAME timeFromClientX -> onTrimChange
                    path — the clamp bounds and onTrimChange call are byte-identical
                    to the previous in-track handle; only the grab location moved. */}
                <div
                  aria-label="Trim end — drag to adjust"
                  title="Drag to set trim end"
                  onPointerDown={(e) => {
                    tempDebugPointer('tl-end', e.nativeEvent); // TEMP-DEBUG-POINTER
                    e.stopPropagation();
                    trimDragRef.current = 'end';
                    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    if (trimDragRef.current !== 'end') return;
                    if (!(e.currentTarget as HTMLDivElement).hasPointerCapture(e.pointerId)) return;
                    tempDebugPointer('tl-end', e.nativeEvent); // TEMP-DEBUG-POINTER
                    e.stopPropagation();
                    const next = timeFromClientX(e.clientX);
                    if (next === null || !trimRange) return;
                    onTrimChange(trimRange.start, clamp(next, trimRange.start + 0.04, d));
                  }}
                  onPointerUp={(e) => {
                    tempDebugPointer('tl-end', e.nativeEvent); // TEMP-DEBUG-POINTER
                    trimDragRef.current = null;
                    try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
                  }}
                  style={{
                    position: 'absolute',
                    left: trimEndTabLeft,
                    width: trimEndTabWidth,
                    top: -(TRIM_TAB_H + 2),
                    height: TRIM_TAB_H,
                    background: trimAccent,
                    border: '1px solid rgba(0,0,0,0.35)',
                    borderRadius: '2px 7px 7px 2px',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
                    cursor: 'ew-resize',
                    pointerEvents: 'auto',
                    touchAction: 'none',
                    zIndex: 10,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 3,
                    boxSizing: 'border-box',
                    overflow: 'hidden',
                  }}
                >
                  <span aria-hidden style={{ width: 2, height: '46%', borderRadius: 1, background: 'rgba(255,255,255,0.92)', pointerEvents: 'none' }} />
                  <span aria-hidden style={{ width: 2, height: '46%', borderRadius: 1, background: 'rgba(255,255,255,0.92)', pointerEvents: 'none' }} />
                </div>
              </>
            ) : (
              <div
                style={{
                  position: 'absolute',
                  left: `calc(10px + (100% - 20px) * ${trimEndPct / 100} - 1px)`,
                  top: 2,
                  bottom: 2,
                  width: 2,
                  background: trimAccent,
                  pointerEvents: 'none',
                  zIndex: 8,
                  touchAction: 'none',
                }}
              />
            )}
          </>
        ) : null}
        {phaseMarkers && d > 0 ? phaseMarkers.map((m) => {
          const pctM = timeToPct(m.time);
          const selected = m.id === selectedPhaseMarkerId;
          return (
            <div
              key={m.id}
              title={`${m.label} @ ${formatTimeShort(m.time)}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                phaseDragIdRef.current = m.id;
                onPhaseMarkerSelect?.(m.id);
                (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (phaseDragIdRef.current !== m.id) return;
                if (!(e.currentTarget as HTMLDivElement).hasPointerCapture(e.pointerId)) return;
                e.stopPropagation();
                const next = timeFromClientX(e.clientX);
                if (next === null || !onPhaseMarkerChange) return;
                const lo = phaseMarkerBounds?.start ?? 0;
                const hi = phaseMarkerBounds?.end ?? d;
                onPhaseMarkerChange(m.id, clamp(next, lo, hi));
              }}
              onPointerUp={(e) => {
                if (phaseDragIdRef.current !== m.id) return;
                phaseDragIdRef.current = null;
                try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
              }}
              style={{
                position: 'absolute',
                left: `calc(10px + (100% - 20px) * ${pctM / 100} - 5px)`,
                top: 2,
                width: 10,
                height: scrubTrackH - 4,
                borderRadius: 3,
                background: selected ? '#34C759' : 'rgba(52,199,89,0.75)',
                border: selected ? '2px solid #fff' : '1px solid rgba(0,0,0,0.35)',
                cursor: 'ew-resize',
                // Above the inert in-track trim stripe (z8) so a marker coincident
                // with a trim boundary paints on top and stays grabbable. (The trim
                // grab itself now lives on the above-track tab at z10.)
                zIndex: 9,
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'center',
                paddingTop: 1,
                fontSize: 8,
                fontWeight: 700,
                color: '#fff',
                touchAction: 'none',
              }}
            >
              {m.short ?? m.label.charAt(0)}
            </div>
          );
        }) : null}
        {sampleMarkers && d > 0 ? sampleMarkers.map((m) => {
          const pctM = timeToPct(m.time);
          return (
            <div
              key={m.id}
              role="button"
              tabIndex={0}
              title={`Frame stop ${m.label ?? ''} @ ${formatTimeShort(m.time)} — drag to adjust`}
              onPointerDown={(e) => {
                e.stopPropagation();
                sampleDragIdRef.current = m.id;
                onSampleMarkerSelect?.(m.id, m.time);
                (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (sampleDragIdRef.current !== m.id) return;
                if (!(e.currentTarget as HTMLDivElement).hasPointerCapture(e.pointerId)) return;
                e.stopPropagation();
                const next = timeFromClientX(e.clientX);
                if (next === null || !onSampleMarkerChange) return;
                const lo = sampleMarkerBounds?.start ?? 0;
                const hi = sampleMarkerBounds?.end ?? d;
                onSampleMarkerChange(m.id, clamp(next, lo, hi));
              }}
              onPointerUp={(e) => {
                if (sampleDragIdRef.current !== m.id) return;
                sampleDragIdRef.current = null;
                try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
              }}
              onClick={(e) => {
                e.stopPropagation();
                onSampleMarkerSelect?.(m.id, m.time);
                void seekTo(m.time);
              }}
              style={{
                position: 'absolute',
                left: `calc(10px + (100% - 20px) * ${pctM / 100} - 7px)`,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: 'linear-gradient(145deg, #D4FF00 0%, #9ACD00 55%, #6B8E00 100%)',
                border: '2px solid rgba(255,255,255,0.9)',
                boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
                cursor: 'ew-resize',
                // Above the inert in-track trim stripe (z8): the first/last frame-stop
                // balls sit exactly on the start/end boundaries, so the ball paints on
                // top there and stays independently grabbable. (The handle grab now
                // lives on the above-track tab at z10, clear of these on-track balls.)
                zIndex: 9,
                touchAction: 'none',
              }}
            />
          );
        }) : null}
        <div
          style={{
            position: 'absolute',
            left: d > 0 ? `calc(10px + (100% - 20px) * ${pct / 100} - ${thumbSize / 2}px)` : 10,
            top: '50%',
            transform: 'translateY(-50%)',
            width: thumbSize,
            height: thumbSize,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: `0 0 0 3px ${accent}, 0 2px 8px rgba(0,0,0,0.35)`,
            pointerEvents: 'none',
          }}
        />
      </div>

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
        {compareSlot && onCompareSlotChange ? (
          <select
            aria-label="Video slot"
            value={compareSlot}
            onChange={(e) => onCompareSlotChange(e.target.value as 'A' | 'B' | 'AB')}
            style={{
              ...selectStyle,
              height: phoneChrome ? 34 : 40,
              minWidth: phoneChrome ? 52 : 72,
              flexShrink: 0,
            }}
          >
            <option value="A">A</option>
            <option value="B">B</option>
            <option
              value="AB"
              disabled={compareAbDisabled}
              title={compareAbDisabled ? 'AB sync requires both slots to use local video files (not YouTube or embedded links)' : undefined}
            >
              AB{compareAbDisabled ? ' (local files only)' : ''}
            </option>
          </select>
        ) : null}
        {/* Zoom controls first — always visible even on narrow phone screens */}
        <button type="button" onClick={() => zoomBy(0.65)} style={{ ...btnStyle, minWidth: 36, fontSize: 16 }} title="Zoom in (+)">+</button>
        <button type="button" onClick={() => zoomBy(1.5)} style={{ ...btnStyle, minWidth: 36, fontSize: 16 }} title="Zoom out (−)">−</button>
        {trimRange ? (
          <button type="button" onClick={zoomToTrim} style={{ ...btnStyle, minWidth: 40, fontSize: 11 }} title="Fit trim range">Fit</button>
        ) : null}
        <button type="button" onClick={zoomFull} style={{ ...btnStyle, minWidth: 40, fontSize: 11 }} title="Full timeline">All</button>

        <button onClick={togglePlay} style={{ ...btnStyle, minWidth: phoneChrome ? 40 : 52, background: isPlaying ? accent : 'rgba(255,255,255,0.08)' }} title="Play/Pause (Space)">
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button onClick={() => stepFrame(-1)} style={btnStyle} title={`Back 1 frame (←) @ ${selectedFps}fps`}>◀</button>
        <button onClick={() => stepFrame(1)} style={btnStyle} title={`Forward 1 frame (→) @ ${selectedFps}fps`}>▶</button>

        <div style={{ minWidth: 130, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, opacity: 0.95 }}>
          <div style={{ lineHeight: 1.1 }}>{formatTime(displayT)}</div>
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

      {/* Vertical tick markers */}
      {d > 0 && (
        <TimelineMarkers
          duration={d}
          overlay={overlay}
          onSeek={(time) => { void seekTo(time); }}
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

