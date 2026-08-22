/**
 * Whether the point about to be played is a break, set, or match point —
 * DERIVED from the score, never asked.
 *
 * The recorder used to have the coach flag "killer points" by hand after the
 * fact. The score already carries that answer: a point is a break point
 * exactly when the RETURNER would win the game by winning it, a set point when
 * winning it would also close the set, and a match point when it would close
 * the match. Simulating the point with `applyFormattedPoint` — the SAME
 * function that actually scores every logged point — rather than re-deriving
 * the win conditions here keeps this from ever disagreeing with the scoreboard.
 */

import type { Side } from '@/lib/tennis/gameScore';
import {
  applyFormattedPoint,
  isMatchOver,
  type FormattedBoard,
  type MatchFormatConfig,
} from '@/lib/tennis/matchFormat';

export type PointSignificanceKind = 'break' | 'set' | 'match';

export type PointSignificance = {
  /** The side that would win the game if it won THIS point. */
  side: Side;
  kind: PointSignificanceKind;
};

const SIDES: Side[] = ['player', 'opponent'];

/**
 * What is at stake in the point about to be played, computed from the score
 * BEFORE it.
 *
 * Usually zero or one entry. Exactly TWO only in the no-ad "sudden death"
 * decider at deuce, where the very next point decides the game outright for
 * both sides simultaneously — e.g. a break point for the returner AND a set
 * point for the server, in the same point.
 *
 * A plain hold ("game point" with nothing riding on it beyond the game itself)
 * deliberately returns nothing — only break/set/match points are significant
 * enough to show a badge for.
 */
export function derivePointSignificance(
  board: FormattedBoard,
  cfg: MatchFormatConfig,
  server: Side,
): PointSignificance[] {
  if (isMatchOver(board, cfg)) return [];

  const out: PointSignificance[] = [];
  for (const side of SIDES) {
    const hyp = applyFormattedPoint(board, side, cfg);
    const gameIdx = side === 'player' ? 0 : 1;
    const setClosed = hyp.sets.length > board.sets.length;
    // A game win is normally visible as the games count going up — EXCEPT when
    // that same point also closes the set, in which case `completeSetFromGames`
    // resets `games` back to [0,0] as part of starting the next set. `setClosed`
    // catches that case: a set can only ever be appended right after THIS side
    // won the game that decided it, so either signal alone proves a game win.
    const winsGame = hyp.games[gameIdx] > board.games[gameIdx] || setClosed;
    if (!winsGame) continue;

    if (isMatchOver(hyp, cfg)) {
      out.push({ side, kind: 'match' });
    } else if (setClosed) {
      out.push({ side, kind: 'set' });
    } else if (side !== server) {
      out.push({ side, kind: 'break' });
    }
    // A hold with nothing else riding on it: no badge.
  }
  return out;
}

export function significanceLabel(kind: PointSignificanceKind): string {
  return kind === 'match' ? 'Match Point' : kind === 'set' ? 'Set Point' : 'Break Point';
}
