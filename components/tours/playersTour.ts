import type { TourDef } from './types';
import { shot } from './shot';

/**
 * Player database — /players, then a profile. Hands-on where the screen can
 * be used directly (add a player, open the profile); the ways work reaches a
 * player from Video analysis are explained, because they happen on another
 * screen. Every flow named here is one the code has:
 *  - Screenshot → Save Screenshot → a player: an entry plus the frame in their
 *    Technical Analysis Doc (app/analysis/page.tsx handleScreenshotSaveToPlayer).
 *  - A clip captured into the video slot → Upload to YouTube (Unlisted) →
 *    Save to player folder with the link (page.tsx, the capture toast).
 *  - Metrics → Generate → Attach to <player> (app/api/google/report);
 *    manual match report and match decoder → the Match Analysis Doc.
 */
export const PLAYERS_TOUR: TourDef = {
  id: 'players',
  title: 'Player database',
  summary: 'Add a player, open their profile, and see how screenshots, videos and reports reach their file.',
  feature: 'players',
  steps: [
    {
      id: 'add',
      title: 'Add a player',
      body: 'Type the player’s full name under New player and press Add.',
      target: 'players-new',
      advance: { kind: 'signal', name: 'player-created' },
      image: shot('players', 'add', 151, 'The New player box with a Full name field and an Add button, above the player cards.'),
    },
    {
      id: 'open',
      title: 'Open a profile',
      body: 'Press a player’s card to open their profile.',
      target: 'players-grid',
      advance: { kind: 'click', selector: '[data-tour-id="player-card"]' },
      image: shot('players', 'open', 300, 'A grid of player cards, each with Open profile under the name.'),
    },
    {
      id: 'profile',
      title: 'The profile',
      body: 'Under the name: date of birth, nationality, playing hand and your notes on this player. Save profile keeps them.',
      target: 'player-profile',
      placement: 'bottom',
      advance: { kind: 'next' },
      image: shot('players', 'profile', 229, 'A player profile: photo URL, date of birth, nationality, playing hand, coach notes and Save profile.'),
    },
    {
      id: 'screenshot',
      title: 'Save a screenshot to a player',
      body: 'In Video analysis, press Screenshot and pick the player in Save Screenshot (or create one there). The frame goes into their Technical Analysis Doc and appears in Reports here.',
      placement: 'center',
      advance: { kind: 'next' },
    },
    {
      id: 'video',
      title: 'Save a video link',
      body: 'After you capture a clip into the video slot, press Upload to YouTube (Unlisted). When it is up, Save to player folder opens with the link: pick the player and the report is listed here with a YouTube link.',
      placement: 'center',
      advance: { kind: 'next' },
      image: shot('players', 'video', 125, 'A report entry titled Stroke analysis with a YouTube link under it.'),
    },
    {
      id: 'report',
      title: 'Save a report',
      body: 'In Video analysis, Metrics → Generate builds a report; choose Attach to the player and it is written into their Technical Analysis Doc. The manual match report and the match decoder add theirs to the Match Analysis Doc.',
      placement: 'center',
      advance: { kind: 'next' },
      image: shot('players', 'report', 251, 'A Match analysis entry in Reports with the match statistics written out.'),
    },
    {
      id: 'reports',
      title: 'Reports',
      body: 'Everything saved to this player, newest first. Technical Analysis and Match Analysis split the list; search finds a report by name.',
      target: 'player-report-tabs',
      advance: { kind: 'next' },
      image: shot('players', 'reports', 251, 'Reports with the tabs All, Technical Analysis and Match Analysis, a search box, and technique entries, one with a YouTube link.'),
    },
    {
      id: 'docs',
      title: 'The Google Docs and the Drive folder',
      body: 'Technical Analysis Doc and Match Analysis Doc open the player’s two documents; Open Drive folder opens their folder. The buttons appear once the first report is in.',
      target: 'player-doc-links',
      advance: { kind: 'next' },
      image: shot('players', 'docs', 109, 'Three buttons: Technical Analysis Doc, Match Analysis Doc and Open Drive folder.'),
    },
    {
      id: 'where',
      title: 'Where your files live',
      body: 'Videos are on your own YouTube channel, unlisted: anyone with the link can watch. Reports and screenshots go to Google Docs in your own Google Drive, under AngleMotion / Players (if Drive can’t be reached, AngleMotion keeps the screenshot). AngleMotion keeps the links, plus any Motion Layer clip you save with a session. Google’s own account limits apply.',
      placement: 'center',
      advance: { kind: 'next' },
    },
  ],
};
