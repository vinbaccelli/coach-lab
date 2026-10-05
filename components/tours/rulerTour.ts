import type { TourDef } from './types';
import { shot } from './shot';

const visible = (id: string, extra = '') => `[data-tour-id="${id}"]${extra}`;

/**
 * Ruler — real-world distances on the frame. Mirrors
 * components/ruler/RulerOverlay.tsx: pick a reference, place its two points
 * (calibration), drag to measure, switch units. Calibration and measurement
 * steps advance on the ruler's own signals (lib/tourSignals.ts), never on a
 * guess.
 */
export const RULER_TOUR: TourDef = {
  id: 'ruler',
  title: 'Ruler',
  summary: 'Calibrate on the racket, then measure real distances on the frame in cm or ft.',
  steps: [
    {
      id: 'load',
      title: 'Load a clip',
      body: 'Press Upload Video, or Demo (Tutorial). Pick a frame where the whole racket is visible.',
      target: 'tour-load',
      placement: 'bottom',
      advance: { kind: 'visible', selector: visible('tour-video-ab') },
      skipIf: visible('tour-video-ab'),
      image: shot('ruler', 'load', 300, 'The empty canvas with three buttons: Upload Video, Tennis court (strategy board) and Demo (Tutorial).'),
    },
    {
      id: 'metrics',
      title: 'Open Metrics',
      body: 'The ruler lives with the drawing tools, under Metrics.',
      target: 'row-met-h',
      placement: 'right',
      advance: { kind: 'visible', selector: visible('row-m-draw') },
      skipIf: `${visible('row-m-draw')}, ${visible('row-ruler')}, ${visible('ruler-panel')}`,
      image: shot('ruler', 'metrics', 299, 'The Metrics panel: Skeleton, Unlock skeleton, Draw, Data Column ON and Add note.'),
    },
    {
      id: 'draw',
      title: 'Open Draw',
      body: 'Ruler sits near the bottom of the Draw list.',
      target: 'row-m-draw',
      placement: 'right',
      advance: { kind: 'visible', selector: visible('row-ruler') },
      skipIf: `${visible('row-ruler')}, ${visible('ruler-panel')}`,
      image: shot('ruler', 'draw', 299, 'The Draw list: Pen, Line, Arrow, Angle, Angle arrow, Rectangle and Circle.'),
    },
    {
      id: 'ruler-tool',
      title: 'Pick Ruler',
      body: 'Measures real-world distances once it knows the scale. The Measurement Ruler panel opens on the video.',
      target: 'row-ruler',
      placement: 'right',
      advance: { kind: 'visible', selector: visible('ruler-panel') },
      skipIf: visible('ruler-panel'),
      image: shot('ruler', 'ruler-tool', 299, 'The Draw list with Ruler selected, between Text and Angle differential.'),
    },
    {
      id: 'preset',
      title: 'Choose Racket as the reference',
      body: 'The ruler needs one length it knows. A racket is in almost every clip, and most adult rackets are 68.6 cm (27 in). Net Post, Net Width, Service Box, Singles Court and Custom Distance work the same way.',
      target: 'ruler-preset-racket',
      advance: { kind: 'visible', selector: visible('ruler-place-points') },
      image: shot('ruler', 'preset', 300, 'The Measurement Ruler panel: Units, then the references Racket, Net Post, Net Width and Service Box, each with how to click it.'),
    },
    {
      id: 'calibrate',
      title: 'Calibrate on the racket',
      body: 'Click the butt cap at the bottom of the handle, then the tip of the frame. The panel turns green and says Calibrated.',
      target: 'tour-canvas',
      area: true,
      corner: 'bottom-left',
      advance: { kind: 'signal', name: 'ruler-calibrated' },
      image: shot('ruler', 'calibrate', 299, 'A racket with a blue point on the butt cap and another on the tip of the frame.'),
    },
    {
      id: 'measure',
      title: 'Measure a distance',
      body: 'Drag from one point to another: the gap between the knees, the length of a stride, the height of contact. The distance is written on the line.',
      target: 'tour-canvas',
      area: true,
      corner: 'bottom-left',
      advance: { kind: 'signal', name: 'ruler-measured' },
      image: shot('ruler', 'measure', 300, 'A dashed line between a player’s knees, labelled 39.7 cm.'),
    },
    {
      id: 'units',
      title: 'cm / m or ft / in',
      body: 'Switch the units here. The calibration stays, and every distance on screen changes over.',
      target: 'ruler-units',
      advance: { kind: 'signal', name: 'ruler-units' },
      image: shot('ruler', 'calibrated', 300, 'The ruler panel after calibration: the cm / m and ft / in switch, and a green Calibrated box reading Racket, 68.6 cm ref.'),
    },
    {
      id: 'done',
      title: 'That’s the ruler',
      body: 'The calibration stays with this clip when you switch tools; re-calibrate from the ruler panel if the camera moves. With the data column on, each distance is offered to the column for you to name.',
      placement: 'center',
      advance: { kind: 'next' },
    },
  ],
};
