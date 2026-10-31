'use client';

import React, { useCallback, useRef, useState } from 'react';

/**
 * A start/end trim bar: two draggable handles on one track (pointer events, so
 * mouse, pen and touch behave the same; 44 px hit areas). Same rules as the
 * Recording Hub trim phase (components/PostRecordingCropModal.tsx), copied
 * here rather than shared so that modal stays untouched: times in seconds,
 * the kept span never shorter than `minGap`, "Use playhead" per handle, and a
 * "Keeping X of Y" line.
 *
 * Controlled: the parent owns `start`/`end` and receives every change with the
 * handle that moved, so it can scrub a preview to that time.
 */

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.0';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

type Handle = 'start' | 'end';

export interface TrimRangeBarProps {
  duration: number;
  start: number;
  end: number;
  onChange: (next: { start: number; end: number }, moved: Handle) => void;
  /** Current preview time, for the "Use playhead" buttons (omit to hide them). */
  getPlayhead?: () => number | null;
  disabled?: boolean;
  /** Shortest span that can be kept, in seconds. */
  minGap?: number;
  /** Ticks on the track (Metrics export: snapshots), green when inside the kept range. */
  marks?: ReadonlyArray<{ t: number; inRange: boolean }>;
  /** A line under "Keeping…" (Metrics export: the snapshot holds). */
  holdLine?: string | null;
}

const HIT = 44;

export default function TrimRangeBar({
  duration, start, end, onChange, getPlayhead, disabled = false, minGap = 0.1, marks, holdLine,
}: TrimRangeBarProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Handle | null>(null);
  const [dragging, setDragging] = useState<Handle | null>(null);
  const max = Math.max(duration, 0.1);
  const usable = !disabled && duration > 0;

  const clampTo = useCallback((which: Handle, t: number) => {
    if (which === 'start') return { start: Math.max(0, Math.min(t, end - minGap)), end };
    return { start, end: Math.min(max, Math.max(t, start + minGap)) };
  }, [start, end, max, minGap]);

  const timeAt = (clientX: number): number => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * max;
  };

  const move = (which: Handle, t: number) => {
    const next = clampTo(which, t);
    if (next.start !== start || next.end !== end) onChange(next, which);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!usable || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const t = timeAt(e.clientX);
    // A press on the bar grabs the nearer handle (the start one on a tie at the far left).
    const which: Handle = Math.abs(t - start) <= Math.abs(t - end) && !(t > end) ? 'start' : 'end';
    dragRef.current = which;
    setDragging(which);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    move(which, t);
    e.preventDefault();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const which = dragRef.current;
    if (!which) return;
    move(which, timeAt(e.clientX));
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(null);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };

  const onKey = (which: Handle) => (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!usable) return;
    const step = e.shiftKey ? 1 : 0.1;
    const cur = which === 'start' ? start : end;
    let t: number | null = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') t = cur - step;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') t = cur + step;
    else if (e.key === 'Home') t = 0;
    else if (e.key === 'End') t = max;
    if (t == null) return;
    e.preventDefault();
    move(which, t);
  };

  const pct = (t: number) => `${(Math.max(0, Math.min(t, max)) / max) * 100}%`;

  const handle = (which: Handle) => {
    const t = which === 'start' ? start : end;
    return (
      <div
        role="slider"
        aria-label={which === 'start' ? 'Trim start' : 'Trim end'}
        aria-valuemin={0}
        aria-valuemax={Math.round(max * 10) / 10}
        aria-valuenow={Math.round(t * 10) / 10}
        aria-valuetext={formatClock(t)}
        aria-disabled={!usable}
        tabIndex={usable ? 0 : -1}
        onKeyDown={onKey(which)}
        style={{
          position: 'absolute', top: 0, left: pct(t), width: HIT, height: HIT, marginLeft: -HIT / 2,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: dragging === which ? 3 : 2, outline: 'none',
        }}
      >
        <span style={{
          width: 16, height: 30, borderRadius: 6,
          background: usable ? 'var(--cl-accent)' : 'rgba(255,255,255,0.35)',
          border: '2px solid #fff', boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
          transform: dragging === which ? 'scale(1.12)' : undefined,
        }} />
      </div>
    );
  };

  const smallBtn: React.CSSProperties = {
    minHeight: 44, padding: '8px 12px', borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.12)',
    color: 'var(--cl-text-on-fill)', fontSize: 12, fontWeight: 600,
    cursor: usable ? 'pointer' : 'default', whiteSpace: 'nowrap', opacity: usable ? 1 : 0.5,
  };
  const usePlayhead = (which: Handle) => {
    const t = getPlayhead?.();
    if (t == null || !Number.isFinite(t)) return;
    move(which, t);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, color: 'var(--cl-text-on-fill)' }}>
      <div
        ref={trackRef}
        data-testid="trim-track"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          position: 'relative', height: HIT, margin: `0 ${HIT / 2}px`,
          touchAction: 'none', cursor: usable ? 'pointer' : 'default', userSelect: 'none',
        }}
      >
        <div style={{ position: 'absolute', left: 0, right: 0, top: HIT / 2 - 4, height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.18)' }} />
        <div style={{
          position: 'absolute', left: pct(start), width: `calc(${pct(end)} - ${pct(start)})`, top: HIT / 2 - 4, height: 8,
          borderRadius: 4, background: usable ? 'var(--cl-accent)' : 'rgba(255,255,255,0.35)',
        }} />
        {marks?.map((m, i) => (
          <span
            key={i}
            data-testid="trim-mark"
            data-in-range={m.inRange || undefined}
            aria-hidden="true"
            style={{
              position: 'absolute', left: pct(m.t), top: HIT / 2 - 11, width: 4, height: 22, marginLeft: -2, borderRadius: 2,
              background: m.inRange ? '#22C55E' : 'rgba(255,255,255,0.4)', boxShadow: '0 0 0 1px rgba(0,0,0,0.55)',
              pointerEvents: 'none', zIndex: 1,
            }}
          />
        ))}
        {handle('start')}
        {handle('end')}
      </div>

      {(['start', 'end'] as const).map((which) => (
        <div key={which} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, minWidth: 42 }}>{which === 'start' ? 'Start' : 'End'}</span>
          <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', minWidth: 56 }}>{formatClock(which === 'start' ? start : end)}</span>
          {getPlayhead ? <button type="button" style={smallBtn} disabled={!usable} onClick={() => usePlayhead(which)}>Use playhead</button> : null}
        </div>
      ))}

      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)' }}>
        {duration > 0
          ? `Keeping ${formatClock(Math.max(0, end - start))} of ${formatClock(duration)}`
          : 'Reading clip length…'}
      </div>
      {holdLine ? <div data-testid="trim-hold-line" style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: -4 }}>{holdLine}</div> : null}
    </div>
  );
}
