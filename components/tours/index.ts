import { DRAW_TOUR } from './drawTour';
import { INTRO_TOUR } from './introTour';
import type { TourDef } from './types';

export type { TourDef, TourStep, TourAdvance, TourPlacement, TourCorner } from './types';

/** Every tour the ? button offers, in the order it lists them. */
export const TOURS: ReadonlyArray<TourDef> = [INTRO_TOUR, DRAW_TOUR];

/** The tour the first-visit welcome card starts. */
export const WELCOME_TOUR_ID = INTRO_TOUR.id;
