import type { TourDef } from './types';

const visible = (id: string, extra = '') => `[data-tour-id="${id}"]${extra}`;

/**
 * Tour A — Getting started. The welcome tour: load a clip, find the moment
 * (play, scrub, step a frame), switch the AI skeleton on and let AI Detect
 * Angles fill the data column. Same rules as the Draw tour — every step points
 * at the real control and waits for the coach to use it.
 *
 * AI Detect freezes the frame as a snapshot; moving the playhead returns to
 * live on its own (app/analysis/page.tsx mode autopilot), which the last steps
 * tell the coach so the column emptying on play does not look like a loss.
 */
export const INTRO_TOUR: TourDef = {
  id: 'intro',
  title: 'Getting started',
  summary: 'Load a clip, find the moment, switch on the AI skeleton and let it measure the angles for you.',
  steps: [
    {
      id: 'load',
      title: 'Load a clip',
      body: 'Upload a video of your player, or open the Demo clip.',
      target: 'tour-upload',
      placement: 'bottom',
      advance: { kind: 'visible', selector: visible('tour-video-ab') },
      skipIf: visible('tour-video-ab'),
    },
    {
      id: 'play',
      title: 'Play it',
      body: 'Press play to watch the stroke. The space bar does the same.',
      target: 'tour-play',
      placement: 'top',
      advance: { kind: 'click' },
    },
    {
      id: 'scrub',
      title: 'Find the moment',
      body: 'Press or drag along the timeline to jump to the moment you want to look at — the load, contact, the finish.',
      target: 'tour-scrub',
      placement: 'top',
      advance: { kind: 'click' },
    },
    {
      id: 'step-frame',
      title: 'One frame at a time',
      body: 'Step forward a frame to land exactly on it. The arrow keys step too.',
      target: 'tour-step-fwd',
      placement: 'top',
      advance: { kind: 'click' },
    },
    {
      id: 'metrics',
      title: 'Open Metrics',
      body: 'The skeleton, the measuring tools and the data column all live under Metrics.',
      target: 'row-met-h',
      placement: 'right',
      advance: { kind: 'visible', selector: visible('row-sk-met') },
      skipIf: `${visible('row-sk-met')}, ${visible('row-sov')}`,
    },
    {
      id: 'skeleton-open',
      title: 'Switch on the skeleton',
      body: 'Opening Skeleton switches the AI skeleton on: it finds the player’s joints on every frame. The “Skeleton on / off” row inside is the one switch that turns it off.',
      target: 'row-sk-met',
      placement: 'right',
      advance: { kind: 'visible', selector: visible('row-sov') },
      skipIf: visible('row-sov'),
    },
    {
      id: 'skeleton-check',
      title: 'Check it found your player',
      body: 'Give it a moment to land on the player. If it asks whether the skeleton is over the player, answer Yes — or No, then click your player.',
      target: 'tour-canvas',
      area: true,
      advance: { kind: 'next' },
    },
    {
      id: 'back-to-metrics',
      title: 'Back to Metrics',
      body: 'Go back one screen to the Metrics tools.',
      target: 'toolbar-back',
      placement: 'right',
      advance: { kind: 'visible', selector: visible('row-m-aidetect') },
      skipIf: visible('row-m-aidetect'),
    },
    {
      id: 'ai-detect',
      title: 'AI Detect Angles',
      body: 'Reads the pose on this frame and measures it for you: elbows, knees, hips against shoulders.',
      target: 'row-m-aidetect',
      placement: 'right',
      advance: { kind: 'signal', name: 'ai-angles-detected' },
    },
    {
      id: 'data-column',
      title: 'The data column',
      body: 'The angles land in the column beside the player, and the frame is kept as a snapshot. Press play and you are back to live video — the snapshot stays saved.',
      target: 'tour-canvas',
      area: true,
      corner: 'bottom-right',
      advance: { kind: 'next' },
    },
    {
      id: 'done',
      title: 'You’re set up',
      body: 'Next, the Draw and angles tour shows how to measure and mark up the frame yourself. Reopen any tour from the ? button.',
      placement: 'center',
      advance: { kind: 'next' },
    },
  ],
};
