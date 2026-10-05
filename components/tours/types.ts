import type { TourSignalName } from '@/lib/tourSignals';

export type TourPlacement = 'top' | 'bottom' | 'left' | 'right' | 'center';
export type TourCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/**
 * How a step finishes.
 *  - 'next':    an explanation; the coach presses Next.
 *  - 'visible': the coach does something in the real UI and the step ends the
 *               moment `selector` matches a VISIBLE element (the panel they
 *               opened, the tool they switched on).
 *  - 'click':   the coach clicks the highlighted target itself. For buttons
 *               whose effect leaves nothing new to watch (play, one frame
 *               forward, a press on the timeline).
 *  - 'signal':  the action has no element to watch (a mark drawn on the
 *               canvas…), so the app reports it — see lib/tourSignals.ts.
 */
export type TourAdvance =
  | { kind: 'next' }
  | { kind: 'visible'; selector: string }
  | { kind: 'click' }
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
  /**
   * Area steps only: the inside corner the card tucks into when it cannot sit
   * beside the area (default 'top-left'). Pick the corner clear of what the
   * step is about — e.g. the data column, drawn at the canvas's top right.
   */
  corner?: TourCorner;
  placement?: TourPlacement;
  advance: TourAdvance;
  /** Skip the step on entry if this selector already matches a visible element. */
  skipIf?: string;
  /**
   * A small real screenshot of the tool in use (public/tours/<tour-id>/,
   * WebP ~480 px wide). Cut from the founder's captures — never mocked. Steps
   * with no suitable capture have none (see docs/TOUR_SCREENSHOTS.md).
   */
  image?: TourImage;
}

export interface TourImage {
  src: string;
  width: number;
  height: number;
  alt: string;
}

export interface TourDef {
  id: string;
  title: string;
  summary: string;
  /** Pro tool the tour is about (lib/tourAccess.ts decides whether to offer it). */
  feature?: string;
  steps: ReadonlyArray<TourStep>;
}
