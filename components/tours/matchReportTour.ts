import type { TourDef, TourStep } from './types';
import { shot } from './shot';

const id = (k: string) => `[data-tour-id="${k}"]`;

/**
 * Manual match report — /match-report (components/ManualMatchRecorder.tsx).
 * Setup, Start match, then one point question by question, then Finish match
 * and the report. The point questions depend on the coach's answers (serve
 * outcomes skip the stroke; "Skip all" jumps past the ball questions; options
 * switched off are never asked), so each question step finishes when ANY later
 * question is on screen and is skipped if a later one already is.
 */
const POINT = ['winner', 'outcome', 'serve-outcome', 'stroke', 'depth', 'direction', 'height', 'speed', 'rally', 'serve-number', 'confirm'] as const;
type PointKey = (typeof POINT)[number];
const q = (k: PointKey | 'note') => id(`mr-q-${k}`);
const later = (k: PointKey) => POINT.slice(POINT.indexOf(k) + 1).map((x) => q(x)).join(', ');

const question = (k: PointKey, title: string, body: string, image: TourStep['image'], first = false): TourStep => ({
  id: k,
  title,
  body,
  target: `mr-q-${k}`,
  advance: { kind: 'visible', selector: later(k) },
  ...(first ? {} : { skipIf: later(k) }),
  image,
});

const pic = (name: string, h: number, alt: string) => shot('match', name, h, alt);

export const MATCH_REPORT_TOUR: TourDef = {
  id: 'match-report',
  title: 'Manual match report',
  summary: 'Set up a match, log a point question by question, then finish for the full report.',
  feature: 'matchAnalyzer',
  steps: [
    {
      id: 'players',
      title: 'Your player and the opponent',
      body: 'Type your player’s name or pick it from your player list, then the opponent. The match date starts as today.',
      target: 'mr-player',
      advance: { kind: 'next' },
      image: pic('setup', 300, 'The setup form: Your player, Opponent, Match date and the first match formats.'),
    },
    {
      id: 'format',
      title: 'Match format',
      body: 'Pick the format below: 1 Set, Best of 3, Pro Set, Match Tiebreak Only and more. The details underneath set the rest.',
      target: 'mr-format',
      advance: { kind: 'next' },
    },
    {
      id: 'ask',
      title: 'What to ask on each point',
      body: 'Advanced serve stats asks first or second serve; Advanced error counter asks what the ball was like on every error. Both start on, and any question can still be skipped point by point.',
      target: 'mr-ask',
      advance: { kind: 'next' },
      image: pic('ask', 222, 'Two options, both ticked: Advanced serve stats and Advanced error counter.'),
    },
    {
      id: 'serve-first',
      title: 'Who serves first?',
      body: 'Pick who serves the first game. The serve then alternates every game on its own.',
      target: 'mr-serve-first',
      advance: { kind: 'next' },
      image: pic('serve-first', 193, 'Who serves first? with two player buttons, then Start match.'),
    },
    {
      id: 'start',
      title: 'Start match',
      body: 'With both names in, press Start match.',
      target: 'mr-start',
      advance: { kind: 'visible', selector: q('winner') },
      skipIf: q('winner'),
    },
    question('winner', 'Who won the point?', 'Every point starts here: tap Point → and the winner’s name.',
      pic('winner', 267, 'The current score, Exit and Finish match, and two buttons: Point → Andrea and Point → Patrick.'), true),
    question('outcome', 'How did it end?', 'Serve / Return (ace, double fault, missed return), Unforced Error, Induced / Forced Error, or Winner.',
      pic('outcome', 405, 'Outcome: Serve / Return, Unforced Error, Induced / Forced Error and Winner.')),
    question('serve-outcome', 'Serve or return', 'Only the outcomes possible for this server and this winner are shown: an ace, a double fault or a return error.',
      pic('serve-outcome', 405, 'Andrea served — how did the point end? with Ace and Return error.')),
    question('stroke', 'Which stroke?', 'The shot that ended the point: Forehand, Backhand, Volley, Swing Volley, Smash or Drop Shot.',
      pic('stroke', 405, 'Which stroke made the error? with Forehand, Backhand, Volley, Swing Volley, Smash and Drop Shot.')),
    question('depth', 'How deep was the ball?', 'Short, Half Court or Deep. Each of these four questions can be skipped, or all of them at once.',
      pic('depth', 405, 'How deep was the ball? Depth, 1 of 4: Short, Half Court, Deep, and Skip depth.')),
    question('direction', 'Where did it go?', 'Right, Left or Center.',
      pic('direction', 405, 'Where did it go? Direction, 2 of 4: Right, Left, Center.')),
    question('height', 'How high was it?', 'Flat, Medium, High or Slice.',
      pic('height', 405, 'How high was it? Height, 3 of 4: Flat, Medium, High, Slice.')),
    question('speed', 'How fast was it?', 'Slow, Medium or Fast.',
      pic('speed', 405, 'How fast was it? Speed, 4 of 4: Slow, Medium, Fast.')),
    question('rally', 'How long was the rally?', '2 to 5 shots, or Custom for a longer rally. Not sure — skip if you didn’t count.',
      pic('rally', 405, 'How long was the rally? with 2, 3, 4, 5, Custom and Not sure — skip.')),
    question('serve-number', 'First or second serve?', 'Asked on every point except a double fault, which is a second serve by definition.',
      pic('serve-number', 405, 'First serve or second serve? with 1st serve, 2nd serve and Not sure — skip.')),
    {
      id: 'confirm',
      title: 'Add the point',
      body: 'Check the point and press Add point — confirm. The score and the serve update on their own.',
      target: 'mr-q-confirm',
      advance: { kind: 'visible', selector: `${q('winner')}, ${q('note')}` },
      image: pic('confirm', 405, 'Serve: 1st serve, and a large Add point — confirm button.'),
    },
    {
      id: 'undo-note',
      title: 'Undo and notes',
      body: 'Got a point wrong? Undo last point takes it back, for the whole match. After each game, Game break — note (optional) asks for a quick observation.',
      target: 'mr-undo',
      advance: { kind: 'next' },
      image: pic('note', 405, 'Game break — note (optional): a box for a quick observation about the game.'),
    },
    {
      id: 'finish',
      title: 'Finish match',
      body: 'When the match is over, or you stop early, press Finish match and confirm. Everything logged so far becomes the report.',
      target: 'mr-finish',
      advance: { kind: 'visible', selector: id('mr-summary') },
    },
    {
      id: 'summary',
      title: 'The match report',
      body: 'For each side: general stats and indices, winners and errors by stroke, what ball caused the errors, rally length, serve and return, first and second serve, and your summary.',
      target: 'mr-summary',
      placement: 'bottom',
      advance: { kind: 'next' },
      image: pic('summary', 305, 'Match summary for Andrea, opening with General stats & indices: points won and winners.'),
    },
    {
      id: 'export',
      title: 'Save it to the player',
      body: 'Save & Export to Google Doc opens Save to player folder: pick the player and the report goes into their Match Analysis Doc. Download PDF saves a copy; New match starts again.',
      target: 'mr-export',
      advance: { kind: 'next' },
      image: pic('export', 157, 'Three buttons: Save & Export to Google Doc, Download PDF and New match.'),
    },
  ],
};
