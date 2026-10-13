/**
 * What a tour step that waits on something slow (the live skeleton loading)
 * shows. Pure, so tests/tourWait.test.ts covers it; the engine
 * (components/GuidedTourEngine.tsx) feeds it the app's state, whether the
 * app's own "it's ready" prompt is on screen, and how long the step has been
 * open.
 *
 *  - 'loading': spinner + the loading line; the step's instructions are held back.
 *  - 'slow':    still loading after `slowAfterMs` — the loading line plus the
 *               fallback line, so the coach is never left without a next move.
 *  - 'failed':  the app reported a failure — the fallback line.
 *  - 'ready':   the step's own instructions.
 *
 * Nothing here advances the tour: the step still ends only when the coach
 * presses Next (or skips / goes back).
 */
import type { TourLoadState } from '@/lib/tourSignals';

export type TourWaitPhase = 'loading' | 'slow' | 'failed' | 'ready';

export function tourWaitPhase(input: {
  /** The app's last report (null: none yet this page load). */
  state: TourLoadState | null;
  /** The app's own "it's ready" prompt is on screen (e.g. "Is the skeleton over the player?"). */
  readyPromptVisible: boolean;
  /** Time since the step opened. */
  elapsedMs: number;
  slowAfterMs: number;
}): TourWaitPhase {
  if (input.readyPromptVisible || input.state === 'ready') return 'ready';
  if (input.state === 'failed') return 'failed';
  return input.elapsedMs >= input.slowAfterMs ? 'slow' : 'loading';
}
