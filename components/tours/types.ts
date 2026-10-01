import type { TourSignalName } from '@/lib/tourSignals';

export type TourPlacement = 'top' | 'bottom' | 'left' | 'right' | 'center';

/**
 * How a step finishes.
 *  - 'next':    an explanation; the coach presses Next.
 *  - 'visible': the coach does something in the real UI and the step ends the
 *               moment `selector` matches a VISIBLE element (the panel they
 *               opened, the tool they switched on).
 *  - 'signal':  the action has no element to watch (a mark drawn on the
 *               canvas…), so the app reports it — see lib/tourSignals.ts.
 */
export type TourAdvance =
  | { kind: 'next' }
  | { kind: 'visible'; selector: string }
  | { kind: 'signal'; name: TourSignalName; tool?: string };

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /**
   * `data-tour-id` of the element to highlight. The first VISIBLE match wins,
   * so ids that exist in more than one place (desktop and phone chrome, A and B
   * panels) resolve to the one on screen. Omit for a centred, untargeted card.
   */
  target?: string;
  /**
   * The target is a working AREA (the video canvas), not a control: it is
   * highlighted and stays fully usable, and the card sits beside it — or in
   * its top-left corner when it fills the screen — instead of over its middle.
   */
  area?: boolean;
  placement?: TourPlacement;
  advance: TourAdvance;
  /** Skip the step on entry if this selector already matches a visible element. */
  skipIf?: string;
}

export interface TourDef {
  id: string;
  title: string;
  summary: string;
  steps: ReadonlyArray<TourStep>;
}
