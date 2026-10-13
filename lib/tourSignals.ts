/**
 * Guided-tour signals — how the app tells an open tour that the coach just DID
 * something the tour asked for, when that action has no DOM element of its own
 * to watch (a mark drawn on the canvas, a mark dragged, an angle differential
 * captured).
 *
 * Fire-and-forget window events: emitting costs one dispatch with no listener
 * when no tour is open, and the app never depends on anyone hearing them. Only
 * components/GuidedTour.tsx listens.
 */

export const TOUR_SIGNAL_EVENT = 'anglemotion-tour-signal';

export type TourSignalName =
  /** A drawn mark was committed. `tool` is the stroke's tool id ('arrowAngle', 'pen', 'circle', …). */
  | 'mark-drawn'
  /** Angle differential: the two-arrow flow was armed (the next two angle arrows are its own). */
  | 'angle-diff-armed'
  /** Angle differential: the first of its two arrows was captured. */
  | 'angle-diff-first'
  /** Angle differential: the second arrow landed and the difference was logged. */
  | 'angle-diff-done'
  /** Style mode: a finished mark was picked for restyling. */
  | 'style-mark-selected'
  /** Style mode: the picked mark's colour, thickness, dash or opacity changed. */
  | 'style-changed'
  /** Select tool: a mark was dragged to a new position. */
  | 'mark-moved'
  /** AI Detect Angles read the pose on this frame and filled the data column. */
  | 'ai-angles-detected'
  /** Ruler: a calibration was accepted (the panel now says Calibrated). */
  | 'ruler-calibrated'
  /** Ruler: a distance was measured on the frame. */
  | 'ruler-measured'
  /** Ruler: the units were switched (cm / m ↔ ft / in). */
  | 'ruler-units'
  /** Players: a new player was added from the New player box. */
  | 'player-created';

export interface TourSignalDetail {
  name: TourSignalName;
  tool?: string;
}

export function emitTourSignal(name: TourSignalName, extra?: Omit<TourSignalDetail, 'name'>): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<TourSignalDetail>(TOUR_SIGNAL_EVENT, { detail: { name, ...extra } }));
}

/**
 * Tour STATE — for things that take a while rather than happen at once (the
 * live skeleton loading). A step that waits on one reads the current value the
 * moment it opens, so it does not matter whether the change came before or
 * after the step; updates are also broadcast as TOUR_STATE_EVENT.
 *
 * The app reports at the points it ALREADY detects the change (no new
 * detection): components/Canvas.tsx reports the skeleton as 'loading' where it
 * draws "Preparing the skeleton…", 'ready' where it says "Skeleton ready", and
 * 'failed' where the pose engine reports "Skeleton load failed". Repeated
 * reports of the same value cost one comparison.
 */
export const TOUR_STATE_EVENT = 'anglemotion-tour-state';

export type TourStateName = 'skeleton';
export type TourLoadState = 'loading' | 'ready' | 'failed';

const STORE_KEY = '__anglemotionTourStates';
type Store = Partial<Record<TourStateName, TourLoadState>>;

function store(): Store {
  const g = globalThis as unknown as Record<string, Store | undefined>;
  return (g[STORE_KEY] ??= {});
}

export function reportTourState(name: TourStateName, value: TourLoadState): void {
  const s = store();
  if (s[name] === value) return;
  s[name] = value;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(TOUR_STATE_EVENT, { detail: { name, value } }));
}

/** The last reported value, or null if the app has not reported one this page load. */
export function readTourState(name: TourStateName): TourLoadState | null {
  return store()[name] ?? null;
}
