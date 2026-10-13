import type { TourDef } from './types';
import { shot } from './shot';

/**
 * App overview — from the Control Panel. What AngleMotion is and where each
 * tool lives, card by card; the last step opens Video analysis, where the
 * hands-on tours are. Every claim is what the screen behind the card does.
 */
export const OVERVIEW_TOUR: TourDef = {
  id: 'overview',
  title: 'AngleMotion in one minute',
  summary: 'What each tool on the Control Panel does, and where to start.',
  steps: [
    {
      id: 'welcome',
      title: 'Your Control Panel',
      body: 'Every AngleMotion tool starts from this screen. Here is what each one does.',
      placement: 'center',
      advance: { kind: 'next' },
    },
    {
      id: 'analysis',
      title: 'Video analysis',
      body: 'Start here. Load a clip, step to the moment, let the AI skeleton measure the angles, then draw, compare and record. Its ? button has a hands-on tour for each tool.',
      target: 'cp-analysis',
      advance: { kind: 'next' },
      image: shot('overview', 'analysis', 300, 'A forehand frame with the AI skeleton on and a data column of joint angles beside the player.'),
    },
    {
      id: 'players',
      title: 'Player database',
      body: 'One profile per player: their analysis sessions, screenshots and video links, and two Google Docs that grow all season, Technical Analysis and Match Analysis. Part of Pro and Academy.',
      target: 'cp-players',
      advance: { kind: 'next' },
      image: shot('overview', 'players', 300, 'The Players screen: a New player box with an Add button, and a grid of player cards.'),
    },
    {
      id: 'academy',
      title: 'AngleMotion Academy',
      body: 'A library of guides, eBooks and drill breakdowns: how to film, what to look for, how to turn a reading into coaching.',
      target: 'cp-academy',
      advance: { kind: 'next' },
    },
    {
      id: 'match-report',
      title: 'Manual match report',
      body: 'Follow a player through a live match and log it point by point on your phone, courtside. Finish it for the full report. Part of Pro and Academy.',
      target: 'cp-match-report',
      advance: { kind: 'next' },
      image: shot('overview', 'match-report', 300, 'The match setup form: your player, opponent, match date and the match formats.'),
    },
    {
      id: 'decoder',
      title: 'AI match decoder',
      body: 'Upload your SwingVision screenshots. They are read on your device with text recognition, and turned into the match statistics and a report. Part of Pro and Academy.',
      target: 'cp-decoder',
      advance: { kind: 'next' },
      image: shot('overview', 'decoder', 253, 'Upload your SwingVision screenshots: a box to add up to 25 screenshots and a Read screenshots button.'),
    },
    {
      id: 'billing',
      title: 'Account & billing',
      body: 'Your plan, invoices and payment method, handled through Stripe.',
      target: 'cp-billing',
      advance: { kind: 'next' },
    },
    {
      id: 'help',
      title: 'A tour on every screen',
      body: 'Press ? on Players, Manual match report and the match decoder for a tour of that tool. Inside Video analysis, ? sits with the zoom buttons on the right of the video.',
      placement: 'center',
      advance: { kind: 'next' },
    },
    {
      id: 'start',
      title: 'Open Video analysis',
      body: 'Press Video analysis to start. The Getting started tour is waiting there.',
      target: 'cp-analysis',
      advance: { kind: 'click' },
    },
  ],
};
