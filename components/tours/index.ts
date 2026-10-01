import { DRAW_TOUR } from './drawTour';
import type { TourDef } from './types';

export type { TourDef, TourStep, TourAdvance, TourPlacement } from './types';

/**
 * Every tour the ? button offers, in the order it lists them. Tour A ("Getting
 * started") joins here next and becomes the welcome tour.
 */
export const TOURS: ReadonlyArray<TourDef> = [DRAW_TOUR];

/** The tour the first-visit welcome card starts. */
export const WELCOME_TOUR_ID = DRAW_TOUR.id;
