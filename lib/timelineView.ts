/**
 * Timeline maths for components/PreciseTimeline.tsx, kept pure so
 * tests/timelineView.test.ts covers it.
 *
 * Two things are independent and must stay so:
 *  - the SELECTION (trim range, e.g. the Motion Layer's start/end), in video
 *    seconds — changed only by dragging its handles (or by the page);
 *  - the VIEW (zoom + scroll), the window of video time the track shows —
 *    changed by the zoom controls (+ / − / Fit / All), pinch and Ctrl/⌘-wheel
 *    zoom, scrolling (trackpad, the ruler, the overview bar), the view
 *    following the playhead, or the one-time fit on entry.
 * Nothing here takes both and writes the other.
 *
 * The ruler (rulerTicks) is derived from the VIEW only.
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

/** A view kept inside [0, dur] with its span in [MIN_VIEW_SPAN, dur]; null when it shows the whole clip. */
export function clampView(view: TimeRange | null, dur: number): TimeRange | null {
  if (!view || !(dur > 0)) return null;
  const span = clamp(view.end - view.start, Math.min(MIN_VIEW_SPAN, dur), dur);
  if (span >= dur - 1e-9) return null;
  const start = clamp(view.start, 0, dur - span);
  return { start, end: start + span };
}

/**
 * Zoom by `factor` (< 1 = in) keeping `anchorTime` under the same point of the
 * track: `anchorFrac` is where that point is across the track (0 = left edge,
 * 1 = right). Pinch and Ctrl/⌘-wheel zoom on the pointer with this; the
 * + / − buttons keep zoomView (anchored on the playhead).
 */
export function zoomAt(
  view: TimeRange | null,
  dur: number,
  factor: number,
  anchorTime: number,
  anchorFrac: number,
): TimeRange | null {
  if (!(dur > 0) || !(factor > 0)) return view;
  const v = resolveView(view, dur);
  const span = Math.max(v.end - v.start, MIN_VIEW_SPAN);
  const newSpan = clamp(span * factor, Math.min(MIN_VIEW_SPAN, dur), dur);
  const f = clamp(anchorFrac, 0, 1);
  return clampView({ start: anchorTime - f * newSpan, end: anchorTime - f * newSpan + newSpan }, dur);
}

/** Scroll the view by `deltaSec` (positive = later). The whole-clip view has nothing to scroll. */
export function panView(view: TimeRange | null, dur: number, deltaSec: number): TimeRange | null {
  if (!view || !(dur > 0) || !Number.isFinite(deltaSec)) return view;
  return clampView({ start: view.start + deltaSec, end: view.end + deltaSec }, dur);
}

/** The view of the same span centred on `t` (overview bar: press outside the window). */
export function centerViewOn(view: TimeRange | null, dur: number, t: number): TimeRange | null {
  if (!view) return view;
  const span = view.end - view.start;
  return clampView({ start: t - span / 2, end: t + span / 2 }, dur);
}

/**
 * Pinch: the view the gesture describes, from the view and finger positions at
 * its start. Fingers apart → zoom in; the time that was under the fingers'
 * midpoint stays under the midpoint as it moves (so a pinch can also pan).
 */
export function pinchView(
  startView: TimeRange | null,
  dur: number,
  startDistPx: number,
  distPx: number,
  anchorTime: number,
  midFrac: number,
): TimeRange | null {
  if (!(startDistPx > 0) || !(distPx > 0)) return startView;
  return zoomAt(startView, dur, startDistPx / distPx, anchorTime, midFrac);
}

/** While playing, the view pages when the playhead passes this share of it… */
export const FOLLOW_PAGE_AT = 0.9;
/** …and puts the playhead back at this share. */
export const FOLLOW_LAND_AT = 0.1;

/**
 * Follow the playhead: the view to show for playhead time `t`, or the SAME
 * view object when it already shows it well (so a caller can skip the update).
 *  - 'playing': pages — one jump that puts the playhead at 10 % once it passes
 *    90 % — instead of sliding with every time update: one view change every
 *    ~0.8 view-widths of playback, not one per frame.
 *  - 'reveal' (paused, after a seek): moves only when the playhead is outside
 *    the view, so finishing a scrub near the edge never shifts the view.
 */
export function followPlayhead(
  view: TimeRange | null,
  dur: number,
  t: number,
  mode: 'playing' | 'reveal' = 'playing',
): TimeRange | null {
  if (!view || !(dur > 0)) return view;
  const span = view.end - view.start;
  const keepUpTo = mode === 'playing' ? view.start + span * FOLLOW_PAGE_AT : view.end;
  if (t >= view.start - 1e-9 && t <= keepUpTo + 1e-9) return view;
  if (t >= view.start && view.end >= dur - 1e-9) return view; // already at the clip's end
  const next = clampView({ start: t - span * FOLLOW_LAND_AT, end: t - span * FOLLOW_LAND_AT + span }, dur);
  return next && Math.abs(next.start - view.start) < 1e-9 ? view : next;
}

/**
 * Whether the view follows the playhead. The coach moving the view by hand
 * (scroll, pinch / wheel zoom, Fit) stops it; pressing play or seeking (a press
 * or drag on the track, frame steps, the ruler, a marker) turns it back on.
 */
export type FollowEvent = 'play' | 'seek' | 'manual-view';
export function nextFollow(event: FollowEvent): boolean {
  return event !== 'manual-view';
}

/* ── Ruler ─────────────────────────────────────────────────────────────── */

/** Labels are at least this far apart (px), so they never overlap. */
export const RULER_MIN_LABEL_PX = 64;
/** Minor ticks closer than this are left out. */
const RULER_MIN_MINOR_PX = 7;

/** Frame counts a sub-second step may use (only those dividing the frame rate, so ticks land on whole seconds). */
const FRAME_STEPS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30, 60];
/** Steps of a second and up. */
const SECOND_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600];

export interface RulerTick {
  /** Video time of the tick (s). */
  t: number;
  /** x inside the track (px from its left edge, inset included). */
  x: number;
  label: string;
}

export interface Ruler {
  /** Labelled (major) step, s. */
  step: number;
  /** Minor tick step, s (0 = no minor ticks). */
  minorStep: number;
  /** Major step in frames when below one second, else 0. */
  stepFrames: number;
  ticks: RulerTick[];
  /** x of the first minor tick and the minor spacing, px — drawn as one repeating pattern. */
  minorOffsetPx: number;
  minorPx: number;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "m:ss", or "h:mm:ss" from one hour on (or whenever the clip reaches an hour). */
export function formatRulerTime(t: number, longClip: boolean): string {
  const s = Math.floor(t + 1e-6);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 || longClip ? `${h}:${pad2(m)}:${pad2(sec)}` : `${m}:${pad2(sec)}`;
}

/** Rough label width (px) for the font the ruler uses (10 px monospace ≈ 6.1 px a character, plus padding). */
export const rulerLabelWidthPx = (label: string) => Math.ceil(label.length * 6.1 + 4);

/**
 * The ruler for a view: the smallest "nice" step whose labels are at least
 * RULER_MIN_LABEL_PX apart — single frames when zoomed right in (labels
 * "+N f" between whole seconds), up to hours for a whole long clip — and the
 * minor ticks between them. Labels never overlap and never run past the right
 * edge (a label that would is dropped).
 */
export function rulerTicks(
  view: TimeRange,
  trackWidthPx: number,
  fps: number,
  dur: number,
  inset = TRACK_INSET_PX,
): Ruler {
  const empty: Ruler = { step: 0, minorStep: 0, stepFrames: 0, ticks: [], minorOffsetPx: 0, minorPx: 0 };
  const span = view.end - view.start;
  const usable = trackWidthPx - 2 * inset;
  if (!(span > 0) || !(usable > 0) || !(dur > 0)) return empty;
  const pxPerSec = usable / span;
  const f = Math.max(1, Math.round(fps > 0 ? fps : 30));
  const frameSteps = FRAME_STEPS.filter((n) => n < f && f % n === 0).map((n) => ({ step: n / f, frames: n }));
  const candidates = [...frameSteps, ...SECOND_STEPS.map((s) => ({ step: s, frames: 0 }))];
  const pick = candidates.find((c) => c.step * pxPerSec >= RULER_MIN_LABEL_PX) ?? candidates[candidates.length - 1];
  const step = pick.step;
  const longClip = dur >= 3600;

  // Minor ticks: the largest subdivision still at least RULER_MIN_MINOR_PX apart.
  let minorStep = 0;
  for (const div of [10, 5, 4, 2]) {
    if (pick.frames && pick.frames % div !== 0) continue;
    if ((step / div) * pxPerSec >= RULER_MIN_MINOR_PX) { minorStep = step / div; break; }
  }

  const label = (t: number): string => {
    if (!pick.frames) return formatRulerTime(t, longClip);
    const total = Math.round(t * f);
    const frame = total % f;
    return frame === 0 ? formatRulerTime(total / f, longClip) : `+${frame}f`;
  };

  const ticks: RulerTick[] = [];
  const first = Math.ceil(view.start / step - 1e-6);
  for (let k = first; ; k++) {
    const t = pick.frames ? (k * pick.frames) / f : k * step;
    if (t > view.end + 1e-6 || t > dur + 1e-6) break;
    const x = inset + (t - view.start) * pxPerSec;
    const text = label(t);
    if (x + rulerLabelWidthPx(text) > trackWidthPx) break; // would run past the right edge
    ticks.push({ t, x, label: text });
    if (ticks.length > 400) break; // safety; the step choice keeps this far lower
  }

  let minorOffsetPx = 0;
  let minorPx = 0;
  if (minorStep > 0) {
    minorPx = minorStep * pxPerSec;
    const firstMinor = Math.ceil(view.start / minorStep - 1e-6) * minorStep;
    minorOffsetPx = inset + (firstMinor - view.start) * pxPerSec;
  }
  return { step, minorStep, stepFrames: pick.frames, ticks, minorOffsetPx, minorPx };
}
