import { DRAW_TOUR } from './drawTour';
import { INTRO_TOUR } from './introTour';
import { OVERVIEW_TOUR } from './overviewTour';
import { RULER_TOUR } from './rulerTour';
import type { TourDef } from './types';

export type { TourDef, TourStep, TourAdvance, TourPlacement, TourCorner, TourImage } from './types';

/** The screens that mount the tour engine, each with its own ? list. */
export type TourPageId = 'analysis' | 'control-panel' | 'players' | 'match-report' | 'decoder';

/** Every tour each screen's ? button offers, in the order it lists them. */
export const TOURS_BY_PAGE: Record<TourPageId, ReadonlyArray<TourDef>> = {
  analysis: [INTRO_TOUR, DRAW_TOUR, RULER_TOUR],
  'control-panel': [OVERVIEW_TOUR],
  players: [],
  'match-report': [],
  decoder: [],
};

export const ALL_TOURS: ReadonlyArray<TourDef> = Object.values(TOURS_BY_PAGE).flat();

/** The tour the first-visit welcome card starts (analysis only). */
export const WELCOME_TOUR_ID = INTRO_TOUR.id;
