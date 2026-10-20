'use client';

import React, { useEffect, useState } from 'react';
import { firstFrameLogLines, firstFrameState, srcKind, subscribeFirstFrameLog } from '@/lib/firstFrame';

/**
 * /analysis?vdebug=1 only: the analysis video's live state and the first-frame
 * log (events + which strategy ran and how it ended), small enough to read off
 * one phone screenshot. Read-only: it never touches the video.
 *
 * `inline` renders it in the flow (inside the "Could not load" overlay, so the
 * cause is on the same screenshot as the error); otherwise it is fixed at the
 * top, below the iPhone status bar (`safe-area-inset-top`; the page draws under
 * it with viewport-fit=cover).
 */
/** Touch / gesture / pointer counters for the zoom diagnosis (window capture phase, passive). */
type TouchStats = { touchstart: number; maxTouches: number; lastTouches: number; gesturestart: number; gesturechange: number; lastPointerdown: string };
function describe(el: EventTarget | null): string {
  if (!(el instanceof Element)) return '?';
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const label = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('data-testid') || el.getAttribute('data-tour-id') || '';
  return `${tag}${id}${label ? `[${label.slice(0, 28)}]` : ''}`;
}

export default function VideoDebugBox({ videoRef, inline = false, getAppZoom }: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  inline?: boolean;
  /** The canvas zoom (1 = 100%), the one with the ⌂ reset. */
  getAppZoom?: () => number | null;
}) {
  const [stats, setStats] = useState<TouchStats>({ touchstart: 0, maxTouches: 0, lastTouches: 0, gesturestart: 0, gesturechange: 0, lastPointerdown: '—' });
  useEffect(() => {
    const onTouch = (e: TouchEvent) => setStats((s) => ({ ...s, touchstart: s.touchstart + 1, maxTouches: Math.max(s.maxTouches, e.touches.length), lastTouches: e.touches.length }));
    const onGS = () => setStats((s) => ({ ...s, gesturestart: s.gesturestart + 1 }));
    const onGC = () => setStats((s) => ({ ...s, gesturechange: s.gesturechange + 1 }));
    const onPD = (e: PointerEvent) => setStats((s) => ({ ...s, lastPointerdown: `${e.pointerType} → ${describe(e.target)}` }));
    window.addEventListener('touchstart', onTouch, { capture: true, passive: true });
    window.addEventListener('gesturestart', onGS, { capture: true, passive: true });
    window.addEventListener('gesturechange', onGC, { capture: true, passive: true });
    window.addEventListener('pointerdown', onPD, { capture: true, passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouch, { capture: true });
      window.removeEventListener('gesturestart', onGS, { capture: true });
      window.removeEventListener('gesturechange', onGC, { capture: true });
      window.removeEventListener('pointerdown', onPD, { capture: true });
    };
  }, []);
  const [, setTick] = useState(0);
  // Read on the client only (the page is server-rendered too).
  const [ua, setUa] = useState('');
  // How many times the element's src attribute has been set since this box mounted (should be once per upload).
  const [srcSets, setSrcSets] = useState(0);
  useEffect(() => {
    setUa(navigator.userAgent.match(/(CriOS\/[\d.]+|FxiOS\/[\d.]+|iPhone OS [\d_]+|CPU OS [\d_]+|Android [\d.]+|Mac OS X [\d_]+|Windows NT [\d.]+|Linux)/g)?.join(' ') ?? '?');
  }, []);
  useEffect(() => {
    const unsub = subscribeFirstFrameLog(() => setTick((n) => n + 1));
    let observed: HTMLVideoElement | null = null;
    let mo: MutationObserver | null = null;
    const iv = window.setInterval(() => {
      setTick((n) => n + 1);
      const v = videoRef.current;
      if (v && v !== observed && typeof MutationObserver !== 'undefined') {
        mo?.disconnect();
        observed = v;
        if (v.getAttribute('src')) setSrcSets((n) => n + 1);
        mo = new MutationObserver((recs) => setSrcSets((n) => n + recs.filter((r) => r.attributeName === 'src').length));
        mo.observe(v, { attributes: true, attributeFilter: ['src'] });
      }
    }, 250);
    return () => { unsub(); window.clearInterval(iv); mo?.disconnect(); };
  }, [videoRef]);
  const v = videoRef.current;
  const st = v ? firstFrameState(v) : null;
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  const appZoom = getAppZoom?.() ?? null;
  const lines = firstFrameLogLines();
  const row = (label: string, value: string, color = '#FFD86B') => (
    <div><span style={{ color: '#9AA4B2' }}>{label} </span><span style={{ color }}>{value}</span></div>
  );
  return (
    <div
      data-testid={inline ? 'vdebug-inline' : 'vdebug'}
      style={{
        ...(inline
          ? { position: 'relative', marginTop: 8, maxHeight: '34vh', width: '100%', textAlign: 'left', pointerEvents: 'auto' }
          // Taps pass through: it never takes a tap meant for the video (S5).
          : { position: 'fixed', left: 4, top: 'calc(env(safe-area-inset-top, 0px) + 4px)', zIndex: 100000, maxWidth: 'min(96vw, 520px)', maxHeight: '38vh', pointerEvents: 'none' }),
        overflowY: 'auto', padding: '6px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.86)', color: '#9EF7A0',
        font: '10px/1.35 ui-monospace, Menlo, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', boxSizing: 'border-box',
      }}
    >
      <div style={{ color: '#fff', fontWeight: 700 }}>vdebug · {ua}</div>
      {v ? (
        <>
          {row('error', v.error ? `code=${v.error.code} ${v.error.message || '(no message)'}` : 'none', v.error ? '#FF8A80' : '#9EF7A0')}
          {row('state', `readyState=${v.readyState} networkState=${v.networkState} ${v.videoWidth}x${v.videoHeight} t=${v.currentTime.toFixed(3)} ${v.paused ? 'paused' : 'playing'} muted=${v.muted}`)}
          {row('src', `${srcKind(v.getAttribute('src') || v.currentSrc)} · set ${srcSets}× since open`)}
          {row('strategy', st ? `${st.last} (touched=${st.touched} metadata=${st.reachedMetadata})` : 'none for this video')}
        </>
      ) : row('video', 'no video element')}
      {typeof window !== 'undefined' ? (
        <>
          {row('page zoom', `visualViewport.scale=${vv ? vv.scale.toFixed(2) : 'n/a'} innerWidth=${window.innerWidth} vv.width=${vv ? Math.round(vv.width) : 'n/a'} ratio=${vv ? (window.innerWidth / vv.width).toFixed(2) : 'n/a'}`,
            vv && Math.abs(vv.scale - 1) > 0.01 ? '#FF8A80' : '#FFD86B')}
          {row('app zoom', appZoom == null ? 'n/a' : `${Math.round(appZoom * 100)}% (⌂ resets)`, appZoom != null && appZoom > 1.001 ? '#FF8A80' : '#FFD86B')}
          {row('touch', `touchstart×${stats.touchstart} touches now=${stats.lastTouches} max=${stats.maxTouches} gesturestart×${stats.gesturestart} gesturechange×${stats.gesturechange}`)}
          {row('pointerdown', stats.lastPointerdown)}
        </>
      ) : null}
      {[...lines].reverse().map((l, i) => <div key={i}>{`${l.t}ms ${l.slot} ${l.text}`}</div>)}
    </div>
  );
}
