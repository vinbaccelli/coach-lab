/**
 * Timeline maths for components/PreciseTimeline.tsx, kept pure so
 * tests/timelineView.test.ts covers it.
 *
 * Two things are independent and must stay so:
 *  - the SELECTION (trim range, e.g. the Motion Layer's start/end), in video
 *    seconds — changed only by dragging its handles (or by the page);
 *  - the VIEW (zoom + scroll), the window of video time the track shows —
 *    changed only by the zoom controls (+ / − / Fit / All) or the one-time fit
 *    on entry.
 * Nothing here takes both and writes the other.
 */

/** The track draws its content between 10 px insets on each side. */
export const TRACK_INSET_PX = 10;
/** Narrowest view the zoom allows (s). */
export const MIN_VIEW_SPAN = 0.08;
/** Smallest selection the handles allow (s). */
export const MIN_TRIM_GAP = 0.04;

export interface TimeRange { start: number; end: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The view as a concrete range (null = the whole clip). */
export function resolveView(view: TimeRange | null, dur: number): TimeRange {
  return { start: view?.start ?? 0, end: view?.end ?? dur };
}

/** Seconds per pixel of track at the current zoom. */
export function secondsPerPx(view: TimeRange, trackWidthPx: number, inset = TRACK_INSET_PX): number {
  const usable = Math.max(1, trackWidthPx - 2 * inset);
  return Math.max(view.end - view.start, 0.001) / usable;
}

/**
 * Video time under a pointer x, at the current zoom. Uses the SAME inset the
 * track draws with (content between 10 px and width − 10 px); the old mapping
 * ignored it, so a handle drawn at x mapped to a time up to 10 px away.
 */
export function timeAtClientX(
  clientX: number,
  track: { left: number; width: number },
  view: TimeRange,
  dur: number,
  inset = TRACK_INSET_PX,
): number {
  const usable = Math.max(1, track.width - 2 * inset);
  const raw = clamp((clientX - track.left - inset) / usable, 0, 1);
  const span = Math.max(view.end - view.start, 0.001);
  return clamp(view.start + raw * span, 0, dur);
}

/** An in-progress handle drag. `pos` is the handle's unclamped position. */
export interface TrimDrag {
  which: 'start' | 'end';
  start: number;
  end: number;
  pos: number;
  lastX: number;
}

export function beginTrimDrag(which: 'start' | 'end', range: TimeRange, clientX: number): TrimDrag {
  return { which, start: range.start, end: range.end, pos: which === 'start' ? range.start : range.end, lastX: clientX };
}

/**
 * Move the dragged handle by the pointer's movement since the last event,
 * converted to seconds at the CURRENT zoom. Relative, not absolute: a handle
 * parked at the track edge because its time is outside the view (zoomed in
 * elsewhere) still moves by exactly what the finger moves, instead of jumping
 * to the edge time and getting clamped against the other handle — which is
 * what made the selection "stick" or collapse after using + / −.
 */
export function dragTrimTo(
  drag: TrimDrag,
  clientX: number,
  view: TimeRange,
  trackWidthPx: number,
  dur: number,
  minGap = MIN_TRIM_GAP,
): TrimDrag {
  const pos = drag.pos + (clientX - drag.lastX) * secondsPerPx(view, trackWidthPx);
  if (drag.which === 'start') {
    const start = clamp(pos, 0, Math.max(0, drag.end - minGap));
    return { ...drag, pos, start, lastX: clientX };
  }
  const end = clamp(pos, Math.min(dur, drag.start + minGap), dur);
  return { ...drag, pos, end, lastX: clientX };
}

/** Zoom by `factor` (< 1 = in) around `anchor`, inside [0, dur]. Never touches the selection. */
export function zoomView(view: TimeRange | null, dur: number, factor: number, anchor: number): TimeRange | null {
  if (!(dur > 0)) return view;
  const v = resolveView(view, dur);
  const span = Math.max(v.end - v.start, MIN_VIEW_SPAN);
  const newSpan = clamp(span * factor, MIN_VIEW_SPAN, dur);
  const a = clamp(anchor, 0, dur);
  const start = clamp(a - newSpan / 2, 0, Math.max(0, dur - newSpan));
  return { start, end: start + newSpan };
}

/** The view that frames a selection with a little padding (Fit, and the one-time fit on entry). */
export function fitView(range: TimeRange, dur: number): TimeRange {
  const span = range.end - range.start;
  const pad = Math.max(0.08, span * 0.12);
  return { start: Math.max(0, range.start - pad), end: Math.min(dur, range.end + pad) };
}

/**
 * Whether the selection changing should re-fit the view. Only when fitting is
 * on, never while (or because) a handle is being dragged, once on entry, and
 * again only for a large programmatic change (e.g. "Use full video"). The
 * selection's object identity is irrelevant — only its values are passed.
 */
export function shouldAutoFit(p: {
  fitOn: boolean;
  dragging: boolean;
  alreadyFitted: boolean;
  fittedSpan: number;
  newSpan: number;
}): boolean {
  if (!p.fitOn || p.dragging) return false;
  if (!p.alreadyFitted) return true;
  return p.fittedSpan > 0 && Math.abs(p.newSpan - p.fittedSpan) / p.fittedSpan > 0.5;
}
