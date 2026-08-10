import type { Point2D } from './types';
import { RACKET_LENGTH_M } from './units';

export type CalibrationMethod = 'simple' | 'homography';

export interface RulerPreset {
  id: string;
  label: string;
  icon: string;
  description: string;
  pointCount: 2 | 4;
  pointLabels: string[];
  /** Real-world coords in meters (for 2-point: [start, end]; for 4-point: corners) */
  dstPoints: Point2D[];
  /** For simple 2-point mode: known distance in meters */
  referenceDistance?: number;
  method: CalibrationMethod;
}

export const RULER_PRESETS: RulerPreset[] = [
  {
    // First in the list on purpose: it is the only reference that is in frame
    // in essentially every clip, so a coach who knows nothing about the court
    // (or the player's height) can still calibrate immediately.
    id: 'racket',
    label: 'Racket',
    icon: '🎾',
    description: 'Click the butt cap then the tip of the racket — most adult rackets are 27 in (68.6 cm)',
    pointCount: 2,
    pointLabels: ['Racket butt cap (bottom of handle)', 'Racket tip (top of frame)'],
    dstPoints: [{ x: 0, y: 0 }, { x: RACKET_LENGTH_M, y: 0 }],
    referenceDistance: RACKET_LENGTH_M,
    method: 'simple',
  },
  {
    id: 'net-post-height',
    label: 'Net Post',
    icon: '📏',
    description: 'Click the base then top of a net post (1.07 m tall)',
    pointCount: 2,
    pointLabels: ['Net post base (ground level)', 'Net post top'],
    dstPoints: [{ x: 0, y: 0 }, { x: 0, y: 1.07 }],
    referenceDistance: 1.07,
    method: 'simple',
  },
  {
    id: 'net-width',
    label: 'Net Width',
    icon: '↔️',
    description: 'Click the base of left post, then base of right post (12.8 m doubles, 10.06 m singles)',
    pointCount: 2,
    pointLabels: ['Left net post base', 'Right net post base'],
    dstPoints: [{ x: 0, y: 0 }, { x: 12.8, y: 0 }],
    referenceDistance: 12.8,
    method: 'simple',
  },
  {
    id: 'service-box',
    label: 'Service Box',
    icon: '⬜',
    description: 'Click the 4 corners of a service box for perspective correction (6.4 m × 4.115 m)',
    pointCount: 4,
    pointLabels: [
      'Near-left (net / singles sideline)',
      'Near-right (net / center service line)',
      'Far-right (service line / center service line)',
      'Far-left (service line / singles sideline)',
    ],
    dstPoints: [
      { x: 0, y: 0 },
      { x: 4.115, y: 0 },
      { x: 4.115, y: 6.4 },
      { x: 0, y: 6.4 },
    ],
    method: 'homography',
  },
  {
    id: 'singles-court',
    label: 'Singles Court',
    icon: '🎾',
    description: 'Click the 4 baseline corners of the singles court for full perspective correction (23.77 m × 8.23 m)',
    pointCount: 4,
    pointLabels: [
      'Near-left baseline corner',
      'Near-right baseline corner',
      'Far-right baseline corner',
      'Far-left baseline corner',
    ],
    dstPoints: [
      { x: 0, y: 0 },
      { x: 8.23, y: 0 },
      { x: 8.23, y: 23.77 },
      { x: 0, y: 23.77 },
    ],
    method: 'homography',
  },
  {
    id: 'custom',
    label: 'Custom Distance',
    icon: '✏️',
    description: 'Click 2 points of any object whose real-world length you know',
    pointCount: 2,
    pointLabels: ['Start point', 'End point'],
    dstPoints: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    referenceDistance: 1,
    method: 'simple',
  },
];
