import type { TourImage } from './types';

/**
 * A step picture: a real crop of the founder's captures (marketing-originals/),
 * saved as public/tours/<tour>/<name>.webp at 480 px wide.
 */
export const shot = (tour: string, name: string, height: number, alt: string): TourImage => ({
  src: `/tours/${tour}/${name}.webp`,
  width: 480,
  height,
  alt,
});
