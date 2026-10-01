import type { TourDef } from './types';

const visible = (id: string, extra = '') => `[data-tour-id="${id}"]${extra}`;

/**
 * Tour B — Draw and angles. Storyboard: the founder's 3a–3c and Skeleton
 * captures. Every step points at the real control, and every action step waits
 * for the coach to actually do it — clicks are watched through the toolbar's
 * own state, canvas work through app signals (lib/tourSignals.ts).
 *
 * Order matters: the plain angle arrow comes BEFORE Angle differential, because
 * the differential switches the data column on, and with the column on a plain
 * angle arrow opens a naming dialog the tour would have to talk around.
 */
export const DRAW_TOUR: TourDef = {
  id: 'draw',
  title: 'Draw and angles',
  summary: 'Measure an angle, compare two of them, mark up the frame, restyle a mark and move it.',
  steps: [
    {
      id: 'load',
      title: 'Load a clip',
      body: 'Upload a video, or open the Demo clip. Everything in this tour is drawn on whatever is on screen.',
      target: 'tour-upload',
      placement: 'bottom',
      advance: { kind: 'visible', selector: visible('tour-video-ab') },
      skipIf: visible('tour-video-ab'),
    },
    {
      id: 'metrics',
      title: 'Open Metrics',
      body: 'Every measuring and drawing tool lives under Metrics.',
      target: 'row-met-h',
      placement: 'right',
      advance: { kind: 'visible', selector: visible('row-m-draw') },
      skipIf: `${visible('row-m-draw')}, ${visible('row-aa-d')}`,
    },
    {
      id: 'draw',
      title: 'Open Draw',
      body: 'The drawing tools: lines, arrows, angles, shapes, the ruler and text.',
      target: 'row-m-draw',
      placement: 'right',
      advance: { kind: 'visible', selector: visible('row-aa-d') },
      skipIf: visible('row-aa-d'),
    },
    {
      id: 'angle-arrow-tool',
      title: 'Pick Angle arrow',
      body: 'An arrow that reads its own direction as an angle.',
      target: 'row-aa-d',
      placement: 'right',
      advance: { kind: 'visible', selector: visible('row-aa-d', '[data-active="true"]') },
      skipIf: visible('row-aa-d', '[data-active="true"]'),
    },
    {
      id: 'angle-arrow-draw',
      title: 'Draw it along a limb',
      body: 'Press at the joint and drag outwards — along the forearm, the thigh, the shoulder line. Let go and the angle is written on the arrow.',
      target: 'tour-canvas',
      area: true,
      advance: { kind: 'signal', name: 'mark-drawn', tool: 'arrowAngle' },
    },
    {
      id: 'angle-diff-tool',
      title: 'Compare two angles',
      body: 'Angle differential takes the next two arrows you draw and logs the difference between them — hips against shoulders, upper arm against forearm.',
      target: 'row-anglediff',
      placement: 'right',
      advance: { kind: 'signal', name: 'angle-diff-armed' },
    },
    {
      id: 'angle-diff-first',
      title: 'First arrow',
      body: 'Draw the first one — along the hips, say.',
      target: 'tour-canvas',
      area: true,
      advance: { kind: 'signal', name: 'angle-diff-first' },
    },
    {
      id: 'angle-diff-second',
      title: 'Second arrow',
      body: 'Now the second — along the shoulders. Both angles and the difference between them land in the data column beside the player.',
      target: 'tour-canvas',
      area: true,
      advance: { kind: 'signal', name: 'angle-diff-done' },
    },
    {
      id: 'pen-tool',
      title: 'Freehand markup',
      body: 'Pick Pen to circle a contact point or sketch a swing path. Line, Arrow, Circle and Rectangle sit right beside it.',
      target: 'row-pen',
      placement: 'right',
      advance: { kind: 'visible', selector: visible('row-pen', '[data-active="true"]') },
      skipIf: visible('row-pen', '[data-active="true"]'),
    },
    {
      id: 'pen-draw',
      title: 'Mark something',
      body: 'Draw on the frame — round the racket, under the feet, wherever you want the player to look.',
      target: 'tour-canvas',
      area: true,
      advance: { kind: 'signal', name: 'mark-drawn', tool: 'pen' },
    },
    {
      id: 'style-open',
      title: 'Style',
      body: 'Style sets the colour and thickness of your next mark — and restyles any mark you have already drawn.',
      target: 'row-st-d',
      placement: 'right',
      advance: { kind: 'visible', selector: visible('row-style-mode', '[data-active="true"]') },
    },
    {
      id: 'style-pick-mark',
      title: 'Pick a mark',
      body: 'Click any mark you drew. While style mode is on, clicks select instead of drawing.',
      target: 'tour-canvas',
      area: true,
      advance: { kind: 'signal', name: 'style-mark-selected' },
    },
    {
      id: 'style-colour',
      title: 'Give it a colour',
      body: 'Pick blue. The change lands on the selected mark straight away.',
      target: 'style-color-007AFF',
      placement: 'right',
      advance: { kind: 'signal', name: 'style-changed' },
    },
    {
      id: 'select-tool',
      title: 'Back to Select',
      body: 'Select leaves style mode and lets you move what you drew.',
      target: 'toolbar-select',
      placement: 'right',
      advance: {
        kind: 'visible',
        selector: `${visible('toolbar-select', '[aria-pressed="true"]')}, ${visible('row-sel-h', '[data-active="true"]')}`,
      },
    },
    {
      id: 'move-mark',
      title: 'Move a mark',
      body: 'Drag any mark to a new spot. Undo puts it back.',
      target: 'tour-canvas',
      area: true,
      advance: { kind: 'signal', name: 'mark-moved' },
    },
    {
      id: 'done',
      title: 'That’s the Draw toolkit',
      body: 'Angles, comparisons, markup and style — all of it lands in the screenshot, the recording and the player’s report. Reopen any tour from the ? button.',
      placement: 'center',
      advance: { kind: 'next' },
    },
  ],
};
