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
  | 'mark-moved';

export interface TourSignalDetail {
  name: TourSignalName;
  tool?: string;
}

export function emitTourSignal(name: TourSignalName, extra?: Omit<TourSignalDetail, 'name'>): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<TourSignalDetail>(TOUR_SIGNAL_EVENT, { detail: { name, ...extra } }));
}
