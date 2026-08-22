/**
 * FEATURE A — who is serving.
 *
 * The server is DERIVED, never logged per point. The coach picks who serves at
 * the moment the match starts (which may be mid-match — see startingScore.ts),
 * and standard alternation does the rest: the serve changes hands after every
 * completed game.
 *
 * Deriving rather than storing is what keeps this honest when a point is added:
 * there is no second source of truth to drift out of sync with the score.
 *
 * DELIBERATE OMISSION: serve rotation WITHIN a tiebreak (which alternates every
 * two points, after an opening single point) is not modelled. A tiebreak counts
 * as one game here, so the server for the NEXT game is still correct — only the
 * displayed server during the tiebreak itself is approximate.
 */

import type { Side } from '@/lib/tennis/gameScore';
import type { FormattedBoard } from '@/lib/tennis/matchFormat';

export function otherSide(s: Side): Side {
  return s === 'player' ? 'opponent' : 'player';
}

/** Total games finished across completed sets plus the set in progress. */
export function gamesCompleted(board: FormattedBoard): number {
  const inSets = board.sets.reduce((acc, [a, b]) => acc + a + b, 0);
  return inSets + board.games[0] + board.games[1];
}

/**
 * The origin the alternation counts from.
 *
 * `server` is who serves at `gamesAtStart` games completed. For a normal match
 * that is simply the first server at 0 games; for a match seeded from an
 * existing score it is whoever the coach says is serving right now, which is why
 * the baseline is a pair and not just a side.
 */
export type ServeOrigin = {
  server: Side;
  gamesAtStart: number;
};

export function serveOrigin(server: Side, gamesAtStart = 0): ServeOrigin {
  return { server, gamesAtStart };
}

/** Who is serving the game currently in progress. */
export function currentServer(origin: ServeOrigin, board: FormattedBoard): Side {
  const elapsed = gamesCompleted(board) - origin.gamesAtStart;
  // Guard against a negative delta (a board rebuilt behind the origin); parity
  // of a negative number is still well-defined but the intent is clearer here.
  const even = ((elapsed % 2) + 2) % 2 === 0;
  return even ? origin.server : otherSide(origin.server);
}
