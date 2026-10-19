'use client';

import React, { useEffect, useState } from 'react';
import { firstFrameLogLines, subscribeFirstFrameLog, videoStateText } from '@/lib/firstFrame';

/**
 * /analysis?vdebug=1 only: the analysis video's live state and the first-frame
 * log (events + which strategy ran and how it ended), small enough to read off
 * one phone screenshot. Read-only: it never touches the video.
 */
export default function VideoDebugBox({ videoRef }: { videoRef: React.RefObject<HTMLVideoElement | null> }) {
  const [, setTick] = useState(0);
  // Read on the client only (the page is server-rendered too).
  const [ua, setUa] = useState('');
  useEffect(() => {
    setUa(navigator.userAgent.match(/(iPhone OS [\d_]+|CPU OS [\d_]+|Android [\d.]+|Mac OS X [\d_]+|Windows NT [\d.]+|Linux)/)?.[0] ?? '?');
  }, []);
  useEffect(() => {
    const unsub = subscribeFirstFrameLog(() => setTick((n) => n + 1));
    const iv = window.setInterval(() => setTick((n) => n + 1), 250);
    return () => { unsub(); window.clearInterval(iv); };
  }, []);
  const v = videoRef.current;
  const lines = firstFrameLogLines();
  return (
    <div
      data-testid="vdebug"
      style={{
        // Top, newest line first, taps pass through: it never covers the picture's middle
        // or takes a tap meant for the video (S5).
        position: 'fixed', left: 4, top: 4, zIndex: 100000, maxWidth: 'min(96vw, 520px)', maxHeight: '38vh',
        overflowY: 'auto', padding: '6px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.82)', color: '#9EF7A0',
        font: '10px/1.35 ui-monospace, Menlo, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        pointerEvents: 'none',
      }}
    >
      <div style={{ color: '#fff', fontWeight: 700 }}>vdebug · {ua}</div>
      <div style={{ color: '#FFD86B' }}>now A: {v ? videoStateText(v) : 'no video element'}</div>
      {[...lines].reverse().map((l, i) => <div key={i}>{`${l.t}ms ${l.slot} ${l.text}`}</div>)}
    </div>
  );
}
