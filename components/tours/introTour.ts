import type { TourDef } from './types';
import { shot } from './shot';

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
      body: 'Press Upload Video for a clip of your player, or Demo (Tutorial) to follow along on ours.',
      target: 'tour-load',
      placement: 'bottom',
      advance: { kind: 'visible', selector: visible('tour-video-ab') },
      skipIf: visible('tour-video-ab'),
      image: shot('intro', 'load', 300, 'The empty canvas with three buttons: Upload Video, Tennis court (strategy board) and Demo (Tutorial).'),
    },
    {
      id: 'play',
      title: 'Play it',
      body: 'Press play to watch the stroke. The space bar does the same.',
      target: 'tour-play',
      placement: 'top',
      advance: { kind: 'click' },
      image: shot('intro', 'play', 160, 'The playback bar under the video: zoom, Fit, All, play, step back, step forward and the time.'),
    },
    {
      id: 'scrub',
      title: 'Find the moment',
      body: 'Press or drag along the timeline to jump to the moment you want to look at — the load, contact, the finish.',
      target: 'tour-scrub',
      placement: 'top',
      advance: { kind: 'click' },
      image: shot('intro', 'scrub', 102, 'The timeline under the video, with the playhead partway along it.'),
    },
    {
      id: 'step-frame',
      title: 'One frame at a time',
      body: 'Step forward a frame to land exactly on it. The arrow keys step too.',
      target: 'tour-step-fwd',
      placement: 'top',
      advance: { kind: 'click' },
      image: shot('intro', 'step-frame', 111, 'The play button and the two one-frame step buttons beside the clip time.'),
    },
    {
      id: 'metrics',
      title: 'Open Metrics',
      body: 'The skeleton, the measuring tools and the data column all live under Metrics.',
      target: 'row-met-h',
      placement: 'right',
      advance: { kind: 'visible', selector: visible('row-sk-met') },
      skipIf: `${visible('row-sk-met')}, ${visible('row-sov')}`,
      image: shot('intro', 'metrics', 299, 'The Metrics panel: Skeleton, Unlock skeleton, Draw, Data Column ON and Add note.'),
    },
    {
      id: 'skeleton-open',
      title: 'Switch on the skeleton',
      body: 'Opening Skeleton switches the AI skeleton on: it finds the player’s joints on every frame. The “Skeleton on / off” row inside is the one switch that turns it off.',
      target: 'row-sk-met',
      placement: 'right',
      advance: { kind: 'visible', selector: visible('row-sov') },
      skipIf: visible('row-sov'),
      image: shot('intro', 'skeleton-open', 299, 'The Skeleton panel with “Skeleton on / off” switched on, then Refresh pose overlay, AI Track and the label options.'),
    },
    {
      id: 'skeleton-check',
      title: 'Check it found your player',
      body: 'Give it a moment to land on the player. If it asks whether the skeleton is over the player, answer Yes — or No, then click your player.',
      target: 'tour-canvas',
      area: true,
      advance: { kind: 'next' },
      image: shot('intro', 'skeleton-check', 299, 'The AI skeleton drawn over a player’s arms and torso, with the message “Skeleton ready — press play”.'),
    },
    {
      id: 'back-to-metrics',
      title: 'Back to Metrics',
      body: 'Go back one screen to the Metrics tools.',
      target: 'toolbar-back',
      placement: 'right',
      advance: { kind: 'visible', selector: visible('row-m-aidetect') },
      skipIf: visible('row-m-aidetect'),
      image: shot('intro', 'back-to-metrics', 299, 'The Back button at the top of the Skeleton panel.'),
    },
    {
      id: 'ai-detect',
      title: 'AI Detect Angles',
      body: 'Reads the pose on this frame and measures it for you: elbows, knees, hips against shoulders.',
      target: 'row-m-aidetect',
      placement: 'right',
      advance: { kind: 'signal', name: 'ai-angles-detected' },
      image: shot('intro', 'ai-detect', 299, 'The Metrics list with AI Detect Angles between Clear column and Snapshot.'),
    },
    {
      id: 'data-column',
      title: 'The data column',
      body: 'The angles land in the column beside the player, and the frame is kept as a snapshot. Press play and you are back to live video — the snapshot stays saved.',
      target: 'tour-canvas',
      area: true,
      corner: 'bottom-right',
      advance: { kind: 'next' },
      image: shot('intro', 'data-column', 300, 'A forehand frame with the skeleton on and the Snapshot 1 data column beside the player: elbows, knees, feet, shoulder, hip, shoulder-hip difference and racket angle.'),
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
